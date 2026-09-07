/**
 * SONE web — a comment box that can name somebody (ADR-0085).
 *
 * A textarea rather than an editor, because a comment is a string and making it
 * a second ProseMirror instance would be a second document model for one
 * sentence. So the `@` picker is built on the caret position instead of on a
 * plugin, and `mentionDraft.ts` holds the rules — which are the same rules the
 * editor's plugin applies, expressed in the form a textarea can answer.
 *
 * The draft and the people picked for it belong to the caller, and sending does
 * too: the caller already knows whether this is a new thread or a reply, and
 * there is a button beside the box that sends as well. This component owns the
 * list and the caret, which is all it needs to know about.
 */

import { useRef, useState, type ReactElement, type KeyboardEvent } from 'react';

import { useChoiceList } from '../hooks/useChoiceList.ts';
import { useT } from '../i18n/useT.tsx';
import { filterPeople, type MentionCandidate } from './MentionMenu.tsx';
import { mentionQueryAt, withMention, type Picked } from './mentionDraft.ts';

interface MentionDraftInputProps {
  value: string;
  /**
   * Everybody chosen while typing this draft, held by the caller.
   *
   * Not state of this component's own, because the composer is not the only
   * thing that sends: there is a button beside it, and a component holding the
   * ids privately would leave that button able to send the text and not who was
   * named in it. The draft and the people picked for it are one piece of state.
   *
   * The text alone cannot say who was meant — `@Anna` is a string, and two
   * Annas would be one string — so which of these still count is decided when
   * sending, by `mentionsInDraft`.
   */
  picked: readonly Picked[];
  onChange: (value: string, picked: readonly Picked[]) => void;
  /** Enter, when no list is open. The caller decides what sending means. */
  onSend: () => void;
  onEscape?: () => void;
  people: readonly MentionCandidate[];
  placeholder: string;
  autoFocus?: boolean;
}

export function MentionDraftInput({
  value,
  picked,
  onChange,
  onSend,
  onEscape,
  people,
  placeholder,
  autoFocus,
}: MentionDraftInputProps): ReactElement {
  const { t } = useT();
  const areaRef = useRef<HTMLTextAreaElement | null>(null);
  const [at, setAt] = useState<{ from: number; query: string } | null>(null);

  const found = at ? filterPeople(at.query, people) : [];

  const update = (text: string, caret: number): void => {
    onChange(text, picked);
    setAt(mentionQueryAt(text, caret));
  };

  const choose = (person: MentionCandidate): void => {
    if (!at) return;
    const next = withMention(value, at, { userId: person.userId, label: person.displayName });
    onChange(next.text, [...picked, { userId: person.userId, label: person.displayName }]);
    setAt(null);
    // The caret after the inserted name, on the next frame: React has not
    // written the new value into the element yet.
    requestAnimationFrame(() => {
      areaRef.current?.setSelectionRange(next.caret, next.caret);
      areaRef.current?.focus();
    });
  };

  const choices = useChoiceList({
    count: at ? found.length : 0,
    onChoose: (position) => {
      const person = found[position];
      if (person) choose(person);
    },
    resetOn: at?.query,
  });

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    /*
     * The list first (ADR-0142). Enter picks a person while it is open, and
     * only then — otherwise choosing a name and ending the comment would be the
     * same keystroke.
     *
     * `handleKey` answers whether the key was the list's; everything below is
     * what this box means by the keys the list did not want.
     */
    if (choices.handleKey(event)) return;
    if (event.key === 'Escape') {
      if (at) {
        // Escape closes the list first, and the composer only if there is no
        // list — the same order every menu in the application follows.
        event.preventDefault();
        setAt(null);
        return;
      }
      onEscape?.();
      return;
    }
    if (event.key === 'Enter' && !event.shiftKey) {
      // Enter sends, shift+enter breaks the line: a comment is usually one
      // sentence, and reaching for a button for one sentence is the friction
      // that stops people commenting.
      event.preventDefault();
      setAt(null);
      onSend();
    }
  };

  return (
    <div className="comment-draft-wrap">
      <textarea
        ref={areaRef}
        className="comment-draft"
        value={value}
        autoFocus={autoFocus}
        placeholder={placeholder}
        aria-label={placeholder}
        onChange={(event) =>
          update(event.target.value, event.target.selectionStart ?? event.target.value.length)
        }
        // A click or an arrow moves the caret without changing the text, and an
        // `@` two words back is then no longer what is being typed.
        onSelect={(event) => {
          const area = event.currentTarget;
          setAt(mentionQueryAt(area.value, area.selectionStart ?? area.value.length));
        }}
        onKeyDown={onKeyDown}
      />
      {at && (
        <div
          className="comment-mention-menu"
          role="listbox"
          aria-label={t('mention.pick')}
          // On the list rather than on the textarea: a composer that happens to
          // be showing a mention list is not a combobox, and saying it is would
          // tell a screen reader the whole box is a chooser.
          aria-activedescendant={choices.activeId}
          ref={choices.listRef}
        >
          {found.length === 0 ? (
            <p className="slash-empty">
              {people.length === 0 ? t('mention.nobody') : t('mention.noMatch', { query: at.query })}
            </p>
          ) : (
            found.map((person, position) => (
              <button
                key={person.userId}
                type="button"
                className="slash-item"
                {...choices.optionProps(position)}
                // Pointer-down rather than click: a click would blur the
                // textarea first, and the caret this needs would be gone.
                onPointerDown={(event) => {
                  event.preventDefault();
                  choose(person);
                }}
              >
                <span className="slash-title">{person.displayName}</span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
