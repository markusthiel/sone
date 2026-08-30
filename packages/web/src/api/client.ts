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

import type { EntryIcon, WorkspaceTheme } from '@sone/core';

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
}

export interface SessionInfo {
  user: {
    id: string;
    email: string | null;
    displayName: string;
    isGuest: boolean;
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
  }>;
}

/** A folder organises; a page holds writing (ADR-0019). */
export type EntryKind = 'page' | 'folder';

export interface PageSummary {
  id: string;
  parentPageId: string | null;
  collectionId: string | null;
  idx: string;
  title: string;
  icon: { kind: string; value: string; color?: string; titleColor?: string } | null;
  kind: EntryKind;
  archived: boolean;
  lastEditedAt: string;
}

export interface PageDetail extends Omit<PageSummary, 'archived' | 'idx'> {
  /* kind is inherited from PageSummary. */
  workspaceId: string;
  coverUrl: string | null;
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
}

/**
 * A cell value, tagged with the kind it holds.
 *
 * The tag is not redundant with the column's type: a column can be changed, and
 * values written before that are still the old kind until something rewrites
 * them. A reader has to know what it is holding.
 */
export type StoredCellValue =
  | { kind: 'text'; value: string }
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
  pageId: string;
  collectionId: string;
  titleFieldId: string;
  canEdit: boolean;
  views: CollectionView[];
  fields: CollectionField[];
  rows: CollectionRow[];
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
  workspaceId: string;
  idx: string;
}

export interface WorkspaceSummary {
  id: string;
  name: string;
  role: string;
  defaultLocale: string;
  pageCount: number;
  memberCount: number;
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
  icon: { kind: string; value: string; color?: string; titleColor?: string } | null;
  breadcrumb: string[];
  rank: number;
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

  acceptInvitation: (token: string) =>
    request<{ workspaceId: string | null; alreadyMember: boolean }>(
      `/api/invitations/${encodeURIComponent(token)}/accept`,
      { method: 'POST' },
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

  members: (workspaceId: string) =>
    request<{ members: WorkspaceMember[]; viewerRole: string }>(
      `/api/workspaces/${workspaceId}/members`,
    ),

  pages: (workspaceId: string) =>
    request<{ pages: PageSummary[] }>(`/api/workspaces/${workspaceId}/pages`),

  createPage: (
    workspaceId: string,
    input: { title?: string; parentPageId?: string | null; kind?: EntryKind },
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
  collection: (collectionId: string, viewId?: string, query?: string) => {
    const params = new URLSearchParams();
    if (viewId) params.set('view', viewId);
    if (query && query.trim() !== '') params.set('q', query);
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
  addCollectionRow: (collectionId: string, title = '') =>
    request<{ id: string }>(`/api/collections/${collectionId}/rows`, {
      method: 'POST',
      body: JSON.stringify({ title }),
    }),

  addCollectionField: (
    collectionId: string,
    field: { name: string; fieldType: string; config?: Record<string, unknown> },
  ) =>
    request<{ id: string }>(`/api/collections/${collectionId}/fields`, {
      method: 'POST',
      body: JSON.stringify(field),
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

  favourites: () =>
    request<{ favourites: FavouriteEntry[] }>('/api/favourites'),

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
  uploadFile: async (
    pageId: string,
    file: File,
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
      `/api/pages/${pageId}/files?filename=${encodeURIComponent(file.name)}`,
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

  search: (workspaceId: string, query: string) =>
    request<{ query: string; results: SearchResult[] }>(
      `/api/workspaces/${workspaceId}/search?q=${encodeURIComponent(query)}`,
    ),

  changePassword: (input: { currentPassword: string; newPassword: string }) =>
    post<void>('/api/auth/password', input),

  updateProfile: (input: {
    displayName?: string;
    locale?: string | null;
    timezone?: string | null;
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
