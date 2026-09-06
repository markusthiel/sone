/**
 * SONE web — HTTP API client.
 *
 * Thin and typed. Two conventions that matter:
 *
 * `credentials: 'same-origin'` on every request, because the session lives in
 * an HttpOnly cookie and `fetch` does not send cookies by default on all
 * paths. Forgetting it produces a 401 that looks like a broken login.
 *
 * Errors carry a code, never a sentence (ADR-0011). `ApiError.code` is what the
 * UI translates; the HTTP status is for deciding *what kind* of thing went
 * wrong, not for display.
 */

import type {
  DiffBlock,
  EntryCover,
  EntryIcon,
  Role,
  WordChange,
  WorkspaceTheme,
} from '@sone/core';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    /**
     * A technical reason, sent only to instance administrators.
     *
     * Kept separate from `code`, which is looked up in the message catalogue:
     * this is a path and an errno, useful to whoever is fixing a deployment and
     * meaningless to anybody else.
     */
    readonly detail?: string,
  ) {
    // The message is for the console. The UI renders `code` through the
    // message catalogue.
    super(`${status} ${code}`);
    this.name = 'ApiError';
  }

  get isAuthError(): boolean {
    return this.status === 401;
  }
}

/**
 * Bytes, for a field that has to travel as JSON.
 *
 * A relative position is opaque bytes (ADR-0046) and JSON has no way to carry
 * them. Chunked rather than spread into one `String.fromCharCode` call, which
 * throws on a long enough array — an anchor is short today, and "short today"
 * is how that bug is written.
 */
function base64(bytes: Uint8Array): string {
  let binary = '';
  for (let at = 0; at < bytes.length; at += 1024) {
    binary += String.fromCharCode(...bytes.subarray(at, at + 1024));
  }
  return btoa(binary);
}

async function request<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const response = await fetch(path, {
    ...init,
    credentials: 'same-origin',
    headers: {
      ...(init.body ? { 'content-type': 'application/json' } : {}),
      ...(init.headers ?? {}),
    },
  });

  if (response.status === 204) return undefined as T;

  let body: unknown = null;
  const text = await response.text();
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      // A non-JSON body from our own API means something upstream replaced the
      // response — a proxy error page, most likely.
      throw new ApiError(response.status, 'unexpected_response');
    }
  }

  if (!response.ok) {
    const code =
      body && typeof body === 'object' && typeof (body as { error?: unknown }).error === 'string'
        ? (body as { error: string }).error
        : 'unknown_error';
    throw new ApiError(response.status, code);
  }

  return body as T;
}

const post = <T>(path: string, body?: unknown): Promise<T> =>
  request<T>(path, { method: 'POST', ...(body ? { body: JSON.stringify(body) } : {}) });

// --- types -----------------------------------------------------------------

/** What an instance looks like, before anybody has signed in (ADR-0123). */
export interface Brand {
  name: string;
  theme: WorkspaceTheme;
  /** Where the mark is, with the storage key in the address. Null: draw ours. */
  logo: string | null;
}

export interface InstanceInfo {
  needsSetup: boolean;
  signupMode: 'open' | 'invite' | 'closed';
  suggestedLocale: string;
  /** "du" or "Sie", where a language distinguishes it (ADR-0041). */
  addressForm?: 'informal' | 'formal';
  /** Whether a forgotten password can be reset — false with no relay (ADR-0059). */
  canResetPassword?: boolean;
  /** What this instance looks like (ADR-0123). */
  brand?: Brand;
}

/** How a workspace is recognised in a list (ADR-0030). */
export interface WorkspaceIcon {
  icon?: string;
  iconColor?: string;
  titleColor?: string;
}

export interface SessionInfo {
  user: {
    id: string;
    email: string | null;
    displayName: string;
    isGuest: boolean;
    /** Whether to be emailed, per kind (ADR-0058). */
    /** Whether an authenticator is enrolled and confirmed (ADR-0063). */
    hasSecondFactor?: boolean;
    /** Where this account stands against the requirement (ADR-0065). */
    secondFactorStanding?:
      | { kind: 'fine' }
      | { kind: 'grace'; deadline: string }
      | { kind: 'blocked' };
    /** Everything visible, or only what is watched (ADR-0064). */
    digestScope?: 'all' | 'watched';
    /** When each kind is worth a mail (ADR-0061, amended). */
    mentionsWhen?: 'immediately' | 'daily' | 'off';
    assignmentsWhen?: 'immediately' | 'daily' | 'off';
    repliesWhen?: 'immediately' | 'daily' | 'off';
    /** A mail about what changed, off unless chosen (ADR-0062). */
    activityDigest?: 'off' | 'daily' | 'weekly';
    locale: string | null;
    timezone: string | null;
    isInstanceAdmin: boolean;
    /** May administer every workspace. Implied by isInstanceAdmin (ADR-0027). */
    canManageWorkspaces: boolean;
  };
  workspaces: Array<{
    id: string;
    name: string;
    /** One of the four system words, or 'custom' for a role this workspace made. */
    role: string;
    /** What that role is called. A custom role has a name and no word (ADR-0102). */
    roleName: string;
    /**
     * What the caller may administer here — their own role's rights and every
     * group's, unioned as the server unions them (ADR-0026).
     *
     * Sent so a screen can ask the question the route asks. Deciding from
     * `role` instead is how somebody holding `workspace.settings` through a
     * custom role got a screen of disabled controls (ADR-0102).
     */
    rights: string[];
    /** Transferring and deleting the workspace. Not a right (ADR-0087). */
    isOwner: boolean;
    default_locale: string;
    /** Null until somebody chooses one (ADR-0030). */
    icon: WorkspaceIcon | null;
  }>;
}

/** A folder organises; a page holds writing (ADR-0019). */
/**
 * What an entry is, as the tree needs to know it.
 *
 * A row is not here: a row is a page of a collection and never appears in the
 * tree (ADR-0021). A canvas does (ADR-0043) — it is a page with a different
 * body, so it is in the tree, the trash and the search like any other.
 */
export type EntryKind = 'page' | 'folder' | 'canvas';

export interface PageSummary {
  id: string;
  parentPageId: string | null;
  collectionId: string | null;
  idx: string;
  /**
   * Null for a page kept only as the path to a child (ADR-0026).
   *
   * Typed as a plain string until now, which was a lie the compiler could not
   * catch because the case was unreachable: the server withheld the title and
   * then the row was filtered out before it left. Now that such a page arrives,
   * the null is real, and every place that draws a title has to say what it
   * draws instead.
   */
  title: string | null;
  /**
   * This page is here as a *path*, not as a page.
   *
   * Somebody was granted something inside it and nothing here. It has to appear
   * or the child is reachable only by knowing its address — and it must not
   * offer anything, because there is nothing here they may do.
   */
  pathOnly?: boolean;
  /**
   * What this person may do with this entry (ADR-0095).
   *
   * Sent by the tree route, which was already computing it once per row to
   * decide which rows to send at all — and throwing it away. Without it every
   * entry looked alike to the shell, so a folder somebody may only read got a
   * rename field and three create buttons, each of which the server answers
   * 403 to.
   *
   * Null for a page kept only as a path: they may do nothing with the row
   * itself, and "no role" is the honest answer rather than a missing field.
   */
  role: Role | null;
  icon: { kind: string; value: string; color?: string; titleColor?: string } | null;
  /**
   * A picture, a colour or a gradient above the heading (ADR-0117).
   *
   * On the tree row because a folder draws its own and has no document open —
   * it renders this node, the same way it renames through a route. Absent for
   * the great majority of entries, which have none.
   */
  cover?: EntryCover | null;
  kind: EntryKind;
  /** Offered as a shape to start from (ADR-0045). */
  template?: boolean;
  /** Locked against accidental editing (ADR-0049). */
  locked?: boolean;
  archived: boolean;
  lastEditedAt: string;
}

export type LandingMode = 'last' | 'top' | 'newest' | 'fixed';

export interface PageDetail extends Omit<PageSummary, 'archived' | 'idx'> {
  /* kind is inherited from PageSummary. */
  workspaceId: string;
  /** 'column' or 'full'; null follows the reader's default. */
  width?: 'column' | 'full' | null;
  archived: boolean;
  createdAt: string;
  breadcrumb: string[];
  role: 'viewer' | 'commenter' | 'editor' | 'admin';
}

export interface AdminOverview {
  version: string;
  commit: string;
  counts: {
    users: number;
    admins: number;
    deactivated: number;
    workspaces: number;
    pages: number;
    folders: number;
    files: number;
    fileBytes: number;
  };
  settings: InstanceSettings;
  settingSources: Record<string, 'database' | 'environment'>;
}

