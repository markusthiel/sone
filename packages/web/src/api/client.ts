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

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
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
  icon: { kind: string; value: string } | null;
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
  icon: { kind: string; value: string } | null;
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

  renameEntry: (pageId: string, title: string) =>
    request<{ id: string; title: string }>(`/api/pages/${pageId}`, {
      method: 'PATCH',
      body: JSON.stringify({ title }),
    }),

  archivePage: (pageId: string) =>
    request<void>(`/api/pages/${pageId}`, { method: 'DELETE' }),

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
