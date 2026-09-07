/**
 * SONE web — the search mode's panel (ADR-0118).
 *
 * The rule the shell is built on (ADR-0069): the panel **navigates**, the area
 * beside it **shows**. Here that is filters and saved searches on the left, and
 * the results on the right. Narrowing a search is navigating within it, and a
 * saved search is a menu entry — which is the shape every other mode has.
 *
 * ## It edits filters, never the syntax
 *
 * Every control parses what is in the field, changes one thing, and writes it
 * back through `buildSearchQuery`. Composing `tag:` here would be a second
 * writer of a syntax core already owns, and the two would disagree the first
 * time either was touched — which for a search box means pressing a tag
 * silently changing something else in the query.
 *
 * The field stays. The filters are how somebody who does not know the syntax
 * narrows a search; the field is how somebody who does types one in one go, and
 * pressing a control shows them what it would have looked like.
 *
 * ## And every filter that is on has a control here
 *
 * The other half of that sentence, and the one this panel kept getting wrong.
 * A control drawn from a fetched list can only show what the list holds — so a
 * tag ranked thirteenth, a tag the list has never heard of, and a folder whose
 * name is spelt with a capital letter each had a filter switched on and either
 * no control or one giving the opposite answer.
 *
 * So: what is on is drawn first and always, out of the query rather than out of
 * the list, and the list decides only what else is *offered*.
 */

import {
  buildSearchQuery,
  derivedTagColor,
  hasSearchCriteria,
  parseSearchQuery,
  tagKey,
  type SearchFilters,
} from '@sone/core';
import { useEffect, useState, type ReactElement } from 'react';

import { api, type PageNode, type WorkspaceMember, type WorkspaceTag } from '../api/client.ts';
import { useT } from '../i18n/useT.tsx';

interface SearchPanelProps {
  workspaceId: string;
  /** The whole query, as typed. The URL holds it (ADR-0118). */
  query: string;
  onQuery: (query: string) => void;
  /** The workspace's folders, for `in:` — already in the shell's hands. */
  folders: PageNode[];
  /** Whose "assigned to me" this is. */
  userId: string;
}

/**
 * How many tags the facet offers without being asked, and how many it offers
 * in answer to typing.
 *
 * One number for both, because they are the same judgement: how long a list of
 * short words can be read at a glance rather than searched through. The people
 * field one section down settled the second half of it first.
 */
const TAGS_SHOWN = 12;

/**
 * A tag as this panel draws it.
 *
 * `count: null` is a tag the workspace list does not hold — typed into the
 * field, or named by a kept search that outlived it, or carried only by pages
 * this reader cannot see. It has a name and no number, and the difference
 * matters: the count means *pages you can see carrying this*, and a zero would
 * be an answer where what we have is the absence of one.
 */
interface OfferedTag {
  key: string;
  label: string;
  color: string;
  count: number | null;
}

/** Every folder in the tree, flattened, outermost first. */
function foldersIn(nodes: PageNode[]): PageNode[] {
  const out: PageNode[] = [];
  const walk = (list: PageNode[]): void => {
    for (const node of list) {
      if (node.kind === 'folder') out.push(node);
      walk(node.children);
    }
  };
  walk(nodes);
  return out;
}