export interface InstanceSettings {
  signupMode: 'open' | 'invite' | 'closed';
  instanceName: string;
  allowWorkspaceCreation: boolean;
  defaultLocale: string;
  /** "du" or "Sie", where a language distinguishes it (ADR-0041). */
  addressForm: 'informal' | 'formal';
  /**
   * Where mail goes, if anywhere (ADR-0058).
   *
   * An empty host means no email: notifications stay in the inbox and nothing
   * is sent. The password is not here and never will be — it stays in the
   * environment, because a secret in a table is a secret in every backup
   * (ADR-0024).
   */
  smtpHost: string;
  smtpPort: string;
  smtpUser: string;
  smtpFrom: string;
  smtpSecurity: 'starttls' | 'tls' | 'none';
  emailDetail: 'title' | 'workspace';
  /** The base design every workspace's theme sits on (ADR-0123). */
  brandTheme: WorkspaceTheme;
  /** Whether everybody needs a second factor, and since when (ADR-0065). */
  requireSecondFactor: boolean;
  requireSecondFactorSince: string;
  /** Where replies are read from — an empty host means none (ADR-0060). */
  imapHost: string;
  imapPort: string;
  imapUser: string;
  imapFolder: string;
  replyMailbox: string;
}

export interface AdminUser {
  id: string;
  email: string | null;
  displayName: string;
  isInstanceAdmin: boolean;
  /** May administer every workspace. Implied by isInstanceAdmin (ADR-0027). */
  canManageWorkspaces: boolean;
  isGuest: boolean;
  deactivatedAt: string | null;
  createdAt: string;
  workspaceCount: number;
  isSelf: boolean;
}

export interface AdminWorkspace {
  /** Somebody's own, rather than a team's (ADR-0025). */
  personal: boolean;
  /** Marked for deletion, and still restorable (ADR-0027). */
  deletedAt: string | null;
  /** How it is recognised in a list (ADR-0030). */
  icon: WorkspaceIcon | null;
  lastEditedAt: string | null;
  id: string;
  name: string;
  createdAt: string;
  memberCount: number;
  pageCount: number;
  owner: string | null;
}

export interface MaintenanceReport {
  storage: { writable: boolean; problem: string | null };
  counts: {
    orphanedPages: number;
    staleSearchRows: number;
    entriesInsidePages: number;
    failedMaterialisations: number;
    /** Notification emails the relay refused, after their retries (ADR-0058). */
    failedMail?: number;
    /** The password cost, when it is below the recommendation (ADR-0010). */
    weakPasswordCost?: number;
    pendingMaterialisations: number;
  };
  failures: Array<{ pageId: string; error: string | null }>;
}

/** A column. `config` is type-specific: select options, and so on. */
export interface CollectionField {
  id: string;
  name: string;
  description: string | null;
  fieldType: string;
  config: Record<string, unknown>;
}

export interface CollectionRow {
  id: string;
  title: string;
  /** Keyed by field id. Absent means no value, which is not the same as empty. */
  values: Record<string, StoredCellValue | undefined>;
  /**
   * What the server computed, keyed by field id (ADR-0054).
   *
   * Separate from `values` on purpose: those come out of the document and can be
   * written, these are derived and cannot. One bag holding both would be a cell
   * somebody could type into whose value the server decides.
   */
  derived?: Record<string, DerivedCellValue | undefined>;
}

/** A rollup's answer: rows, or a number, and whether anything was left out. */
export interface DerivedCellValue {
  kind: 'derived';
  rows?: Array<{ id: string; title: string }>;
  number?: number | null;
  /** Values from the linked rows, for a lookup. */
  texts?: string[];
  /** Something was excluded because the reader may not see it (ADR-0054). */
  partial?: boolean;
  /** A formula that could not be worked out, by reason (ADR-0056). */
  error?: string;
  errorDetail?: string;
}

/**
 * A cell value, tagged with the kind it holds.
 *
 * The tag is not redundant with the column's type: a column can be changed, and
 * values written before that are still the old kind until something rewrites
 * them. A reader has to know what it is holding.
 */
/** A file a cell refers to, resolved by the collection response (ADR-0035). */
export interface CollectionFile {
  id: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  /** 'image' | 'pdf' | 'text' | 'document' | 'archive', decided by the server. */
  category: string;
}

export type StoredCellValue =
  | { kind: 'text'; value: string }
  | { kind: 'files'; fileIds: string[] }
  | { kind: 'number'; value: number }
  | { kind: 'checkbox'; value: boolean }
  | { kind: 'date'; start: string; end: string | null }
  | { kind: 'url'; value: string }
  | { kind: 'email'; value: string }
  | { kind: 'phone'; value: string }
  | { kind: string; [key: string]: unknown };

export interface CollectionView {
  id: string;
  name: string;
  viewType: string;
  /** For a board: `groupByFieldId`. */
  definition: Record<string, unknown>;
}

export interface CollectionData {
  /** Where the next page starts, or null at the end (ADR-0055). */
  nextCursor?: string | null;
  /** True when this view had to fetch every row to sort it. */
  sortedInMemory?: boolean;
  /** How many rows match, capped — see `totalIsExact` (ADR-0055). */
  total?: number;
  totalIsExact?: boolean;
  pageId: string;
  collectionId: string;
  titleFieldId: string;
  canEdit: boolean;
  views: CollectionView[];
  fields: CollectionField[];
  rows: CollectionRow[];
  /**
   * What the files in these cells are, by id.
   *
   * Resolved once for the table rather than stored in each cell: a name and a
   * size are the file's own facts, and copying them into every cell that
   * mentions one is how a renamed file keeps its old name in three places.
   */
  files?: CollectionFile[];
}

export interface TrashEntry {
  id: string;
  title: string;
  kind: EntryKind;
  archivedAt: string;
  /** How much went with it, so restoring is not a surprise. */
  descendants: number;
  /** Restoring would put it back somewhere that no longer exists. */
  parentMissing: boolean;
}

export interface ShareLink {
  id: string;
  scopePageId: string;
  includeSubtree: boolean;
  role: 'viewer' | 'commenter' | 'editor';
  hasPassword: boolean;
  allowAnonymous: boolean;
  activeSessions: number;
  expiresAt: string | null;
  createdAt: string;
}

/** Returned once, when a link is created. The token is never listed again. */
export interface CreatedShareLink {
  id: string;
  token: string;
  url: string;
  expiresAt: string | null;
}

export interface WorkspaceTag {
  /** Normalised, for matching. */
  key: string;
  /** As typed, for showing. */
  label: string;
  count: number;
  /** A palette name. Derived from the tag's name unless somebody chose one. */
  color: string;
  /** False when the colour is the derived one, so a picker can say "default". */
  colorChosen: boolean;
}

export interface FavouriteEntry {
  pageId: string;
  title: string;
  kind: EntryKind;
  /** The same shape a page carries in the tree, so both draw it the same way. */
  icon: { kind: string; value: string; color?: string; titleColor?: string } | null;
  workspaceId: string;
  idx: string;
}

/**
 * The filters a search actually used.
 *
 * From the server rather than re-derived, because this is the version that was
 * applied — the only one worth showing above a list of results.
 */
export interface AppliedFilters {
  /** Folder names, and how many folders they matched (ADR-0050). */
  in?: string[];
  inMatched?: number;
  tags: string[];
  authors: string[];
  assigned: string[];
  after: string | null;
  before: string | null;
  unreadable: Array<{ prefix: string; value: string; reason: 'not_a_date' }>;
}

export interface WorkspaceSummary {
  id: string;
  name: string;
  /** One of the four system words, or 'custom' (ADR-0102). */
  role: string;
  roleName: string;
  /** The union of the caller's own role's rights and their groups' (ADR-0102). */
  rights: string[];
  isOwner: boolean;
  defaultLocale: string;
  pageCount: number;
  memberCount: number;
  /** Null until somebody chooses one (ADR-0030). */
  icon: WorkspaceIcon | null;
}

export interface WorkspaceMember {
  userId: string;
  displayName: string;
  /** Null unless the caller administers the workspace. */
  email: string | null;
  /** One of the four system words, or 'custom' for a role this workspace made. */
  role: string;
  /** Which role row they hold, so a picker can select the right one. */
  roleId: string | null;
  /** What that role is called, which is the only name a custom one has. */
  roleName: string;
  isGuest: boolean;
  joinedAt: string;
}

/**
 * A role as the settings screen sees it (ADR-0087).
 *
 * `key` is present only on the four system roles, and its presence is what says
 * they cannot be edited — rather than a separate flag, which would be a second
 * way of saying the same thing and a second thing to keep in step.
 */
