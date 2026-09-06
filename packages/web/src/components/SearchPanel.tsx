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
 */

import {
  buildSearchQuery,
  hasSearchCriteria,
  parseSearchQuery,
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

  const chosenFolders = foldersIn(folders);
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

      {tags.length > 0 && (
        <section className="search-facet">
          <h2 className="sidebar-label">{t('search.facet.tags')}</h2>
          <div className="search-facet-tags">
            {tags.map((tag) => (
              <button
                key={tag.key}
                type="button"
                className="search-facet-tag"
                data-color={tag.color}
                aria-pressed={has(filters.tags, tag.key)}
                onClick={() => toggle((f) => f.tags, tag.key)}
              >
                {tag.label}
                <span className="search-facet-count">{tag.count}</span>
              </button>
            ))}
          </div>
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

      {chosenFolders.length > 0 && (
        <section className="search-facet">
          <h2 className="sidebar-label">{t('search.facet.in')}</h2>
          <select
            className="search-facet-select"
            aria-label={t('search.facet.in')}
            value={filters.in[0] ?? ''}
            onChange={(event) =>
              edit((f) => {
                f.in.length = 0;
                if (event.target.value !== '') f.in.push(event.target.value.toLowerCase());
              })
            }
          >
            <option value="">{t('search.facet.anywhere')}</option>
            {chosenFolders.map((folder) => (
              <option key={folder.id} value={folder.title ?? ''}>
                {folder.title || t('folder.untitled')}
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
