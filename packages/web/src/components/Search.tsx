/**
 * SONE web — search.
 *
 * Debounced, and requests are superseded rather than cancelled: an out-of-order
 * response from a slower earlier query would otherwise overwrite the newer one,
 * which looks like search returning the wrong results.
 *
 * A result is a card rather than a link (ADR-0033): its own icon, what kind of
 * thing it is, where it lives, and the passage that matched with the match
 * marked. A list of titles could not say which of those it had found, which was
 * half the report behind this.
 *
 * Folders and pages are separate groups. A folder answers "where is that" and a
 * page answers "where did I write that", and mixed together the two kinds of
 * answer have to be told apart by reading each row.
 */

import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react';

import { hasSearchCriteria, parseSearchQuery } from '@sone/core';

import {
  ApiError,
  MATCH_CLOSE,
  MATCH_OPEN,
  api,
  type AppliedFilters,
  type SearchResult,
  type SimilarName,
} from '../api/client.ts';
import { useT } from '../i18n/useT.tsx';
import { paths } from '../routes/paths.ts';
import { messageFor } from './Auth.tsx';
import { EntryIconView, entryKind, titleColorStyle } from './EntryIconView.tsx';

/**
 * Swap the misspelt word for the correction, keeping the filters.
 *
 * Replacing the whole query would throw away a `tag:` or `after:` somebody
 * typed — a correction is about one word, and losing the rest of a narrowed
 * search to accept a spelling would be a strange trade.
 */
function withWord(query: string, word: string): string {
  const parsed = parseSearchQuery(query);
  return parsed.text === '' ? word : query.replace(parsed.text, word);
}

