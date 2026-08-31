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

import { useEffect, useRef, useState, type ReactElement } from 'react';

import {
  ApiError,
  MATCH_CLOSE,
  MATCH_OPEN,
  api,
  type SearchResult,
  type SimilarName,
} from '../api/client.ts';
import { paths } from '../routes/paths.ts';
import { messageFor } from './Auth.tsx';
import { EntryIconView, titleColorStyle } from './EntryIconView.tsx';

export function SearchScreen({
  workspaceId,
  initialQuery,
}: {
  workspaceId: string;
  initialQuery: string;
}): ReactElement {
  const [query, setQuery] = useState(initialQuery);
  const [results, setResults] = useState<SearchResult[]>([]);
  /** Names that are close, offered only when the search found little. */
  const [similar, setSimilar] = useState<SimilarName[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);
  const requestId = useRef(0);

  useEffect(() => {
    if (query.trim().length < 2) {
      setResults([]);
      setSimilar([]);
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
      <h1>Search</h1>
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search pages…"
        aria-label="Search pages"
        autoFocus
        type="search"
      />

      {error && <p className="error">{messageFor(error)}</p>}

      {query.trim().length >= 2 &&
        !searching &&
        results.length === 0 &&
        similar.length === 0 &&
        !error && <p className="muted">Nothing matched.</p>}

      {/* Folders first, as in the sidebar and in a folder's own view. A filing
          system that orders one way in one place and another elsewhere makes
          people hunt. */}
      <Group
        label="Folders"
        results={results.filter((result) => result.kind === 'folder')}
      />
      <Group
        label="Pages"
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
            {results.length === 0 ? 'Did you mean' : 'Similar names'}
          </h2>
          <ul className="search-results">
            {similar.map((entry) => (
              <li key={entry.pageId}>
                <a className="search-hit" href={paths.page(entry.pageId, entry.title)}>
                  <span className="search-hit-head">
                    <EntryIconView
                      icon={entry.icon}
                      kind={entry.kind === 'folder' ? 'folder' : 'page'}
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
                  kind={result.kind === 'folder' ? 'folder' : 'page'}
                />
                <span className="search-hit-title" style={titleColorStyle(result.icon)}>
                  {result.title || 'Untitled'}
                </span>
                {/* Said, not inferred. A rank number means nothing to a reader,
                    and "why is this here" is the question a search result has to
                    answer before any other. */}
                {result.titleMatch && <span className="search-hit-why">title</span>}
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
