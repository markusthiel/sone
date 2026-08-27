/**
 * SONE web — search.
 *
 * Debounced, and requests are superseded rather than cancelled: an out-of-order
 * response from a slower earlier query would otherwise overwrite the newer one,
 * which looks like search returning the wrong results.
 */

import { useEffect, useRef, useState , type ReactElement } from 'react';

import { ApiError, api, type SearchResult } from '../api/client.ts';
import { paths } from '../routes/paths.ts';
import { messageFor } from './Auth.tsx';

export function SearchScreen({
  workspaceId,
  initialQuery,
}: {
  workspaceId: string;
  initialQuery: string;
}): ReactElement {
  const [query, setQuery] = useState(initialQuery);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);
  const requestId = useRef(0);

  useEffect(() => {
    if (query.trim().length < 2) {
      setResults([]);
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

      {query.trim().length >= 2 && !searching && results.length === 0 && !error && (
        <p className="muted">No pages matched.</p>
      )}

      <ul style={{ listStyle: 'none', padding: 0 }}>
        {results.map((result) => (
          <li key={result.pageId} style={{ marginBlock: 8 }}>
            <a href={paths.page(result.pageId, result.title)}>
              {result.icon?.kind === 'emoji' ? `${result.icon.value} ` : ''}
              {result.title || 'Untitled'}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}