export interface WorkspaceRoleRow {
  id: string;
  key: string | null;
  name: string;
  /** Null means the role gives nothing without an explicit page grant. */
  pageLevel: string | null;
  rights: string[];
  members: number;
  groups: number;
}

export interface SearchResult {
  pageId: string;
  title: string;
  /** A folder is drawn as a folder (ADR-0019). */
  kind: string;
  icon: { kind: string; value: string; color?: string; titleColor?: string } | null;
  /** Where it lives, outermost first. Titles, because ids cannot be shown. */
  trail: Array<{ pageId: string; title: string }>;
  /** Whether what matched was the title, said rather than inferred from a rank. */
  titleMatch: boolean;
  /**
   * The matching passage, with the match between U+0002 and U+0003 (ADR-0033).
   *
   * Never HTML: rendering markup built from document content would mean
   * innerHTML on it. Split on the two characters and build elements.
   */
  snippet: string | null;
  /** The block the passage came from, so a result can land on it. */
  blockId: string | null;
  rank: number;
}

/**
 * A name close enough to be worth offering (ADR-0036).
 *
 * Deliberately less than a result: no snippet, no rank. There is nothing honest
 * to say beyond the name being close, and a number would invite comparison with
 * results that were measured differently.
 */
export interface SimilarName {
  pageId: string;
  title: string;
  kind: string;
  icon: { kind: string; value: string; color?: string; titleColor?: string } | null;
  trail: Array<{ pageId: string; title: string }>;
}

/** The delimiters `ts_headline` marks a match with. */
export const MATCH_OPEN = '\u0002';
export const MATCH_CLOSE = '\u0003';

/** An invitation that has not been used up, withdrawn or expired. */
export interface PendingInvitation {
  id: string;
  /** Null means anybody with the link. */
  email: string | null;
  role: string;
  uses: number;
  maxUses: number;
  expiresAt: string;
}

export interface VersionInfo {
  version: string;
  commit: string;
  /** Document format version. Determines which clients can open documents. */
  documentSchema: number;
  /** Sync protocol version. Determines which clients can connect. */
  syncProtocol: number;
}

export interface InvitationInfo {
  workspaceName: string;
  email: string | null;
  role: string;
  remainingUses: number;
}

// --- endpoints -------------------------------------------------------------

