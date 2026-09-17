/**
 * SONE server — what an import would do (ADR-0044).
 *
 * A plan, not an import. Read the archive, work out the pages and folders it
 * implies, name every collision and everything being skipped, and hand that back
 * — so somebody can look at it before anything is written.
 *
 * The record is emphatic about why: an import that has created two hundred pages
 * by the time somebody notices it mangled the hierarchy is worse than no import,
 * because undoing it is two hundred deletions and the trash was not built for
 * that many arrivals at once.
 *
 * This module knows nothing about the database. It is given what already exists
 * and returns a description; the caller decides whether to execute it.
 */

import type { ArchiveEntry } from './unzip.js';

export interface PlannedPage {
  /** Where it goes, relative to the chosen destination. */
  path: string[];
  title: string;
  /** A folder, because the archive has something inside it. */
  isFolder: boolean;
  /** The Markdown, for a page. Empty for a folder created only to hold others. */
  markdown: string;
  /** An existing page of the same name in the same place, if any. */
  collidesWith: string | null;
  /** The look the archive carries for it, or null (ADR-0190, ADR-0191). */
  entry?: ImportedEntry | null;
}

export interface PlannedAttachment {
  /** The name inside the archive, which our own export writes as a file id. */
  name: string;
  bytes: number;
}

export interface ImportPlan {
  pages: PlannedPage[];
  attachments: PlannedAttachment[];
  /** What is not being imported, and why — one line each, in the archive's own names. */
  skipped: Array<{ name: string; reason: 'not_markdown' | 'empty' | 'too_deep' }>;
  /** Totals, so the interface does not have to count what it is about to show. */
  totals: { pages: number; folders: number; attachments: number; bytes: number };
}

/** How deep a tree an import may create. Deeper than this is a mistake, not a plan. */
export const MAX_DEPTH = 12;

/**
 * What exists already, for naming collisions.
 *
 * Paths relative to the destination, lowercased, because two pages whose titles
 * differ only in case are the same page to a person looking at a sidebar.
 */
export interface Existing {
  /** `['Folder', 'Page']` → the page's id. */
  byPath: Map<string, string>;
}

const key = (path: string[]): string => path.map((part) => part.toLowerCase()).join('/');

/**
 * Read a title out of Markdown, or fall back to the file name.
 *
 * The first `# ` heading, because that is what our own export writes and what
 * every other tool writes too. Not the file name when a heading is there: a file
 * called `2026-09-02.md` whose heading says "Kick-off" should arrive as
 * "Kick-off", and the date is in the file name for sorting.
 */
export function titleFrom(markdown: string, fallback: string): string {
  const heading = /^#\s+(.+)$/m.exec(markdown);
  const title = (heading?.[1] ?? fallback).trim();
  return title === '' ? fallback : title;
}

/**
 * Strip the title heading from the body.
 *
 * It becomes the page's title, and leaving it in the body would give every
 * imported page its own name written twice — once as the title and once as a
 * heading under it.
 */
export function bodyWithoutTitle(markdown: string): string {
  return markdown.replace(/^#\s+.+\n+/, '').replace(ENTRY_COMMENT, '');
}

/** The look our export writes under the title (ADR-0190). */
const ENTRY_COMMENT = /^<!--\s*sone-entry\s+(\{.*\})\s*-->\n*/m;

/**
 * The entry's look, if the archive carries one: the raw `icon` value, to be
 * validated by the same readers the icon route uses when it is written.
 */
export interface ImportedEntry {
  icon?: unknown;
  cover?: unknown;
  width?: unknown;
  template?: boolean;
  locked?: boolean;
}

export function entryFrom(markdown: string): ImportedEntry | null {
  const match = ENTRY_COMMENT.exec(markdown);
  if (!match) return null;
  try {
    const parsed: unknown = JSON.parse(match[1] ?? '{}');
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const raw = parsed as Record<string, unknown>;
      const entry: ImportedEntry = {};
      if ('icon' in raw) entry.icon = raw['icon'];
      if ('cover' in raw) entry.cover = raw['cover'];
      if ('width' in raw) entry.width = raw['width'];
      if (raw['template'] === true) entry.template = true;
      if (raw['locked'] === true) entry.locked = true;
      return Object.keys(entry).length > 0 ? entry : null;
    }
  } catch {
    // A comment we wrote and cannot read back: the page keeps its default look.
  }
  return null;
}

export function planImport(entries: ArchiveEntry[], existing: Existing): ImportPlan {
  const skipped: ImportPlan['skipped'] = [];
  const pages: PlannedPage[] = [];
  /** Folders the archive implies, whether or not it has an index for them. */
  const folders = new Map<string, string[]>();

  for (const entry of entries) {
    const parts = entry.name.split('/').filter((part) => part !== '');

    if (entry.name.startsWith('attachments/')) continue;

    if (!entry.name.toLowerCase().endsWith('.md')) {
      // Not refused — noted. An archive from somewhere else carries a stylesheet
      // and a picture of a cat, and telling somebody what will not come is more
      // use than refusing the whole thing.
      skipped.push({ name: entry.name, reason: 'not_markdown' });
      continue;
    }
    if (parts.length > MAX_DEPTH) {
      skipped.push({ name: entry.name, reason: 'too_deep' });
      continue;
    }

    const markdown = entry.body.toString('utf8');
    const fileName = (parts.at(-1) ?? '').replace(/\.md$/i, '');
    // An `index.md` is the folder it sits in, which is what our own export
    // writes for a folder — so its path is its directory, not a page inside it.
    const isIndex = fileName.toLowerCase() === 'index';
    const path = isIndex ? parts.slice(0, -1) : [...parts.slice(0, -1), fileName];

    if (path.length === 0) {
      // An `index.md` at the root of the archive describes the destination
      // itself, which an import must not rename.
      skipped.push({ name: entry.name, reason: 'empty' });
      continue;
    }

    for (let depth = 1; depth < path.length; depth += 1) {
      const branch = path.slice(0, depth);
      folders.set(key(branch), branch);
    }

    pages.push({
      path,
      title: titleFrom(markdown, fileName),
      isFolder: isIndex,
      markdown: bodyWithoutTitle(markdown),
      collidesWith: existing.byPath.get(key(path)) ?? null,
      entry: entryFrom(markdown),
    });
  }

  // Folders the archive implies but has no index for — a page at `A/B/C.md`
  // needs A and B to exist. Added as folders with no body, and only when no
  // index already claimed that path.
  const claimed = new Set(pages.map((page) => key(page.path)));
  for (const [id, branch] of folders) {
    if (claimed.has(id)) continue;
    pages.push({
      path: branch,
      title: branch.at(-1) ?? '',
      isFolder: true,
      markdown: '',
      collidesWith: existing.byPath.get(id) ?? null,
    });
  }

  // Shallowest first, so a parent always exists before the page that needs it.
  // The executor depends on this order rather than sorting again, and the
  // comment is here because the dependency is invisible from there.
  pages.sort((a, b) => a.path.length - b.path.length || a.path.join('/').localeCompare(b.path.join('/')));

  const attachments = entries
    .filter((entry) => entry.name.startsWith('attachments/'))
    .map((entry) => ({ name: entry.name.slice('attachments/'.length), bytes: entry.body.length }))
    .filter((attachment) => attachment.name !== '');

  return {
    pages,
    attachments,
    skipped,
    totals: {
      pages: pages.filter((page) => !page.isFolder).length,
      folders: pages.filter((page) => page.isFolder).length,
      attachments: attachments.length,
      bytes: attachments.reduce((sum, attachment) => sum + attachment.bytes, 0),
    },
  };
}