export function SearchPanel({
  workspaceId,
  query,
  onQuery,
  folders,
  userId,
}: SearchPanelProps): ReactElement {
  const { t } = useT();
  const [tags, setTags] = useState<WorkspaceTag[]>([]);
  const [members, setMembers] = useState<WorkspaceMember[]>([]);
  const [saved, setSaved] = useState<Array<{ id: string; name: string; query: string }>>([]);
  /** Naming the current search to keep it (ADR-0050). */
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState('');
  /** What is typed into the people field. Filters the members already fetched. */
  const [who, setWho] = useState('');
  /** And into the tag field, which the facet grows only when it has to. */
  const [whichTag, setWhichTag] = useState('');

  useEffect(() => {
    let cancelled = false;
    // Each of the three is a convenience: a list that cannot be fetched is
    // drawn as no list rather than as an error above the search somebody came
    // to run. The field works without any of them.
    void api.workspaceTags(workspaceId).then(
      (result) => !cancelled && setTags(result.tags),
      () => !cancelled && setTags([]),
    );
    void api.members(workspaceId).then(
      (result) => !cancelled && setMembers(result.members),
      () => !cancelled && setMembers([]),
    );
    return () => {
      cancelled = true;
    };
  }, [workspaceId]);

  const reloadSaved = (): void => {
    void api.savedSearches(workspaceId).then(
      (result) => setSaved(result.searches),
      () => setSaved([]),
    );
  };
  useEffect(reloadSaved, [workspaceId]);

  /** Change one thing and write the whole query back. */
  const edit = (change: (filters: SearchFilters) => void): void => {
    const filters = parseSearchQuery(query);
    change(filters);
    onQuery(buildSearchQuery(filters));
  };

  const filters = parseSearchQuery(query);
  const has = (list: string[], value: string): boolean => list.includes(value.toLowerCase());

  /** On or off, for a filter that is a set of values. */
  const toggle = (pick: (f: SearchFilters) => string[], value: string): void =>
    edit((f) => {
      const list = pick(f);
      const at = list.indexOf(value.toLowerCase());
      if (at === -1) list.push(value.toLowerCase());
      else list.splice(at, 1);
    });

  /*
   * Whom the people field is offering.
   *
   * Filtered here rather than fetched: the members list is already in hand for
   * this workspace, and a request per keystroke would be a request for
   * something already loaded. Nothing is offered until two characters, and
   * never more than eight — the same shape the people picker on the members
   * screen has, for the same reason.
   */
  const matching =
    who.trim().length < 2
      ? []
      : members
          .filter(
            (member) =>
              member.displayName.toLowerCase().includes(who.trim().toLowerCase()) &&
              !has(filters.authors, member.displayName),
          )
          .slice(0, 8);

  /*
   * The tags this facet draws: the ones that are on, and the ones worth
   * offering.
   *
   * Every tag used to be a button. That is right at ten and a wall at two
   * hundred — which is the sentence ADR-0120 already wrote one section down,
   * about members: *„die wird sonst irgendwann zu groß"*.
   *
   * **Which twelve is a question about use.** The list arrives ordered by key,
   * because that is what makes the spelling it shows stable — and taking the
   * first twelve of that would hide the tag on four hundred pages for starting
   * with a W. They are *read* alphabetically, though: which tags deserve the
   * space is a question about use, and the order they are looked through in is
   * a question about names.
   *
   * **And a tag that is on is always drawn**, twelfth or hundredth. A filter
   * you cannot see is a filter you cannot take off — the rule the chosen
   * people follow below, and the one a cut would otherwise break.
   */
  const asOffered = (tag: WorkspaceTag): OfferedTag => ({
    key: tag.key,
    label: tag.label,
    color: tag.color,
    count: tag.count,
  });
  const byLabel = (a: OfferedTag, b: OfferedTag): number => a.label.localeCompare(b.label);

  const chosenTags: OfferedTag[] = filters.tags
    .map((key) => {
      const known = tags.find((tag) => tag.key === key);
      // Called what the query spells, because for a tag nobody has another
      // name — and coloured the way `TagEditor` colours a tag typed a moment
      // ago, so the same word is the same colour in both places.
      return known ? asOffered(known) : { key, label: key, color: derivedTagColor(key), count: null };
    })
    .sort(byLabel);

  const unchosenTags = tags.filter((tag) => !has(filters.tags, tag.key));
  const offeredTags = [...unchosenTags]
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key))
    .slice(0, TAGS_SHOWN)
    .map(asOffered)
    .sort(byLabel);

  // Nothing until two characters, like the people field: one letter matching
  // half a vocabulary is a list again.
  const drawnTags = new Set([...chosenTags, ...offeredTags].map((tag) => tag.key));
  const foundTags: OfferedTag[] =
    whichTag.trim().length < 2
      ? []
      : unchosenTags
          .filter((tag) => !drawnTags.has(tag.key) && tag.key.includes(tagKey(whichTag)))
          .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key))
          .slice(0, TAGS_SHOWN)
          .map(asOffered)
          .sort(byLabel);

  const tagChip = (tag: OfferedTag): ReactElement => (
    <button
      key={tag.key}
      type="button"
      className="search-facet-tag"
      data-color={tag.color}
      aria-pressed={has(filters.tags, tag.key)}
      onClick={() => {
        toggle((f) => f.tags, tag.key);
        // Cleared, because the tag has just moved up into the row above: a
        // field still holding the word that found it would offer to find it
        // again.
        setWhichTag('');
      }}
    >
      {tag.label}
      {tag.count !== null && <span className="search-facet-count">{tag.count}</span>}
    </button>
  );

  /*
   * The folders the chooser can offer, and the name it is holding that none of
   * them answers to.
   *
   * Untitled ones are left out rather than listed as *„Ohne Titel"*: `in:`
   * narrows by name, so an option for a folder with no name wrote an empty
   * filter and quietly meant "anywhere" — a third entry that did what the
   * first one did.
   */
  const namedFolders = foldersIn(folders).filter((folder) => (folder.title ?? '') !== '');
  const unofferedIn =
    filters.in[0] !== undefined &&
    !namedFolders.some((folder) => (folder.title ?? '').toLowerCase() === filters.in[0])
      ? filters.in[0]
      : null;
  const anything =
    filters.tags.length > 0 ||
    filters.in.length > 0 ||
    filters.authors.length > 0 ||
    filters.assigned.length > 0 ||
    filters.after !== null ||
    filters.before !== null;

  /** Keep the current search under a name, and show it in the list at once. */
  const keep = (): void => {
    if (name.trim() === '') return;
    void api.saveSearch(workspaceId, name.trim(), query.trim()).then(() => {
      setNaming(false);
      reloadSaved();
    });
  };

  return (
    <div className="search-panel">
      {/* Keeping this one, beside the ones already kept.
        *
        * It was on the screen and the list was too (ADR-0050); the list moved
        * here and this followed it, because a button whose result appears in
        * another column is a button whose result somebody misses. It also
        * removes the only reason the two components would have had to tell each
        * other anything. */}
      {hasSearchCriteria(filters) && (
        <section className="search-facet">
          {naming ? (
            <div className="search-naming">
              <input
                className="search-name"
                autoFocus
                value={name}
                placeholder={t('search.nameIt')}
                aria-label={t('search.nameIt')}
                onChange={(event) => setName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Escape') setNaming(false);
                  if (event.key === 'Enter') keep();
                }}
              />
              <button
                type="button"
                className="btn primary"
                disabled={name.trim() === ''}
                onClick={keep}
              >
                {t('action.save')}
              </button>
              <button type="button" className="btn subtle" onClick={() => setNaming(false)}>
                {t('action.cancel')}
              </button>
            </div>
          ) : (
            <button
              type="button"
              className="btn subtle search-keep"
              onClick={() => {
                setName(query.trim().slice(0, 80));
                setNaming(true);
              }}
            >
              {t('search.keep')}
            </button>
          )}
        </section>
      )}

      {saved.length > 0 && (
        <section className="search-facet">
          <h2 className="sidebar-label">{t('search.saved')}</h2>
          <ul className="saved-searches">
            {saved.map((one) => (
              <li key={one.id}>
                <button
                  type="button"
                  className="saved-search"
                  aria-current={one.query === query ? 'true' : undefined}
                  onClick={() => onQuery(one.query)}
                >
                  <span className="saved-search-name">{one.name}</span>
                  {/* The query as well as the name: a name is memorable and a
                      query is readable, and neither substitutes for the other. */}
                  <span className="saved-search-query">{one.query}</span>
                </button>
                <button
                  type="button"
                  className="saved-search-forget"
                  aria-label={t('search.forget', { name: one.name })}
                  onClick={() => void api.forgetSearch(one.id).then(reloadSaved)}
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {(tags.length > 0 || chosenTags.length > 0) && (
        <section className="search-facet">
          <h2 className="sidebar-label">{t('search.facet.tags')}</h2>
          <div className="search-facet-tags">
            {chosenTags.map(tagChip)}
            {offeredTags.map(tagChip)}
          </div>

          {/* The field appears only when there is something behind it — over
              two tags it would be a control whose only purpose is to hide one
              of them. */}
          {unchosenTags.length > offeredTags.length && (
            <>
              <input
                type="search"
                className="search-facet-input"
                value={whichTag}
                placeholder={t('search.facet.findTagPlaceholder')}
                aria-label={t('search.facet.findTag')}
                onChange={(event) => setWhichTag(event.target.value)}
              />
              {foundTags.length > 0 && (
                <div className="search-facet-matches">
                  <div className="search-facet-tags">{foundTags.map(tagChip)}</div>
                </div>
              )}
            </>
          )}
        </section>
      )}

      <section className="search-facet">
        <h2 className="sidebar-label">{t('search.facet.people')}</h2>
        {/* Mine first and by id, because it is the one everybody wants and the
            only one that needs no picking. `assigned:me` would work too; the id
            is what the rest of this list writes, and one shape is easier to
            read back than two. */}
        <button
          type="button"
          className="search-facet-row"
          aria-pressed={has(filters.assigned, userId)}
          onClick={() => toggle((f) => f.assigned, userId)}
        >
          {t('search.facet.assignedMe')}
        </button>

        {/* Chosen, not listed (ADR-0120).
          *
          * Every member was a row, which is fine at four and unusable at forty —
          * *„die wird sonst irgendwann zu groß"*. A field that filters as you
          * type has the same first keystroke either way and does not grow.
          *
          * Whoever is already chosen stays visible above it: a filter you cannot
          * see is a filter you cannot take off. */}
        {filters.authors.map((name) => (
          <button
            key={name}
            type="button"
            className="search-facet-row"
            aria-pressed="true"
            onClick={() => toggle((f) => f.authors, name)}
          >
            {/* Called what they are called, not what the query spells.
              *
              * The filter is stored lowercased — `author:` is a case-insensitive
              * prefix match (ADR-0050) — so reading it straight back put "By
              * anna weber" on screen. The member list is in hand; when it knows
              * the name, it is the one to show. */}
            {t('search.facet.writtenBy', {
              name:
                members.find((one) => one.displayName.toLowerCase() === name)?.displayName ??
                name,
            })}
          </button>
        ))}

        <input
          type="search"
          className="search-facet-input"
          value={who}
          placeholder={t('search.facet.whoPlaceholder')}
          aria-label={t('search.facet.who')}
          onChange={(event) => setWho(event.target.value)}
        />
        {matching.length > 0 && (
          <div className="search-facet-matches">
            {matching.map((member) => (
              <button
                key={member.userId}
                type="button"
                className="search-facet-row"
                // The display name, because `author:` is a prefix match against
                // the names a page carries — a whole name is a prefix of itself.
                onClick={() => {
                  toggle((f) => f.authors, member.displayName);
                  setWho('');
                }}
              >
                {t('search.facet.writtenBy', { name: member.displayName })}
              </button>
            ))}
          </div>
        )}
      </section>

      {(namedFolders.length > 0 || unofferedIn !== null) && (
        <section className="search-facet">
          <h2 className="sidebar-label">{t('search.facet.in')}</h2>
          <select
            className="search-facet-select"
            aria-label={t('search.facet.in')}
            value={filters.in[0] ?? ''}
            onChange={(event) =>
              edit((f) => {
                f.in.length = 0;
                if (event.target.value !== '') f.in.push(event.target.value);
              })
            }
          >
            <option value="">{t('search.facet.anywhere')}</option>
            {/* A name the folders do not answer to, shown as itself.
              *
              * Typed by hand, or kept in a search from before a rename. The
              * results column says "no such folder" beside it; the one answer
              * this may not give is "anywhere", which is the state it snapped
              * back to before. */}
            {unofferedIn !== null && <option value={unofferedIn}>{unofferedIn}</option>}
            {namedFolders.map((folder) => (
              // The value is what the query stores — lowercased, because `in:`
              // is a case-insensitive name match (ADR-0050). Spelling it as
              // the title made choosing "Finanzen" write `in:finanzen` and
              // then match no option, so the chooser answered "Anywhere" about
              // a search that was in a folder.
              <option key={folder.id} value={(folder.title ?? '').toLowerCase()}>
                {folder.title}
              </option>
            ))}
          </select>
        </section>
      )}

      <section className="search-facet">
        <h2 className="sidebar-label">{t('search.facet.when')}</h2>
        <label className="search-facet-date">
          {t('search.facet.after')}
          <input
            type="date"
            value={filters.after ?? ''}
            onChange={(event) =>
              edit((f) => {
                f.after = event.target.value === '' ? null : event.target.value;
              })
            }
          />
        </label>
        <label className="search-facet-date">
          {t('search.facet.before')}
          <input
            type="date"
            value={filters.before ?? ''}
            onChange={(event) =>
              edit((f) => {
                f.before = event.target.value === '' ? null : event.target.value;
              })
            }
          />
        </label>
      </section>

      {anything && (
        <button
          type="button"
          className="btn subtle search-facet-clear"
          // The words are kept. Clearing the filters and the search term
          // together is two intentions on one button, and the one somebody
          // means here is "widen this", not "start again".
          onClick={() => edit((f) => {
            f.tags.length = 0;
            f.in.length = 0;
            f.authors.length = 0;
            f.assigned.length = 0;
            f.after = null;
            f.before = null;
          })}
        >
          {t('search.facet.clear')}
        </button>
      )}
    </div>
  );
}