export const api = {
  instance: () => request<InstanceInfo>('/api/instance'),

  // Unauthenticated: the version is not a secret, and being able to read it
  // without logging in is what makes it useful when something is wrong.
  version: () => request<VersionInfo>('/api/version'),

  session: () => request<SessionInfo>('/api/auth/session'),

  setup: (input: {
    email: string;
    password: string;
    displayName: string;
    workspaceName: string;
  }) => post<{ userId: string; workspaceId: string }>('/api/auth/setup', input),

  /**
   * Sign in, which may stop half way (ADR-0063).
   *
   * An account with a second factor answers with a ticket instead of a cookie;
   * the caller then calls `secondFactorLogin`. The empty 204 is what an account
   * without one still gets, so the shape says which happened.
   */
  login: (input: { email: string; password: string }) =>
    post<{ needsSecondFactor?: boolean; ticket?: string } | void>('/api/auth/login', input),

  signup: (input: {
    email: string;
    password: string;
    displayName: string;
    invitationToken?: string;
  }) => post<{ userId: string; workspaceId: string }>('/api/auth/signup', input),

  invitation: (token: string) =>
    request<InvitationInfo>(`/api/auth/invitation/${encodeURIComponent(token)}`),

  logout: () => post<void>('/api/auth/logout'),

  workspaces: () => request<{ workspaces: WorkspaceSummary[] }>('/api/workspaces'),

  /**
   * Place a workspace directly after another in the caller's own order.
   *
   * `afterWorkspaceId` null means first. Unlike `moveEntry` there is no "no
   * opinion" form: a drag always landed somewhere (ADR-0031).
   */
  reorderWorkspace: (workspaceId: string, afterWorkspaceId: string | null) =>
    post<{ workspaceId: string; idx: string }>('/api/workspaces/reorder', {
      workspaceId,
      afterWorkspaceId,
    }),

  createWorkspace: (name: string) =>
    post<{ id: string; name: string; role: string; defaultFolderId: string | null }>(
      '/api/workspaces',
      { name },
    ),

  renameWorkspace: (workspaceId: string, name: string) =>
    request<{ id: string; name: string }>(`/api/workspaces/${workspaceId}`, {
      method: 'PATCH',
      body: JSON.stringify({ name }),
    }),

  /** A workspace's own defaults for how elements look. */
  workspaceTheme: (workspaceId: string) =>
    request<{ theme: WorkspaceTheme }>(`/api/workspaces/${workspaceId}/theme`),

  setWorkspaceTheme: (workspaceId: string, theme: WorkspaceTheme) =>
    request<{ theme: WorkspaceTheme }>(`/api/workspaces/${workspaceId}/theme`, {
      method: 'PUT',
      body: JSON.stringify({ theme }),
    }),

  groups: (workspaceId: string) =>
    request<{
      groups: Array<{
        id: string;
        name: string;
        members: number;
        roleId: string | null;
        roleName: string | null;
      }>;
    }>(
      `/api/workspaces/${workspaceId}/groups`,
    ),

  createGroup: (workspaceId: string, name: string) =>
    request<{ id: string; name: string; members: number }>(
      `/api/workspaces/${workspaceId}/groups`,
      { method: 'POST', body: JSON.stringify({ name }) },
    ),

  groupMembers: (groupId: string) =>
    request<{ members: Array<{ userId: string; displayName: string }> }>(
      `/api/groups/${groupId}/members`,
    ),

  addToGroup: (groupId: string, userId: string) =>
    request<{ ok: true }>(`/api/groups/${groupId}/members/${userId}`, { method: 'PUT' }),

  removeFromGroup: (groupId: string, userId: string) =>
    request<{ ok: true }>(`/api/groups/${groupId}/members/${userId}`, { method: 'DELETE' }),

  /** Confirm is required once any page has granted the group access. */
  deleteGroup: (groupId: string, confirm = false) =>
    request<{ ok: true; revokedFrom: number }>(
      `/api/groups/${groupId}${confirm ? '?confirm=true' : ''}`,
      { method: 'DELETE' },
    ),

  grantPageAccessToGroup: (pageId: string, groupId: string, access: string) =>
    request<{ ok: true }>(`/api/pages/${pageId}/groups/${groupId}`, {
      method: 'PUT',
      body: JSON.stringify({ access }),
    }),

  revokePageAccessFromGroup: (pageId: string, groupId: string) =>
    request<{ ok: true }>(`/api/pages/${pageId}/groups/${groupId}`, { method: 'DELETE' }),

  /** A protected section: its own document, restricted from the start. */
  createContainer: (pageId: string) =>
    request<{ containerId: string }>(`/api/pages/${pageId}/containers`, { method: 'POST' }),

  /**
   * What a link reaches: its page, and the subtree when it says so.
   *
   * Needed because a shared **folder** is otherwise a shared nothing — the link
   * view renders one page, a folder has no body, and there is no navigation on
   * that path.
   */
  sharedPages: (token: string) =>
    request<{
      pages: Array<{
        id: string;
        parentPageId: string | null;
        title: string;
        kind: string;
        idx: string;
        /** The entry's chosen icon and colour, so the tree draws what the page does. */
        icon: unknown;
        /** What the link grants on this entry (ADR-0095). */
        role: Role | null;
      }>;
      scopePageId: string;
    }>(`/api/share/${encodeURIComponent(token)}/pages`),

  /**
   * The names behind the comments on one shared page (ADR-0090).
   *
   * Not the workspace's members — that list is a directory, and a link's
   * visitor is given an empty one on purpose. These are the people who wrote a
   * message on *this* page, which is what a thread needs to be readable at all.
   */
  sharedCommentAuthors: (token: string, pageId: string) =>
    request<{ authors: Array<{ id: string; name: string }> }>(
      `/api/share/${encodeURIComponent(token)}/pages/${encodeURIComponent(pageId)}/authors`,
    ),

  /**
   * Start a comment thread through the server (ADR-0090).
   *
   * For somebody who may comment and may not write the document: the sync
   * room's gate is document-wide, so their update would be refused whole. The
   * anchors travel as base64 because JSON has no bytes.
   */
  startComment: (
    pageId: string,
    input: {
      from: Uint8Array;
      to: Uint8Array;
      quote: string;
      item?: string;
      text: string;
      /**
       * The name a visitor gave, when there is one.
       *
       * The share cookie carries the token and cannot say which visitor is
       * asking, so the server has no other way to know — and without it every
       * guest comment was signed "Guest" (ADR-0092). Ignored for a member,
       * whose session names them.
       */
      name?: string;
    },
  ) =>
    request<{ threadId: string; messageId: string }>(
      `/api/pages/${encodeURIComponent(pageId)}/comments`,
      {
        method: 'POST',
        body: JSON.stringify({
          from: base64(input.from),
          to: base64(input.to),
          quote: input.quote,
          ...(input.item ? { item: input.item } : {}),
          text: input.text,
          ...(input.name ? { name: input.name } : {}),
        }),
      },
    ),

  /** Reply to one, the same way. */
  replyToComment: (pageId: string, threadId: string, text: string, name?: string) =>
    request<{ messageId: string }>(
      `/api/pages/${encodeURIComponent(pageId)}/comments/${encodeURIComponent(threadId)}/messages`,
      { method: 'POST', body: JSON.stringify({ text, ...(name ? { name } : {}) }) },
    ),

  /** Everything shared in a workspace, from both ends (ADR-0026). */
  shares: (workspaceId: string) =>
    request<{
      links: Array<{
        id: string;
        pageId: string;
        pageTitle: string;
        role: string;
        includeSubtree: boolean;
        hasPassword: boolean;
        expiresAt: string | null;
        createdAt: string;
        mine: boolean;
      }>;
      granted: Array<{
        pageId: string;
        pageTitle: string;
        subject: string;
        subjectKind: string;
        access: string;
        includeSubtree: boolean;
        grantedAt: string;
      }>;
      received: Array<{
        pageId: string;
        pageTitle: string;
        access: string;
        includeSubtree: boolean;
        grantedAt: string;
        grantedBy: string | null;
        viaGroup: string | null;
      }>;
    }>(`/api/workspaces/${workspaceId}/shares`),

  pagePermissions: (pageId: string) =>
    request<{
      restricted: boolean;
      /** The ceiling set on this page itself, or none (ADR-0087). */
      cap: { maxLevel: string; includeSubtree: boolean } | null;
      /** The strictest one inherited from a section above, and where from. */
      inheritedCap: { maxLevel: string; from: string } | null;
      groups: Array<{
        groupId: string;
        name: string;
        access: string;
        inheritedFrom: string | null;
      }>;
      grants: Array<{
        userId: string;
        displayName: string;
        email: string;
        access: string;
        includeSubtree: boolean;
        inheritedFrom: string | null;
      }>;
    }>(`/api/pages/${pageId}/permissions`),

  /** Null lifts it: "no ceiling" is the top of the same list, not another act. */
  setPageCap: (pageId: string, maxLevel: string | null, includeSubtree = true) =>
    request<{ cap: { maxLevel: string; includeSubtree: boolean } | null }>(
      `/api/pages/${pageId}/cap`,
      { method: 'PUT', body: JSON.stringify({ maxLevel, includeSubtree }) },
    ),

  setPageRestricted: (pageId: string, restricted: boolean) =>
    request<{ restricted: boolean }>(`/api/pages/${pageId}/restricted`, {
      method: 'PUT',
      body: JSON.stringify({ restricted }),
    }),

  grantPageAccess: (pageId: string, userId: string, access: string) =>
    request<{ ok: true }>(`/api/pages/${pageId}/permissions/${userId}`, {
      method: 'PUT',
      body: JSON.stringify({ access }),
    }),

  revokePageAccess: (pageId: string, userId: string) =>
    request<{ ok: true }>(`/api/pages/${pageId}/permissions/${userId}`, {
      method: 'DELETE',
    }),

  /** What a token is for, before anybody commits to it. Needs no account. */
  inspectInvitation: (token: string) =>
    request<{
      workspaceName: string | null;
      instanceOnly: boolean;
      needsAddress: boolean;
    }>(`/api/invitations/${encodeURIComponent(token)}`),

  /** Outstanding invitations to a workspace, so they can be seen and withdrawn. */
  workspaceInvitations: (workspaceId: string) =>
    request<{ invitations: PendingInvitation[] }>(
      `/api/workspaces/${workspaceId}/invitations`,
    ),

  /** The same, for invitations that name no workspace (ADR-0025). */
  instanceInvitations: () =>
    request<{ invitations: PendingInvitation[] }>('/api/admin/invitations'),

  revokeInvitation: (invitationId: string) =>
    request<{ ok: true }>(`/api/invitations/${invitationId}`, { method: 'DELETE' }),

  acceptInvitation: (token: string) =>
    request<{ workspaceId: string | null; alreadyMember: boolean }>(
      `/api/invitations/${encodeURIComponent(token)}/accept`,
      { method: 'POST' },
    ),

  /** The icon and colours only — never the name (ADR-0030). */
  updateWorkspaceIcon: (workspaceId: string, icon: WorkspaceIcon | null) =>
    request<{ id: string; name: string; icon: WorkspaceIcon | null }>(
      `/api/workspaces/${workspaceId}`,
      { method: 'PATCH', body: JSON.stringify({ icon }) },
    ),

  /**
   * One of the four system roles by its word, or any role by its id.
   *
   * Both, because the four words are still the names of real rows and every
   * caller that predates roles-as-rows sends one (ADR-0087). A request naming
   * both is refused rather than resolved.
   */
  setMemberRole: (workspaceId: string, userId: string, role: string) =>
    request<{ ok: true }>(`/api/workspaces/${workspaceId}/members/${userId}`, {
      method: 'PUT',
      body: JSON.stringify({ role }),
    }),

  setMemberRoleId: (workspaceId: string, userId: string, roleId: string) =>
    request<{ ok: true }>(`/api/workspaces/${workspaceId}/members/${userId}`, {
      method: 'PUT',
      body: JSON.stringify({ roleId }),
    }),

  // --- roles (ADR-0087) ------------------------------------------------------

  /** Every role this workspace can use, system and its own, with who holds each. */
  roles: (workspaceId: string) =>
    request<{ roles: WorkspaceRoleRow[]; rights: string[] }>(
      `/api/workspaces/${workspaceId}/roles`,
    ),

  createRole: (
    workspaceId: string,
    role: { name: string; pageLevel: string | null; rights: string[] },
  ) =>
    request<WorkspaceRoleRow>(`/api/workspaces/${workspaceId}/roles`, {
      method: 'POST',
      body: JSON.stringify(role),
    }),

  /** The whole role, not a patch — see the route for why. */
  updateRole: (
    workspaceId: string,
    roleId: string,
    role: { name: string; pageLevel: string | null; rights: string[] },
  ) =>
    request<{ ok: true }>(`/api/workspaces/${workspaceId}/roles/${roleId}`, {
      method: 'PATCH',
      body: JSON.stringify(role),
    }),

  deleteRole: (workspaceId: string, roleId: string) =>
    request<{ ok: true }>(`/api/workspaces/${workspaceId}/roles/${roleId}`, {
      method: 'DELETE',
    }),

  /** Null takes the role away, which leaves the group a list of people. */
  setGroupRole: (workspaceId: string, groupId: string, roleId: string | null) =>
    request<{ ok: true }>(`/api/workspaces/${workspaceId}/groups/${groupId}/role`, {
      method: 'PUT',
      body: JSON.stringify({ roleId }),
    }),

  removeMember: (workspaceId: string, userId: string) =>
    request<{ ok: true }>(`/api/workspaces/${workspaceId}/members/${userId}`, {
      method: 'DELETE',
    }),

  /**
   * Give an account that already exists access to a workspace (ADR-0073).
   *
   * By address, and not from a list of everybody: a picker of every account on
   * the server would make every workspace owner a reader of the instance's
   * directory, which the administration keeps on purpose.
   */
  /**
   * Let an existing account into a workspace, as any role it can use.
   *
   * `roleId` for a role this workspace defined, `role` for one of the four
   * words — the same two spellings `setMemberRole` accepts, and naming both is
   * refused rather than guessed at (ADR-0103).
   */
  /**
   * Find an account to add, by name or by address (ADR-0119).
   *
   * Nothing without two characters — the server answers an empty list, because
   * this confirms a person somebody has in mind rather than listing the
   * instance.
   */
  findPeople: (workspaceId: string, query: string) =>
    request<{
      people: Array<{ id: string; displayName: string; email: string; member: boolean }>;
    }>(`/api/workspaces/${workspaceId}/people?q=${encodeURIComponent(query)}`),

  addMember: (
    workspaceId: string,
    input: { email: string; role?: string; roleId?: string },
  ) =>
    request<{ userId: string; role: string; roleId: string; roleName: string }>(
      `/api/workspaces/${workspaceId}/members`,
      { method: 'POST', body: JSON.stringify(input) },
    ),


  /** An account here, without a decision about which team they belong to. */
  inviteToInstance: (input: { email?: string | null; maxUses?: number }) =>
    request<{ token: string; invitationId: string; expiresAt: string }>(
      '/api/admin/invitations',
      { method: 'POST', body: JSON.stringify(input) },
    ),

  /** Whether there is a single sign-on button, and what it reads. */
  oidcConfig: () =>
    request<{ enabled: boolean; buttonLabel: string | null }>('/api/auth/oidc/config'),

  /**
   * Whether this account has a provider attached (ADR-0084).
   *
   * The normal way in is an invitation: somebody is invited, sets a password,
   * and *then* wants to use the company's provider. Until this existed, only
   * accounts created *by* a provider could ever use one.
   */
  oidcLink: () =>
    request<{
      available: boolean;
      buttonLabel: string | null;
      linked: { issuer: string; lastSeen: string | null } | null;
      canUnlink: boolean;
    }>('/api/auth/oidc/link'),

  oidcUnlink: () =>
    request<{ removed: number }>('/api/auth/oidc/link', { method: 'DELETE' }),

  adminOidc: () =>
    request<{
      settings: {
        issuer: string;
        clientId: string;
        buttonLabel: string;
        allowSignup: boolean;
        enabled: boolean;
      } | null;
      hasClientSecret: boolean;
    }>('/api/admin/oidc'),

  setAdminOidc: (settings: {
    issuer: string;
    clientId: string;
    buttonLabel: string;
    allowSignup: boolean;
    enabled: boolean;
  }) =>
    request<{ ok: true }>('/api/admin/oidc', {
      method: 'PUT',
      body: JSON.stringify(settings),
    }),

  /**
   * Where to land in this workspace, already checked to be reachable.
   *
   * Three answers in one (ADR-0119): `workspace` is what this place says,
   * `mode`/`pageId` is this person's own answer or null for "follow the
   * workspace", and `landOn` is the page that resolution produced.
   */
  landing: (workspaceId: string) =>
    request<{
      mode: LandingMode | null;
      pageId: string | null;
      workspace: { mode: LandingMode; pageId: string | null };
      landOn: string | null;
    }>(`/api/workspaces/${workspaceId}/landing`),

  /**
   * This person's own answer for this workspace, or where they are now.
   *
   * `mode` absent records only `lastPageId` — that call happens every few
   * seconds while somebody reads, and it must not become an opinion. `mode:
   * null` is the opinion "follow the workspace", said deliberately.
   */
  setLanding: (
    workspaceId: string,
    input: { mode?: LandingMode | null; pageId?: string | null; lastPageId?: string },
  ) =>
    request<{ ok: true }>(`/api/workspaces/${workspaceId}/landing`, {
      method: 'PUT',
      body: JSON.stringify(input),
    }),

  /** What the workspace says, which takes the right its name and icon take. */
  setWorkspaceLanding: (
    workspaceId: string,
    landing: { mode: LandingMode; pageId: string | null },
  ) =>
    request<{ id: string }>(`/api/workspaces/${workspaceId}`, {
      method: 'PATCH',
      body: JSON.stringify({ landing }),
    }),

  members: (workspaceId: string) =>
    request<{ members: WorkspaceMember[]; viewerRole: string }>(
      `/api/workspaces/${workspaceId}/members`,
    ),

  pages: (workspaceId: string) =>
    request<{ pages: PageSummary[] }>(`/api/workspaces/${workspaceId}/pages`),

  createPage: (
    workspaceId: string,
    input: {
      title?: string;
      parentPageId?: string | null;
      kind?: EntryKind;
      /** A template to start from (ADR-0045). */
      templateId?: string;
    },
  ) =>
    post<{
      id: string;
      idx: string;
      parentPageId: string | null;
      title: string;
      kind: EntryKind;
    }>(`/api/workspaces/${workspaceId}/pages`, input),

  page: (pageId: string) => request<PageDetail>(`/api/pages/${pageId}`),

  /**
   * Instance administration.
   *
   * Every one of these answers 404 for an account that does not administer the
   * instance, so a caller cannot tell "not allowed" from "not there". The
   * interface treats a 404 from `adminOverview` as "you are not an
   * administrator" and simply does not show the section.
   */
  adminOverview: () => request<AdminOverview>('/api/admin/overview'),
  adminUsers: () => request<{ users: AdminUser[] }>('/api/admin/users'),
  /** Marks it for deletion, or takes the mark off. Nothing is removed either way. */
  setWorkspaceDeletion: (
    workspaceId: string,
    input: { confirmName?: string; restore?: boolean },
  ) =>
    request<{ deletedAt: string | null }>(
      `/api/admin/workspaces/${workspaceId}/deletion`,
      { method: 'POST', body: JSON.stringify(input) },
    ),

  adminWorkspaces: () =>
    request<{ workspaces: AdminWorkspace[] }>('/api/admin/workspaces'),
  adminMaintenance: () => request<MaintenanceReport>('/api/admin/maintenance'),

  adminRunMaintenance: () =>
    request<{ report: Record<string, number | string[]> }>(
      '/api/admin/maintenance/run',
      { method: 'POST' },
    ),

  adminRetryPage: (pageId: string) =>
    request<{ pageId: string; recovered: boolean; error?: string }>(
      `/api/admin/maintenance/retry/${pageId}`,
      { method: 'POST' },
    ),

  adminUpdateUser: (
    userId: string,
    changes: {
      isInstanceAdmin?: boolean;
      canManageWorkspaces?: boolean;
      deactivated?: boolean;
    },
  ) =>
    request<{ id: string }>(`/api/admin/users/${userId}`, {
      method: 'PATCH',
      body: JSON.stringify(changes),
    }),

  adminUpdateSettings: (changes: Partial<Record<string, unknown>>) =>
    request<{
      settings: InstanceSettings;
      settingSources: Record<string, 'database' | 'environment'>;
    }>('/api/admin/settings', {
      method: 'PATCH',
      body: JSON.stringify(changes),
    }),

  /**
   * What a share token opens.
   *
   * No session: the token is the credential. Used when a link carries no page
   * in its path, which every link created before this did.
   */
  /** Show an existing share link again. Requires administering the page. */
  shareLinkUrl: (pageId: string, linkId: string) =>
    request<{ url: string }>(`/api/pages/${pageId}/share-links/${linkId}/url`),

  resolveShare: (token: string) =>
    request<{
      requiresPassword: boolean;
      /**
       * The link admits people with accounts, and nobody is signed in here
       * (ADR-0101).
       *
       * Answered before anything about the page is read, so the rest of this
       * shape is absent when it is true.
       */
      requiresSignIn?: boolean;
      pageId?: string;
      title?: string;
      kind?: string;
      role?: string;
    }>(`/api/share/${encodeURIComponent(token)}`),

  /** A collection is addressed by its own id: a page may hold several. */
  collection: (collectionId: string, viewId?: string, query?: string, after?: string) => {
    const params = new URLSearchParams();
    if (viewId) params.set('view', viewId);
    if (query && query.trim() !== '') params.set('q', query);
    // Where the previous page stopped (ADR-0055). Opaque: the client passes
    // back what the server gave it and never builds one.
    if (after) params.set('after', after);
    const search = params.toString();
    return request<CollectionData>(
      `/api/collections/${collectionId}${search ? `?${search}` : ''}`,
    );
  },

  createCollection: (pageId: string) =>
    request<{ pageId: string; collectionId: string }>(`/api/pages/${pageId}/collections`, {
      method: 'POST',
    }),

  /** A row is created through its collection and never appears in the tree. */
  /**
   * Add several rows at once, appended after whatever is there (ADR-0034).
   *
   * One request for a whole pasted grid: fifty rows through the single-row route
   * is two hundred round trips and a table that fills in visibly.
   */
  addCollectionRows: (
    collectionId: string,
    rows: Array<{ title: string; values?: Record<string, StoredCellValue | null> }>,
  ) =>
    request<{ collectionId: string; created: string[] }>(
      `/api/collections/${collectionId}/rows/bulk`,
      { method: 'POST', body: JSON.stringify({ rows }) },
    ),

  /** Archive every row: a row is a page, so emptying a table fills the trash. */
  /**
   * Move an entry and everything under it to another workspace (ADR-0038).
   *
   * `dryRun` counts what it would cost and changes nothing, which is what the
   * confirmation shows. The real move counts again in its own transaction, so
   * what was shown is what happened.
   */
  moveToWorkspace: (pageId: string, workspaceId: string, dryRun = false) =>
    request<{
      pageId: string;
      workspaceId: string;
      parentPageId: string | null;
      dryRun: boolean;
      cost: {
        pages: number;
        files: number;
        shareLinks: number;
        restrictions: number;
        references: number;
        favourites: number;
      };
    }>(
      `/api/pages/${pageId}/move-to-workspace${dryRun ? '?dryRun=true' : ''}`,
      { method: 'POST', body: JSON.stringify({ workspaceId }) },
    ),

  /** Move named rows to the trash (ADR-0040). Recoverable, like any page. */
  archiveCollectionRows: (collectionId: string, rowIds: string[]) =>
    request<{ collectionId: string; archived: string[] }>(
      `/api/collections/${collectionId}/rows/archive`,
      { method: 'POST', body: JSON.stringify({ rowIds }) },
    ),

  clearCollectionRows: (collectionId: string) =>
    request<{ collectionId: string; archived: string[] }>(
      `/api/collections/${collectionId}/rows`,
      { method: 'DELETE' },
    ),

  addCollectionRow: (collectionId: string, title = '') =>
    request<{ id: string }>(`/api/collections/${collectionId}/rows`, {
      method: 'POST',
      body: JSON.stringify({ title }),
    }),

  /** Collections a relation from this one could point at (ADR-0054). */
  relationTargets: (collectionId: string) =>
    request<{ collections: Array<{ id: string; pageId: string; title: string }> }>(
      `/api/collections/${collectionId}/targets`,
    ),

  /** One row's own fields and values, for its page (ADR-0054). */
  rowProperties: (pageId: string) =>
    request<{
      collectionId: string | null;
      canEdit?: boolean;
      fields: CollectionField[];
      values: Record<string, StoredCellValue | undefined>;
      derived: Record<string, DerivedCellValue | undefined>;
    }>(`/api/pages/${pageId}/properties`),

  /** Relation columns pointing at this collection, for a rollup (ADR-0054). */
  incomingRelations: (collectionId: string) =>
    request<{
      relations: Array<{
        fieldId: string;
        fieldName: string;
        fromCollection: string;
        /** The stored fields on that side, for an aggregate that needs one. */
        aggregatable: Array<{ id: string; name: string }>;
      }>;
    }>(`/api/collections/${collectionId}/incoming`),

  addCollectionField: (
    collectionId: string,
    field: { name: string; fieldType: string; config?: Record<string, unknown> },
  ) =>
    request<{ id: string }>(`/api/collections/${collectionId}/fields`, {
      method: 'POST',
      body: JSON.stringify(field),
    }),

  /** Change a column's config — a rollup's aggregate, for instance (ADR-0054). */
  updateCollectionField: (
    collectionId: string,
    fieldId: string,
    changes: { name?: string; description?: string | null; config?: Record<string, unknown> },
  ) =>
    request<{ id: string }>(`/api/collections/${collectionId}/fields/${fieldId}`, {
      method: 'PATCH',
      body: JSON.stringify(changes),
    }),

  renameCollectionField: (collectionId: string, fieldId: string, name: string) =>
    request<{ id: string }>(`/api/collections/${collectionId}/fields/${fieldId}`, {
      method: 'PATCH',
      body: JSON.stringify({ name }),
    }),

  removeCollectionField: (collectionId: string, fieldId: string) =>
    request<{ id: string }>(`/api/collections/${collectionId}/fields/${fieldId}`, {
      method: 'DELETE',
    }),

  addCollectionView: (
    collectionId: string,
    view: { name?: string; viewType: string; definition?: Record<string, unknown> },
  ) =>
    request<{ id: string }>(`/api/collections/${collectionId}/views`, {
      method: 'POST',
      body: JSON.stringify(view),
    }),

  /** Replace a view's rules. The definition is set wholesale, not merged. */
  updateCollectionView: (
    collectionId: string,
    viewId: string,
    definition: Record<string, unknown>,
  ) =>
    request<{ id: string }>(`/api/collections/${collectionId}/views/${viewId}`, {
      method: 'PATCH',
      body: JSON.stringify({ definition }),
    }),

  setFieldOptions: (
    collectionId: string,
    fieldId: string,
    options: Array<{ id: string; name: string; color: string }>,
  ) =>
    request<{ fieldId: string }>(
      `/api/collections/${collectionId}/fields/${fieldId}/options`,
      { method: 'PUT', body: JSON.stringify({ options }) },
    ),

  setCellValue: (rowId: string, fieldId: string, value: StoredCellValue | null) =>
    request<{ rowId: string }>(`/api/pages/${rowId}/properties/${fieldId}`, {
      method: 'PUT',
      body: JSON.stringify({ value }),
    }),

  trash: (workspaceId: string) =>
    request<{ entries: TrashEntry[] }>(`/api/workspaces/${workspaceId}/trash`),

  /**
   * Put an archived entry back, optionally somewhere else (ADR-0071).
   *
   * With no target it goes where it was, and a page whose folder is gone is
   * refused with `parent_missing` rather than put somewhere plausible. With one,
   * that folder is where it lands — which is the answer to that refusal.
   */
  restoreEntry: (pageId: string, parentPageId?: string) =>
    request<{ id: string; restoredToRoot: boolean }>(`/api/pages/${pageId}/restore`, {
      method: 'POST',
      ...(parentPageId ? { body: JSON.stringify({ parentPageId }) } : {}),
    }),

  /** What an entry says, as text, without opening it (ADR-0071). */
  pagePreview: (pageId: string) =>
    request<{
      id: string;
      blocks: Array<{ type: string; text: string }>;
      truncated: boolean;
    }>(`/api/pages/${pageId}/preview`),

  deleteEntryPermanently: (pageId: string) =>
    request<{ id: string; deleted: number }>(`/api/pages/${pageId}/permanently`, {
      method: 'DELETE',
    }),

  shareLinks: (pageId: string) =>
    request<{ links: ShareLink[] }>(`/api/pages/${pageId}/share-links`),

  createShareLink: (
    pageId: string,
    options: {
      role?: string;
      includeSubtree?: boolean;
      password?: string | null;
      expiresInDays?: number | null;
    },
  ) =>
    request<CreatedShareLink>(`/api/pages/${pageId}/share-links`, {
      method: 'POST',
      body: JSON.stringify(options),
    }),

  revokeShareLink: (pageId: string, linkId: string) =>
    request<{ id: string }>(`/api/pages/${pageId}/share-links/${linkId}`, {
      method: 'DELETE',
    }),

  /**
   * An entry's icon and the colours around it.
   *
   * No title is sent: setting an icon must not overwrite a rename somebody else
   * made in the meantime.
   */
  setEntryIcon: (
    pageId: string,
    changes: { icon?: EntryIcon | null; titleColor?: string | null },
  ) =>
    request<{ id: string }>(`/api/pages/${pageId}`, {
      method: 'PATCH',
      body: JSON.stringify(changes),
    }),

  setTags: (pageId: string, tags: string[]) =>
    request<{ id: string; tags: string[] }>(`/api/pages/${pageId}`, {
      method: 'PATCH',
      body: JSON.stringify({ tags }),
    }),

  /** Choose a tag's colour, or pass null to return to the derived one. */
  setTagColor: (workspaceId: string, tagKey: string, color: string | null) =>
    request<{ key: string; color: string; colorChosen: boolean }>(
      `/api/workspaces/${workspaceId}/tags/${encodeURIComponent(tagKey)}/color`,
      { method: 'PUT', body: JSON.stringify({ color }) },
    ),

  workspaceTags: (workspaceId: string) =>
    request<{ tags: WorkspaceTag[] }>(`/api/workspaces/${workspaceId}/tags`),

  /**
   * The caller's favourites in one workspace.
   *
   * The workspace is not optional in practice: a sidebar is a view of one, and
   * an unscoped list put shortcuts to other workspaces' pages in it — which
   * could not be opened, and said so in the wrong words.
   */
  favourites: (workspaceId: string) =>
    request<{ favourites: FavouriteEntry[] }>(
      `/api/favourites?workspace=${encodeURIComponent(workspaceId)}`,
    ),

  setFavourite: (pageId: string, favourite: boolean) =>
    request<{ pageId: string; favourite: boolean }>(`/api/pages/${pageId}/favourite`, {
      method: favourite ? 'PUT' : 'DELETE',
    }),

  /**
   * Move an entry, optionally to a specific place among its new siblings.
   *
   * `afterPageId` omitted means last; `null` means first. The two are
   * deliberately different, so the caller has to have an opinion or say it has
   * none.
   */
  moveEntry: (
    pageId: string,
    parentPageId: string | null,
    afterPageId?: string | null,
  ) =>
    request<{ id: string; parentPageId: string | null }>(`/api/pages/${pageId}`, {
      method: 'PATCH',
      body: JSON.stringify({
        parentPageId,
        ...(afterPageId === undefined ? {} : { afterPageId }),
      }),
    }),

  /** What this page said, at moments worth keeping (ADR-0047). */
  versions: (pageId: string) =>
    request<{
      versions: Array<{
        id: string;
        takenAt: string;
        authors: string[];
        reason: 'quiet' | 'compaction' | 'restore';
      }>;
      retentionDays: number;
      /** False, always, for now: history begins when it was switched on. */
      complete: boolean;
    }>(`/api/pages/${pageId}/versions`),

  /**
   * One version of a page, as text. The client does not decode documents it
   * cannot edit.
   *
   * `pageVersion`, not `version`: there is already a `version` here and it is
   * the *instance's* — the build somebody is running. Two unrelated things
   * under one name in one object is how a call gets made to the wrong one.
   */
  pageVersion: (pageId: string, versionId: string) =>
    request<{
      id: string;
      takenAt: string;
      authors: string[];
      title: string;
      blocks: Array<{
        id: string;
        parentId: string | null;
        type: string;
        text: string;
        /** A heading's level, a todo's state: without them it is all paragraphs. */
        props: Record<string, unknown>;
      }>;
    }>(`/api/pages/${pageId}/versions/${versionId}`),

  /** Which pages are watched here. Ids only — the tree has the titles. */
  watched: (workspaceId: string) =>
    request<{ watched: string[] }>(
      `/api/watched?workspace=${encodeURIComponent(workspaceId)}`,
    ),

  /**
   * Watch a page, or stop (ADR-0064).
   *
   * The same shape as `setFavourite` and deliberately not the same call: a
   * favourite is "I come here often", watching is "tell me when this changes".
   */
  setWatching: (pageId: string, watching: boolean) =>
    request<void>(`/api/pages/${pageId}/watch`, {
      method: watching ? 'PUT' : 'DELETE',
    }),

  /** Finish a sign-in that stopped for a code (ADR-0063). */
  secondFactorLogin: (ticket: string, code: string) =>
    post<{ usedRecovery?: boolean; recoveryCodesLeft: number }>('/api/auth/login/second', {
      ticket,
      code,
    }),

  /** Begin enrolling an authenticator. Nothing counts until a code is proved. */
  startSecondFactor: () =>
    post<{ uri: string; secret: string }>('/api/auth/second-factor/start', {}),

  confirmSecondFactor: (code: string) =>
    post<{ recoveryCodes: string[] }>('/api/auth/second-factor/confirm', { code }),

  /** Turn it off. Needs the password, not just this session. */
  removeSecondFactor: (password: string) =>
    post<void>('/api/auth/second-factor/remove', { password }),

  /** Ask for a reset link. Answers the same for any address (ADR-0059). */
  requestReset: (email: string) => post<{ asked: true }>('/api/auth/reset/request', { email }),

  /** Set a new password with a link's token. */
  resetPassword: (token: string, password: string) =>
    post<{ reset: true }>('/api/auth/reset', { token, password }),

  /**
   * Remove somebody's second factor, as an administrator (ADR-0065).
   *
   * The only way back for a person who has lost both their phone and their
   * recovery codes. They are told by mail, naming whoever did it.
   */
  adminLiftSecondFactor: (userId: string) =>
    post<{ removed: boolean }>(`/api/admin/users/${userId}/second-factor/remove`, {}),

  /** Send one test mail to the asking administrator (ADR-0058). */
  testMail: () =>
    post<{
      sentTo: string | null;
      problem?: string;
      /** What the server used, so a 535 can be told apart from a typo. */
      using?: {
        host: string;
        port: number;
        security: string;
        user: string;
        from: string;
        passwordLength: number;
        passwordLooksQuoted: boolean;
        passwordHasEdgeSpace: boolean;
        passwordMissing: boolean;
      };
    }>('/api/admin/mail/test', {}),

  /** Searches this person has kept in this workspace (ADR-0050). */
  savedSearches: (workspaceId: string) =>
    request<{ searches: Array<{ id: string; name: string; query: string }> }>(
      `/api/workspaces/${workspaceId}/searches`,
    ),

  saveSearch: (workspaceId: string, name: string, query: string) =>
    post<{ id: string | null }>(`/api/workspaces/${workspaceId}/searches`, { name, query }),

  forgetSearch: (searchId: string) =>
    // `request` with a method, which is how every other delete here is written;
    // `del` was a helper I assumed existed.
    request<{ deleted: boolean }>(`/api/searches/${searchId}`, { method: 'DELETE' }),

  /** How many notifications are waiting, across every workspace (ADR-0052). */
  inboxCount: () => request<{ unread: number }>('/api/inbox/count'),

  /** What is in the inbox, newest first. */
  inbox: (unreadOnly = false) =>
    request<{
      notifications: Array<{
        id: string;
        kind: 'mention' | 'reply' | 'assignment';
        excerpt: string;
        createdAt: string;
        read: boolean;
        /** When it comes back, or null for awake (ADR-0075). */
        snoozedUntil: string | null;
        pageId: string;
        pageTitle: string;
        threadId: string | null;
        workspaceId: string;
        workspaceName: string;
      }>;
    }>(`/api/inbox${unreadOnly ? '?unread=true' : ''}`),

  /** Mark things read. With no ids, everything (ADR-0052). */
  markInboxRead: (ids?: string[]) =>
    post<{ marked: number }>('/api/inbox/read', ids ? { ids } : {}),

  /**
   * Put notifications back to waiting (ADR-0071).
   *
   * Only by id: "mark everything unread" answers no question anybody has, and
   * it would undo a bankruptcy somebody declared on purpose.
   */
  markInboxUnread: (ids: string[]) =>
    post<{ marked: number }>('/api/inbox/read', { ids, read: false }),

  /**
   * Answer a notification where it is (ADR-0076).
   *
   * By notification rather than by page and thread: the inbox spans workspaces
   * and holds no page open, and the row is what says which conversation this
   * is about. Answering also marks the conversation read — somebody who has
   * just written a sentence about it has dealt with it.
   */
  replyToNotification: (id: string, text: string) =>
    post<{ ok: true }>(`/api/inbox/${id}/reply`, { text }),

  /**
   * Put notifications aside until a moment, or bring them back (ADR-0075).
   *
   * The moment is worked out here and sent whole: "tomorrow morning" is a
   * question about the clock on this desk, and the server would have to
   * reconstruct the answer from a stored timezone that can be wrong or stale.
   */
  snoozeInbox: (ids: string[], until: Date | null) =>
    post<{ snoozed: number }>('/api/inbox/snooze', {
      ids,
      until: until === null ? null : until.toISOString(),
    }),

  /**
   * Take notifications off the list for good (ADR-0115).
   *
   * By id only. Reading the list is the reversible bankruptcy; this is not, so
   * it removes what it was given and nothing else.
   */
  removeFromInbox: (ids: string[]) =>
    post<{ removed: number }>('/api/inbox/remove', { ids }),

  /** Ask for the whole workspace as an archive. It becomes a job (ADR-0044). */
  startWorkspaceExport: (workspaceId: string, attachments: boolean) =>
    post<{ jobId: string; alreadyRunning?: boolean }>(
      `/api/workspaces/${workspaceId}/export${attachments ? '' : '?attachments=false'}`,
      {},
    ),

  /** What this person has asked for in this workspace, newest first. */
  jobs: (workspaceId: string) =>
    request<{
      jobs: Array<{
        id: string;
        kind: string;
        state: 'queued' | 'running' | 'done' | 'failed';
        progress: string | null;
        error: string | null;
        bytes: number | null;
        pages: number | null;
        createdAt: string;
        expiresAt: string | null;
      }>;
    }>(`/api/workspaces/${workspaceId}/jobs`),

  /** What changed between a version and its neighbour, or between it and now. */
  versionDiff: (pageId: string, versionId: string, against: 'previous' | 'now') =>
    request<{
      against: 'previous' | 'now';
      isFirst?: boolean;
      unmatched: number;
      changes: Array<
        | { kind: 'added'; block: DiffBlock }
        | { kind: 'removed'; block: DiffBlock }
        | { kind: 'changed'; block: DiffBlock; words: WordChange[] }
        | { kind: 'moved'; block: DiffBlock; from: number; to: number }
      >;
    }>(`/api/pages/${pageId}/versions/${versionId}/diff?against=${against}`),

  /** Make the page read as it did. Applied forward, never a rewind (ADR-0047). */
  restoreVersion: (pageId: string, versionId: string) =>
    post<{ ok: true }>(`/api/pages/${pageId}/versions/${versionId}/restore`, {}),

  /** The shapes a page can be started from in this workspace (ADR-0045). */
  templates: (workspaceId: string) =>
    request<{
      templates: Array<{
        id: string;
        title: string;
        icon: { kind: string; value: string; color?: string } | null;
        kind: 'page' | 'canvas';
      }>;
    }>(`/api/workspaces/${workspaceId}/templates`),

  /** Offer this page as a template, or stop offering it. */
  /** Lock or unlock a page against accidental editing (ADR-0049). */
  setPageLocked: (pageId: string, locked: boolean) =>
    request<void>(`/api/pages/${pageId}`, {
      method: 'PATCH',
      body: JSON.stringify({ locked }),
    }),

  setPageTemplate: (pageId: string, template: boolean) =>
    request<void>(`/api/pages/${pageId}`, {
      method: 'PATCH',
      body: JSON.stringify({ template }),
    }),

  /** How wide this page's writing is. `null` follows the reader's default. */
  setPageWidth: (pageId: string, width: 'column' | 'full' | null) =>
    request<void>(`/api/pages/${pageId}`, {
      method: 'PATCH',
      body: JSON.stringify({ width }),
    }),

  /**
   * Give an entry a cover, or take it off with null (ADR-0117).
   *
   * The same route the icon and the title use, and for the reason a folder
   * makes plain: it has no open document to write into. A page writes its own
   * cover straight into the document it already has — see `PageView` — so this
   * is the folder's path. A page could use it too (an HTTP write reaches an
   * open room through the update bus, ADR-0076); it would just cost a
   * rematerialise and a tree refetch for something the document does at once.
   */
  setEntryCover: (pageId: string, cover: EntryCover | null) =>
    request<{ id: string; cover: EntryCover | null }>(`/api/pages/${pageId}`, {
      method: 'PATCH',
      body: JSON.stringify({ cover }),
    }),

  renameEntry: (pageId: string, title: string) =>
    request<{ id: string; title: string }>(`/api/pages/${pageId}`, {
      method: 'PATCH',
      body: JSON.stringify({ title }),
    }),

  archivePage: (pageId: string) =>
    request<void>(`/api/pages/${pageId}`, { method: 'DELETE' }),

  /**
   * Upload a file to a page.
   *
   * Sent as raw bytes rather than multipart: there is one file per request, and
   * a multipart parser on the server would be a dependency and a parsing
   * surface for no gain. The filename travels in the query string because a
   * header would need encoding rules of its own.
   */
  /** Replace your profile picture. The caller shrinks it first (ADR-0029). */
  setAvatar: async (file: File): Promise<void> => {
    const response = await fetch('/api/auth/avatar', {
      method: 'PUT',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/octet-stream' },
      body: file,
    });
    if (!response.ok) throw new ApiError(response.status, 'upload_failed');
  },

  removeAvatar: () => request<{ ok: true }>('/api/auth/avatar', { method: 'DELETE' }),

  /**
   * The instance's own mark (ADR-0123).
   *
   * The same shape as the avatar above and for the same reason: bytes go in a
   * body, not in a JSON field, because base64 in a request is a third larger
   * and has to be decoded on the way out.
   */
  setBrandLogo: async (file: File | Blob): Promise<void> => {
    const response = await fetch('/api/admin/brand/logo', {
      method: 'PUT',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/octet-stream' },
      body: file,
    });
    if (!response.ok) throw new ApiError(response.status, 'upload_failed');
  },

  removeBrandLogo: () =>
    request<{ ok: true }>('/api/admin/brand/logo', { method: 'DELETE' }),

  /**
   * The instance's base design, which every workspace's theme sits on.
   *
   * Read and written through the settings the administration screen already
   * uses, rather than a route of its own: it is one more instance setting, and
   * a second endpoint would be a second place a theme is validated.
   */
  brandTheme: () => api.adminOverview().then((result) => ({ theme: result.settings.brandTheme })),

  setBrandTheme: (theme: WorkspaceTheme) =>
    api.adminUpdateSettings({ brandTheme: theme }).then((result) => ({
      theme: result.settings.brandTheme,
    })),

  uploadFile: async (
    pageId: string,
    file: File,
    /** Marks this upload as the web-sized copy of another (ADR-0029). */
    variantOf?: string,
  ): Promise<{
    id: string;
    url: string;
    filename: string;
    mimeType: string;
    sizeBytes: number;
    inline: boolean;
    /** 'image' | 'pdf' | 'text' | 'document' | 'archive'. */
    category: string;
  }> => {
    const response = await fetch(
      `/api/pages/${pageId}/files?filename=${encodeURIComponent(file.name)}` +
        (variantOf ? `&variantOf=${encodeURIComponent(variantOf)}` : ''),
      {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/octet-stream' },
        body: file,
      },
    );

    const text = await response.text();
    if (!response.ok) {
      let code: string | null = null;
      let detail: string | undefined;
      try {
        const parsed = JSON.parse(text) as { error?: string; detail?: string };
        if (typeof parsed.error === 'string') code = parsed.error;
        // Present only for instance administrators: it names a path and an
        // errno, which is what somebody fixing a deployment needs.
        if (typeof parsed.detail === 'string') detail = parsed.detail;
      } catch {
        // Not JSON, which means something between the browser and SONE answered
        // — almost always a reverse proxy. Its own limits are separate from
        // ours, and the classic one is nginx's `client_max_body_size`, which
        // defaults to a single megabyte and rejects any photo with an HTML
        // page.
        //
        // This used to fall through to a generic code, so the block on the page
        // said "Something went wrong" — true, uninformative, and pointing at
        // the wrong component. The status is what identifies it.
        code = response.status === 413 ? 'proxy_rejected_size' : 'proxy_error';
      }
      throw new ApiError(response.status, code ?? 'unknown_error', detail);
    }

    return JSON.parse(text) as never;
  },

  /** A name close enough to offer when a search found little (ADR-0036). */
  search: (workspaceId: string, query: string) =>
    request<{
      query: string;
      results: SearchResult[];
      similar?: SimilarName[];
      /** What the server made of the query (ADR-0050). */
      filters?: AppliedFilters;
      /** Spellings that exist in this workspace (ADR-0051). */
      corrections?: string[];
    }>(
      `/api/workspaces/${workspaceId}/search?q=${encodeURIComponent(query)}`,
    ),

  changePassword: (input: { currentPassword: string; newPassword: string }) =>
    post<void>('/api/auth/password', input),

  updateProfile: (input: {
    displayName?: string;
    locale?: string | null;
    timezone?: string | null;
    mentionsWhen?: 'immediately' | 'daily' | 'off';
    assignmentsWhen?: 'immediately' | 'daily' | 'off';
    repliesWhen?: 'immediately' | 'daily' | 'off';
  }) => request<void>('/api/auth/profile', { method: 'PATCH', body: JSON.stringify(input) }),
};

