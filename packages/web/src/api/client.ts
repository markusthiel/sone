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

import type { DiffBlock, EntryIcon, WordChange, WorkspaceTheme } from '@sone/core';

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

export interface InstanceInfo {
  needsSetup: boolean;
  signupMode: 'open' | 'invite' | 'closed';
  suggestedLocale: string;
  /** "du" or "Sie", where a language distinguishes it (ADR-0041). */
  addressForm?: 'informal' | 'formal';
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
    emailMentions: boolean;
    emailAssignments: boolean;
    emailReplies: boolean;
    locale: string | null;
    timezone: string | null;
    isInstanceAdmin: boolean;
    /** May administer every workspace. Implied by isInstanceAdmin (ADR-0027). */
    canManageWorkspaces: boolean;
  };
  workspaces: Array<{
    id: string;
    name: string;
    role: string;
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
  title: string;
  icon: { kind: string; value: string; color?: string; titleColor?: string } | null;
  kind: EntryKind;
  /** Offered as a shape to start from (ADR-0045). */
  template?: boolean;
  /** Locked against accidental editing (ADR-0049). */
  locked?: boolean;
  archived: boolean;
  lastEditedAt: string;
}

export interface PageDetail extends Omit<PageSummary, 'archived' | 'idx'> {
  /* kind is inherited from PageSummary. */
  workspaceId: string;
  coverUrl: string | null;
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
  role: string;
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
  role: string;
  isGuest: boolean;
  joinedAt: string;
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

  login: (input: { email: string; password: string }) =>
    post<void>('/api/auth/login', input),

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
    request<{ groups: Array<{ id: string; name: string; members: number }> }>(
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

  pagePermissions: (pageId: string) =>
    request<{
      restricted: boolean;
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

  setMemberRole: (workspaceId: string, userId: string, role: string) =>
    request<{ ok: true }>(`/api/workspaces/${workspaceId}/members/${userId}`, {
      method: 'PUT',
      body: JSON.stringify({ role }),
    }),

  removeMember: (workspaceId: string, userId: string) =>
    request<{ ok: true }>(`/api/workspaces/${workspaceId}/members/${userId}`, {
      method: 'DELETE',
    }),

  inviteToWorkspace: (
    workspaceId: string,
    input: { email?: string | null; role?: string; maxUses?: number },
  ) =>
    request<{ token: string; invitationId: string; expiresAt: string }>(
      `/api/workspaces/${workspaceId}/invitations`,
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

  /** Where to land in this workspace, already checked to be reachable. */
  landing: (workspaceId: string) =>
    request<{ mode: 'last' | 'fixed'; pageId: string | null; landOn: string | null }>(
      `/api/workspaces/${workspaceId}/landing`,
    ),

  setLanding: (
    workspaceId: string,
    input: { mode?: 'last' | 'fixed'; pageId?: string | null; lastPageId?: string },
  ) =>
    request<{ ok: true }>(`/api/workspaces/${workspaceId}/landing`, {
      method: 'PUT',
      body: JSON.stringify(input),
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

  restoreEntry: (pageId: string) =>
    request<{ id: string; restoredToRoot: boolean }>(`/api/pages/${pageId}/restore`, {
      method: 'POST',
    }),

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
    emailMentions?: boolean;
    emailAssignments?: boolean;
    emailReplies?: boolean;
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