export function SearchScreen({
  workspaceId,
  initialQuery,
}: {
  workspaceId: string;
  initialQuery: string;
}): ReactElement {
  const { t } = useT();
  const [query, setQuery] = useState(initialQuery);
  const [results, setResults] = useState<SearchResult[]>([]);
  /** Names that are close, offered only when the search found little. */
  const [similar, setSimilar] = useState<SimilarName[]>([]);
  const [error, setError] = useState<string | null>(null);
  /**
   * What the *server* made of the query (ADR-0050).
   *
   * The chips are drawn from this rather than from the local parse, because this
   * is the version that was actually used. The local parse decides whether to
   * search at all — it has to answer that before a request exists — and the two
   * agree because they are the same function.
   */
  const [applied, setApplied] = useState<AppliedFilters | null>(null);
  /** Spellings that exist here, when the search found little (ADR-0051). */
  const [corrections, setCorrections] = useState<string[]>([]);
  /** Searches this person has kept here (ADR-0050). */
  const [saved, setSaved] = useState<Array<{ id: string; name: string; query: string }>>([]);
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState('');

  const reloadSaved = useCallback(() => {
    void api
      .savedSearches(workspaceId)
      .then((result) => setSaved(result.searches))
      .catch(() => {
        // A list that cannot be fetched is drawn as no list: it is a
        // convenience, and an error about it would sit above the search
        // somebody came to run.
        setSaved([]);
      });
  }, [workspaceId]);

  useEffect(reloadSaved, [reloadSaved]);
  const [searching, setSearching] = useState(false);
  const requestId = useRef(0);

  /** Parsed here as well, to decide whether there is anything to search for. */
  const parsed = parseSearchQuery(query);

  useEffect(() => {
    // A filter alone is enough: the two-character minimum is about a guess, and
    // a filter is not one (ADR-0050).
    if (!hasSearchCriteria(parseSearchQuery(query))) {
      setResults([]);
      setSimilar([]);
      setApplied(null);
      setCorrections([]);
      setSearching(false);
      return;
    }

    const id = ++requestId.current;
    setSearching(true);
    const timer = setTimeout(() => {
      void api
        .search(workspaceId, query)
        .then((response) => {
          // Ignore a response that has been superseded.
          if (id !== requestId.current) return;
          setResults(response.results);
          setSimilar(response.similar ?? []);
          setApplied(response.filters ?? null);
          setCorrections(response.corrections ?? []);
          setError(null);
        })
        .catch((err: unknown) => {
          if (id !== requestId.current) return;
          setError(err instanceof ApiError ? err.code : 'network_error');
        })
        .finally(() => {
          if (id === requestId.current) setSearching(false);
        });
    }, 200);

    return () => clearTimeout(timer);
  }, [query, workspaceId]);

  return (
    <div className="page-body">
      <h1>{t('search.title')}</h1>
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={t('search.placeholder')}
        aria-label={t('search.field')}
        autoFocus
        type="search"
      />

      {/* What the query was read as.
        *
        * Above the results, so nothing is hidden: somebody who typed `autor:`
        * and got no filter can see that, and somebody who typed a date that
        * could not be read sees it struck through with the reason rather than
        * silently dropped. */}
      {applied && (
        <div className="search-chips">
          {applied.tags.map((tag) => (
            <span key={`tag-${tag}`} className="search-chip">
              {t('search.chip.tag', { value: tag })}
            </span>
          ))}
          {/* A folder, and how many folders that name matched (ADR-0050).
            *
            * The count is on the chip and not only in the record: a name that
            * matched two folders reaches further than somebody meant, and one
            * that matched none narrows to nothing — both are facts about the
            * search they are looking at. */}
          {(applied.in ?? []).map((name) => (
            <span key={`in-${name}`} className="search-chip">
              {applied.inMatched === 0
                ? t('search.chip.inNone', { value: name })
                : (applied.inMatched ?? 1) > 1
                  ? t('search.chip.inMany', { value: name, count: applied.inMatched ?? 0 })
                  : t('search.chip.in', { value: name })}
            </span>
          ))}
          {applied.authors.map((author) => (
            <span key={`author-${author}`} className="search-chip">
              {t('search.chip.author', { value: author })}
            </span>
          ))}
          {applied.assigned.map((who) => (
            <span key={`assigned-${who}`} className="search-chip">
              {who === 'me' ? t('search.chip.assignedMe') : t('search.chip.assigned', { value: who })}
            </span>
          ))}
          {applied.after && (
            <span className="search-chip">{t('search.chip.after', { value: applied.after })}</span>
          )}
          {applied.before && (
            <span className="search-chip">
              {t('search.chip.before', { value: applied.before })}
            </span>
          )}
          {applied.unreadable.map((one) => (
            <span
              key={`bad-${one.prefix}-${one.value}`}
              className="search-chip unreadable"
              title={t('search.chip.notADate')}
            >
              {one.prefix}:{one.value}
            </span>
          ))}
        </div>
      )}

      {/* What has been kept, under an empty field.
        *
        * Here rather than in the sidebar: this is where somebody is when they
        * want to run one again, and a third sidebar section is a decision about
        * the sidebar rather than about searches (ADR-0050). */}
      {query === '' && saved.length > 0 && (
        <ul className="saved-searches">
          {saved.map((one) => (
            <li key={one.id}>
              <button type="button" className="saved-search" onClick={() => setQuery(one.query)}>
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
      )}

      {/* Keeping this one, offered only when there is something to keep. */}
      {hasSearchCriteria(parsed) && !naming && (
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

      {naming && (
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
              if (event.key === 'Enter' && name.trim() !== '') {
                void api.saveSearch(workspaceId, name.trim(), query.trim()).then(() => {
                  setNaming(false);
                  reloadSaved();
                });
              }
            }}
          />
          <button
            type="button"
            className="btn primary"
            disabled={name.trim() === ''}
            onClick={() =>
              void api.saveSearch(workspaceId, name.trim(), query.trim()).then(() => {
                setNaming(false);
                reloadSaved();
              })
            }
          >
            {t('action.save')}
          </button>
          <button type="button" className="btn subtle" onClick={() => setNaming(false)}>
            {t('action.cancel')}
          </button>
        </div>
      )}

      {/* The syntax, once, under the field — not a help page somebody has to
          find, and not a permanent panel either: it disappears as soon as
          anything is typed. */}
      {query === '' && <p className="settings-note">{t('search.syntax')}</p>}

      {/* A spelling that exists here (ADR-0051).
        *
        * Offered as a *search* rather than as a result, which is the whole point
        * of correcting the word instead of matching the text: pressing it runs
        * the ordinary ranked search, with the same weighting and snippets as any
        * other. */}
      {corrections.length > 0 && (
        <p className="search-corrections">
          {t('search.didYouMean')}{' '}
          {corrections.map((word, at) => (
            <span key={word}>
              {at > 0 && ', '}
              <button type="button" className="link" onClick={() => setQuery(withWord(query, word))}>
                {word}
              </button>
            </span>
          ))}
        </p>
      )}

      {error && <p className="error">{messageFor(error)}</p>}

      {hasSearchCriteria(parsed) &&
        !searching &&
        results.length === 0 &&
        similar.length === 0 &&
        !error && <p className="muted">{t('search.nothing')}</p>}

      {/* Folders first, as in the sidebar and in a folder's own view. A filing
          system that orders one way in one place and another elsewhere makes
          people hunt. */}
      <Group
        label={t('search.folders')}
        results={results.filter((result) => result.kind === 'folder')}
      />
      <Group
        label={t('search.pages')}
        results={results.filter((result) => result.kind !== 'folder')}
      />

      {/* Names that are close, in a list of their own (ADR-0036).
        *
        * Never mixed into the groups above: those are ordered by how well they
        * matched, these by how close the spelling is, and one list ordered by two
        * measures cannot be reasoned about. The heading says which this is. */}
      {similar.length > 0 && (
        <section className="search-group">
          <h2 className="sidebar-label">
            {results.length === 0 ? t('search.didYouMean') : t('search.similar')}
          </h2>
          <ul className="search-results">
            {similar.map((entry) => (
              <li key={entry.pageId}>
                <a className="search-hit" href={paths.page(entry.pageId, entry.title)}>
                  <span className="search-hit-head">
                    <EntryIconView
                      icon={entry.icon}
                      kind={entryKind(entry.kind)}
                    />
                    <span className="search-hit-title" style={titleColorStyle(entry.icon)}>
                      {entry.title || 'Untitled'}
                    </span>
                  </span>
                  {entry.trail.length > 0 && (
                    <span className="search-hit-path">
                      {entry.trail.map((step) => step.title || 'Untitled').join(' / ')}
                    </span>
                  )}
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function Group({
  label,
  results,
}: {
  label: string;
  results: SearchResult[];
}): ReactElement | null {
  const { t } = useT();
  // Hidden entirely when empty rather than shown as a heading over nothing,
  // which takes space to say there are none of something nobody asked about.
  if (results.length === 0) return null;

  return (
    <section className="search-group">
      <h2 className="sidebar-label">{label}</h2>
      <ul className="search-results">
        {results.map((result) => (
          <li key={result.pageId}>
            <a
              className="search-hit"
              // At the block that matched, where there is one, so a hit in the
              // middle of a long page does not land at the top of it.
              href={paths.page(result.pageId, result.title, result.blockId)}
            >
              <span className="search-hit-head">
                <EntryIconView
                  icon={result.icon}
                  kind={entryKind(result.kind)}
                />
                <span className="search-hit-title" style={titleColorStyle(result.icon)}>
                  {result.title || 'Untitled'}
                </span>
                {/* Said, not inferred. A rank number means nothing to a reader,
                    and "why is this here" is the question a search result has to
                    answer before any other. */}
                {result.titleMatch && <span className="search-hit-why">{t('search.matchedTitle')}</span>}
              </span>

              {result.trail.length > 0 && (
                <span className="search-hit-path">
                  {result.trail.map((step) => step.title || 'Untitled').join(' / ')}
                </span>
              )}

              {result.snippet && (
                <span className="search-hit-snippet">
                  <Snippet text={result.snippet} />
                </span>
              )}
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * A passage with its match marked.
 *
 * Split rather than rendered as HTML. The delimiters are control characters for
 * exactly this reason: the text comes out of somebody's document, and putting it
 * through `innerHTML` to get two tags would be a stored-XSS hole (ADR-0033).
 *
 * An odd index is inside a match, because the split alternates: text, match,
 * text, match. A snippet with an unbalanced delimiter therefore degrades to
 * plain text rather than to nothing.
 */
function Snippet({ text }: { text: string }): ReactElement {
  const parts = text.split(MATCH_OPEN).flatMap((chunk, at) =>
    at === 0 ? [chunk] : chunk.split(MATCH_CLOSE),
  );

  return (
    <>
      {parts.map((part, at) =>
        at % 2 === 1 ? <mark key={at}>{part}</mark> : <span key={at}>{part}</span>,
      )}
    </>
  );
}