/**
 * Build the page tree from the flat list.
 *
 * The server sends a flat list with parent ids on purpose — it is cheap to
 * diff when one page changes — so assembling it is the client's job.
 *
 * Pages whose parent is missing from the list are treated as roots rather than
 * dropped. That happens legitimately: a guest may see a subpage without seeing
 * its parent, and dropping it would make the page unreachable in the sidebar
 * even though it is perfectly accessible.
 */
export interface PageNode extends PageSummary {
  children: PageNode[];
  depth: number;
}

export function buildPageTree(pages: PageSummary[]): PageNode[] {
  const nodes = new Map<string, PageNode>(
    pages.map((page) => [page.id, { ...page, children: [], depth: 0 }]),
  );
  const roots: PageNode[] = [];

  for (const node of nodes.values()) {
    const parent = node.parentPageId ? nodes.get(node.parentPageId) : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }

  // Folders before pages, then by (idx, id).
  //
  // The tie-breaker matters wherever fractional indices are used, because a
  // midpoint is deterministic and two offline clients can produce the same key
  // (ADR-0015). Folders first is what makes the sidebar read as a filing system
  // rather than a mixed pile — the point of having folders at all (ADR-0019).
  const compare = (a: PageNode, b: PageNode): number => {
    if (a.kind !== b.kind) return a.kind === 'folder' ? -1 : 1;
    if (a.idx !== b.idx) return a.idx < b.idx ? -1 : 1;
    return a.id < b.id ? -1 : 1;
  };

  const assignDepth = (list: PageNode[], depth: number): void => {
    for (const node of list) {
      node.depth = depth;
      node.children.sort(compare);
      assignDepth(node.children, depth + 1);
    }
  };

  roots.sort(compare);
  assignDepth(roots, 0);
  return roots;
}
