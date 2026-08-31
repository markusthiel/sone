/**
 * SONE web — app root.
 *
 * Routing, session gating and layout. Deliberately the only place that knows
 * about all of those at once; everything else takes what it needs as props.
 */

import { useEffect, useState , type ReactElement } from 'react';

import { LoginScreen, SetupScreen, SignupScreen, messageFor } from './components/Auth.tsx';
import { FolderView } from './components/FolderView.tsx';
import { MoveDialog } from './components/MoveDialog.tsx';
import { ShareDialog } from './components/ShareDialog.tsx';
import { Trash } from './components/Trash.tsx';
import { SidebarIcon } from './components/icons.tsx';
import { PageStatus, PageView } from './components/PageView.tsx';
import {
  RightPanelToggle,
  RightSidebar,
  readRightPanelOpen,
} from './components/RightSidebar.tsx';
import { SearchScreen } from './components/Search.tsx';
import { AdminScreen } from './components/AdminScreen.tsx';
import { Settings } from './components/Settings.tsx';
import { WorkspaceSettingsScreen } from './components/WorkspaceSettingsScreen.tsx';
import { Sidebar } from './components/Sidebar.tsx';
import { usePage, useSoneClient } from './hooks/useSoneClient.ts';
import { useLinkInterception, useRoute } from './hooks/useRoute.ts';
import { usePages } from './hooks/usePages.ts';
import { useWorkspaceTheme } from './hooks/useWorkspaceTheme.ts';
import { useFavourites } from './hooks/useFavourites.ts';
import { useSession } from './hooks/useSession.ts';
import { useSidebar } from './hooks/useSidebar.ts';
import { api, type PageNode } from './api/client.ts';
import { MOVED_SETTINGS, paths } from './routes/paths.ts';
import { AcceptInvitation } from './components/AcceptInvitation.tsx';

export function App(): ReactElement {
  const { route, navigate } = useRoute();
  useLinkInterception(navigate);
  const { state, reload, logout, selectWorkspace } = useSession();

  // --- unauthenticated routes ---------------------------------------------

  if (state.status === 'loading') {
    return <div className="centered"><p className="muted">Loading…</p></div>;
  }

  if (state.status === 'error') {
    return (
      <div className="centered">
        <div className="card">
          <h1>Cannot start</h1>
          <p className="error">{messageFor(state.code)}</p>
          <button type="button" className="btn" onClick={() => void reload()}>
            Try again
          </button>
        </div>
      </div>
    );
  }

  if (state.status === 'needsSetup') {
    // Setup outranks the requested route: nothing else can work yet, and
    // redirecting would lose the fact that this is a fresh instance.
    return <SetupScreen onDone={() => void reload()} navigate={navigate} />;
  }

  // An invitation followed by somebody who is already signed in.
  //
  // The sign-up route below only renders for anonymous visitors, so this used
  // to do nothing visible: the person landed in their own workspace with no
  // sign the link had meant anything, and the invitation was not consumed.
  if (state.status === 'authenticated' && route.kind === 'signup' && route.invitationToken) {
    return (
      <AcceptInvitation
        token={route.invitationToken}
        navigate={navigate}
        onJoined={(workspaceId) => {
          if (workspaceId) selectWorkspace(workspaceId);
          void reload();
        }}
      />
    );
  }

  if (state.status === 'anonymous') {
    if (route.kind === 'share') {
      return <ShareRoute token={route.token} pageId={route.pageId} />;
    }
    if (route.kind === 'signup') {
      return (
        <SignupScreen
          onDone={(workspaceId) => {
            // Away from the invitation link, then reload.
            //
            // Registering *uses* the invitation, so leaving the token in the
            // address bar meant the accept screen below rendered next, looked
            // the token up, found it spent, and said something went wrong —
            // after everything had gone right.
            //
            // And land where the invitation pointed. Everybody now has a
            // workspace of their own (ADR-0025), so without this somebody who
            // accepted an invitation arrives in their own empty one — a member
            // of the team they joined, looking at nothing to do with it.
            if (workspaceId) selectWorkspace(workspaceId);
            navigate(paths.home());
            void reload();
          }}
          navigate={navigate}
          invitationToken={route.invitationToken}
        />
      );
    }
    return (
      <LoginScreen
        onDone={() => void reload()}
        navigate={navigate}
        instance={state.instance}
      />
    );
  }

  // --- authenticated ------------------------------------------------------

  return (
    <Workspace
      workspaceId={state.workspaceId}
      workspaceName={
        state.session.workspaces.find((w) => w.id === state.workspaceId)?.name ??
        'Workspace'
      }
      displayName={state.session.user.displayName}
      session={state.session}
      route={route}
      navigate={navigate}
      onSwitchWorkspace={(id) => {
        selectWorkspace(id);
        // Back to the root: a page id from the previous workspace is not
        // reachable in the new one, and leaving it in the URL would show a
        // not-found for a page that exists.
        navigate(paths.home());
        // The session response carries the workspace list, so a freshly created
        // workspace has to be picked up before it can be selected.
        void reload();
      }}
      onLogout={() => void logout()}
    />
  );
}

function Workspace({
  workspaceId,
  workspaceName,
  displayName,
  session,
  route,
  navigate,
  onSwitchWorkspace,
  onLogout,
}: {
  workspaceId: string;
  workspaceName: string;
  displayName: string;
  session: import('./api/client.ts').SessionInfo;
  route: ReturnType<typeof useRoute>['route'];
  /** With `replace`, for the redirect of an old settings URL (ADR-0032). */
  navigate: (to: string, options?: { replace?: boolean }) => void;
  onSwitchWorkspace: (workspaceId: string) => void;
  onLogout: () => void;
  /* Null while an old settings URL is being replaced: rendering the wrong area
     for one frame would flash a heading nobody asked for. */
}): ReactElement | null {
  // The workspace's own defaults, applied as custom properties on the document
  // root. Nothing else reads a theme: it changes what the existing variables
  // resolve to, and the stylesheet already falls back to its own answer where
  // one is absent (ADR-0023).
  useWorkspaceTheme(workspaceId);

  const { client, state: connectionState, failure } = useSoneClient({
    workspaceId,
    displayName,
  });
  const {
    tree,
    pages,
    createPage,
    archivePage,
    renameEntry,
    moveEntry,
    applyTitle,
    reload: reloadPages,
    loading: pagesLoading,
    error: pagesError,
  } = usePages(workspaceId);
  // The entry a move dialog is open for, if any.
  const [movingId, setMovingId] = useState<string | null>(null);
  const [sharingId, setSharingId] = useState<string | null>(null);
  const {
    favourites,
    ids: favouriteIds,
    toggle: toggleFavourite,
  } = useFavourites(workspaceId);
  const {
    visible: sidebarVisible,
    toggle: toggleSidebar,
    close: closeSidebar,
  } = useSidebar(route);
  const [rightOpen, setRightOpen] = useState(readRightPanelOpen);

  // Remembered per browser: reopening the panel on every navigation is the kind
  // of small friction that makes an app feel inattentive.
  useEffect(() => {
    try {
      localStorage.setItem('sone.rightPanel', String(rightOpen));
    } catch {
      // Storage disabled; the panel simply starts closed next time.
    }
  }, [rightOpen]);

  const routePageId = route.kind === 'page' ? route.pageId : null;

  // A folder has no document, so no sync handle is opened for one. Looked up in
  // the tree rather than fetched: the tree already knows every entry's kind, and
  // a request to find out would delay the render for nothing.
  const selected = routePageId ? findNode(tree, routePageId) : null;
  const isFolder = selected?.kind === 'folder';
  const pageId = isFolder ? null : routePageId;
  const handle = usePage(client, pageId);

  // The root redirects to the first page rather than showing an empty shell.
  useEffect(() => {
    if (route.kind !== 'home') return;
    // Not while the tree is being fetched.
    //
    // Redirecting from a list that is still loading means redirecting to
    // whatever was there before — which after a workspace switch is a page in
    // the workspace just left, and the server refuses it. Correctly, and to
    // somebody who only pressed a switcher.
    if (pagesLoading) return;

    let cancelled = false;
    void api
      .landing(workspaceId)
      .then((landing) => {
        if (cancelled) return;
        // Where they were, or the page they chose — the server has already
        // checked it is still reachable, so this is a page or nothing.
        const target = landing.landOn ?? pages[0]?.id ?? null;
        if (!target) return;
        const node = pages.find((page) => page.id === target);
        navigate(paths.page(target, node?.title ?? ''));
      })
      .catch(() => {
        // The first page, as before. A landing preference that cannot be read
        // should cost somebody a good guess, not a blank screen.
        const first = pages[0];
        if (first) navigate(paths.page(first.id, first.title));
      });

    return () => {
      cancelled = true;
    };
  }, [route.kind, pages, pagesLoading, navigate, workspaceId]);

  // Remember where they are.
  //
  // On the page rather than on leaving it: a tab closed without warning is the
  // common way a session ends, and an unload handler is the least reliable
  // moment in a browser.
  useEffect(() => {
    if (!routePageId || isFolder) return;
    const timer = setTimeout(() => {
      void api.setLanding(workspaceId, { lastPageId: routePageId }).catch(() => {
        // Where somebody was is worth remembering and not worth reporting.
      });
    }, 2000);
    return () => clearTimeout(timer);
  }, [routePageId, isFolder, workspaceId]);

  const onCreateEntry = async (
    parentPageId: string | null,
    kind: 'page' | 'folder',
  ): Promise<void> => {
    const id = await createPage({ title: '', parentPageId, kind });
    // A folder has no document to open, so creating one must not navigate
    // anywhere — it appears in the sidebar and the person carries on.
    if (id && kind === 'page') navigate(paths.page(id));
  };

  // Settings is its own screen, not a page inside the workspace.
  //
  // It was rendered in the content column, which put a sidebar of pages beside
  // a list of instance settings — two navigations for two unrelated things,
  // side by side, and neither of them the one somebody is using. This returns
  // early with a surface of its own and a way back (ADR-0027).
  if (route.kind === 'settings') {
    // An old section id, from a bookmark or an older build of this interface.
    // Redirected rather than answered with the first section of the wrong area
    // (ADR-0032): URLs are a public contract, and a link that lands somewhere
    // plausible but wrong is worse than one that lands somewhere right.
    const moved = MOVED_SETTINGS[route.section];
    if (moved) {
      navigate(moved, { replace: true });
      return null;
    }
    return (
      <Settings
        section={route.section}
        session={session}
        workspaceId={workspaceId}
        onClose={() => navigate(paths.home())}
        onLogout={onLogout}
      />
    );
  }

  if (route.kind === 'workspaceSettings') {
    return (
      <WorkspaceSettingsScreen
        section={route.section}
        session={session}
        workspaceId={workspaceId}
        onClose={() => navigate(paths.home())}
        onLogout={onLogout}
      />
    );
  }

  if (route.kind === 'admin') {
    return (
      <AdminScreen
        section={route.section}
        session={session}
        workspaceId={workspaceId}
        onClose={() => navigate(paths.home())}
        onLogout={onLogout}
      />
    );
  }

  return (
    <div
      className="app with-sidebar"
      // Drives the grid: a column exists only when it is showing, so the
      // reading column is not narrowed for a panel nobody asked for and the
      // sidebar leaves no empty strip behind when hidden.
      data-right-panel={rightOpen ? 'open' : 'closed'}
      data-sidebar={sidebarVisible ? 'shown' : 'hidden'}
    >
      <Sidebar
        canManageWorkspaces={session.user.canManageWorkspaces}
        isInstanceAdmin={session.user.isInstanceAdmin}
        currentIcon={
          session.workspaces.find((w) => w.id === workspaceId)?.icon ?? null
        }
        displayName={session.user.displayName}
        userId={session.user.id}
        workspaceId={workspaceId}
        workspaceName={workspaceName}
        onSwitchWorkspace={onSwitchWorkspace}
        tree={tree}
        currentPageId={pageId}
        open={sidebarVisible}
        onClose={closeSidebar}
        onCreatePage={(parent, kind) => void onCreateEntry(parent, kind)}
        onRename={(id, title) => void renameEntry(id, title)}
        onStartMove={setMovingId}
        onStartShare={setSharingId}
        onMove={(id, parent, after) => void moveEntry(id, parent, after)}
        favourites={favourites}
        favouriteIds={favouriteIds}
        onReloadTree={() => void reloadPages()}
        onToggleFavourite={(id, on) => void toggleFavourite(id, on)}
        onDelete={(id, descendants) => {
          // Confirmed, and the count is in the question. Deleting a folder
          // takes its contents, and someone who has not opened it in a month
          // may not remember what is inside.
          const message =
            descendants > 0
              ? `Delete this and the ${descendants} item(s) inside it?`
              : 'Delete this?';
          if (!window.confirm(message)) return;
          void archivePage(id).then(() => {
            // Navigate away if the page being viewed was just deleted, or the
            // editor stays open on something that no longer exists.
            if (route.kind === 'page' && route.pageId === id) navigate(paths.home());
          });
        }}
        onLogout={onLogout}
      />

      {/* A failed tree operation used to vanish: usePages recorded the error
          and nothing rendered it, so a refused move looked like a move that
          did not save. Shown as a transient bar rather than a dialog — it is
          information, not a decision. */}
      {pagesError && (
        <div className="app-error" role="status">
          {messageFor(pagesError)}
        </div>
      )}

      <div className="main">
        <div className="topbar">
          {/* Always present, at every width. It used to be hidden above 800px
              on the theory that a permanent column needs no toggle — which left
              no way to reclaim the space, and no way to undo a collapse. */}
          <button
            className="quiet sidebar-toggle"
            type="button"
            onClick={toggleSidebar}
            aria-label={sidebarVisible ? 'Hide the sidebar' : 'Show the sidebar'}
            aria-expanded={sidebarVisible}
          >
            <SidebarIcon />
          </button>
          <PageStatus
            handle={handle}
            connectionState={connectionState}
            failure={failure}
          />
          <div className="topbar-end">
            <RightPanelToggle open={rightOpen} onToggle={() => setRightOpen((v) => !v)} />
          </div>
        </div>

        {route.kind === 'page' && isFolder && selected && (
          <FolderView
            folder={selected}
            trail={ancestorNodes(tree, selected.id)}
            onCreate={(parent, kind) => void onCreateEntry(parent, kind)}
            onRename={(id, title) => void renameEntry(id, title)}
          />
        )}

        {route.kind === 'page' && !isFolder && handle && (
          <PageView
            connectionState={connectionState}
            handle={handle}
            pageId={routePageId!}
            // Keeps the sidebar in step with the heading as it is typed. The
            // tree comes from the projection over HTTP, so without this it
            // showed the old name until something refetched.
            onTitleChange={(title) => applyTitle(routePageId!, title)}
          />
        )}

        {route.kind === 'page' && !isFolder && !handle && (
          <div className="page-body">
            <p className="muted">Opening…</p>
          </div>
        )}

        {route.kind === 'search' && (
          <SearchScreen workspaceId={workspaceId} initialQuery={route.query} />
        )}

        {route.kind === 'trash' && (
          <Trash workspaceId={workspaceId} onChanged={() => void reloadPages()} />
        )}

        {route.kind === 'home' && pages.length === 0 && (
          <div className="page-body">
            <h1>Nothing here yet</h1>
            <button
              className="primary"
              type="button"
              onClick={() => void onCreateEntry(null, 'page')}
            >
              Create your first page
            </button>
          </div>
        )}

        {route.kind === 'notFound' && (
          <div className="page-body">
            <h1>Not found</h1>
            <p className="muted">
              <a href={paths.home()}>Back to your pages</a>
            </p>
          </div>
        )}
      </div>

      {sharingId && (
        <ShareDialog
          workspaceId={workspaceId}
          pageId={sharingId}
          pageTitle={findNode(tree, sharingId)?.title ?? ''}
          onClose={() => setSharingId(null)}
        />
      )}

      {movingId && (
        <MoveDialog
          entry={findNode(tree, movingId)!}
          tree={tree}
          onCancel={() => setMovingId(null)}
          onMove={(parent) => {
            setMovingId(null);
            void moveEntry(movingId, parent);
          }}
        />
      )}

      <RightSidebar
        handle={handle}
        pageId={pageId}
        workspaceId={workspaceId}
        open={rightOpen}
        onClose={() => setRightOpen(false)}
      />
    </div>
  );
}

/**
 * A share link.
 *
 * The workspace is not known before authenticating, so the connection is
 * established with a placeholder and the real id arrives in the auth
 * acknowledgement. This is the one place the URL carries the credential
 * (ADR-0016), and it must work without any account at all.
 */
function ShareRoute({
  token,
  pageId,
}: {
  token: string;
  pageId: string | null;
}): ReactElement {
  /**
   * The name a visitor gave, remembered for this tab.
   *
   * Asking again on every reload is not a decision, it is an omission: nothing
   * about the name is worth re-deciding, and a page refresh is not a new visit.
   *
   * sessionStorage rather than localStorage, and per token. Per tab, because an
   * anonymous session already belongs to a tab — two tabs are two people as far
   * as presence is concerned, and sharing a name across them would make one
   * person appear twice under one label. Per token, because a different link is
   * a different context, possibly a different circle of people.
   *
   * It is a display name, not a credential, so it does not outlive the browser
   * session on what may be a shared machine.
   */
  const nameKey = `sone.share.name.${token}`;
  const remembered =
    typeof sessionStorage !== 'undefined' ? (sessionStorage.getItem(nameKey) ?? '') : '';

  const [displayName, setDisplayName] = useState(remembered);
  // Skipped entirely when a name is already known, so a reload lands back on
  // the page rather than on a form.
  const [joined, setJoined] = useState(remembered !== '');

  if (!joined) {
    return (
      <div className="centered">
        <form
          className="card"
          onSubmit={(event) => {
            event.preventDefault();
            const chosen = displayName.trim();
            try {
              if (chosen) sessionStorage.setItem(nameKey, chosen);
            } catch {
              // Private browsing, or storage that is full or disabled. The name
              // still works for this visit; it is simply asked for again next
              // time, which is what happened before this existed.
            }
            setJoined(true);
          }}
        >
          <h1>Shared page</h1>
          <p className="muted">
            Pick a name so other people can see who is editing. No account
            needed.
          </p>
          <div className="field">
            <label htmlFor="name">Your name</label>
            <input
              id="name"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="Guest"
              autoFocus
            />
          </div>
          <button className="primary" type="submit">
            Open page
          </button>
        </form>
      </div>
    );
  }

  return (
    <ShareSession
      token={token}
      pageId={pageId}
      displayName={displayName || 'Guest'}
    />
  );
}

function ShareSession({
  token,
  pageId,
  displayName,
}: {
  token: string;
  pageId: string | null;
  displayName: string;
}): ReactElement {
  // The share token identifies the workspace server-side; the client does not
  // know it yet, so it sends a placeholder that the server ignores in favour of
  // the token's own workspace.
  const { client, state, fatal, passwordRequired, submitPassword } = useSoneClient({
    workspaceId: '00000000-0000-0000-0000-000000000000',
    shareToken: token,
    displayName,
  });
  /**
   * Resolve the token, always.
   *
   * Two jobs, and I first wrote this as though it had one. It supplies the page
   * for a link whose path has none — every link created before the page was
   * added to the URL — *and* it is what sets the share cookie, which is the
   * only credential this visitor has for ordinary HTTP requests.
   *
   * Skipping it when the path already carried a page therefore broke uploads
   * for exactly the links that were supposed to be better: no request, no
   * cookie, and every image upload refused. The page in the path is an
   * optimisation, not a reason to skip the handshake.
   */
  const [resolvedPageId, setResolvedPageId] = useState<string | null>(null);
  const [unresolvable, setUnresolvable] = useState(false);

  useEffect(() => {
    let cancelled = false;

    void api
      .resolveShare(token)
      .then((result) => {
        if (cancelled) return;
        // A password-protected link reports only that a password is needed; the
        // page arrives once the connection is unlocked, which the sync layer
        // handles.
        if (result.pageId) setResolvedPageId(result.pageId);
      })
      .catch(() => {
        // Only fatal when there is no page to fall back on. With one in the
        // path the document still opens; uploads will fail until the cookie is
        // in place, and that is better than refusing to show the page.
        if (!cancelled && pageId === null) setUnresolvable(true);
      });

    return () => {
      cancelled = true;
    };
  }, [token, pageId]);

  const effectivePageId = pageId ?? resolvedPageId;
  const handle = usePage(client, effectivePageId);
  const [password, setPassword] = useState('');

  if (passwordRequired) {
    return (
      <div className="centered">
        <form
          className="card"
          onSubmit={(event) => {
            event.preventDefault();
            submitPassword(password);
          }}
        >
          <h1>This link is protected</h1>
          <div className="field">
            <label htmlFor="lp">Password</label>
            <input
              id="lp"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoFocus
            />
          </div>
          <button className="primary" type="submit">
            Open
          </button>
        </form>
      </div>
    );
  }

  if (fatal || unresolvable) {
    return (
      <div className="centered">
        <div className="card">
          <h1>Link unavailable</h1>
          <p className="muted">
            This link may have been revoked or has expired.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="app">
      <div className="main">
        <div className="topbar">
          <PageStatus handle={handle} connectionState={state} />
        </div>
        {handle && effectivePageId ? (
          <PageView handle={handle} pageId={effectivePageId} connectionState={state} />
        ) : (
          <div className="page-body">
            <p className="muted">Opening…</p>
          </div>
        )}
      </div>
    </div>
  );
}

/** Find a node anywhere in the tree. */
function findNode(nodes: PageNode[], pageId: string): PageNode | null {
  for (const node of nodes) {
    if (node.id === pageId) return node;
    const found = findNode(node.children, pageId);
    if (found) return found;
  }
  return null;
}

/** Ancestor nodes of an entry, outermost first, for a breadcrumb. */
function ancestorNodes(nodes: PageNode[], pageId: string): PageNode[] {
  const walk = (list: PageNode[], trail: PageNode[]): PageNode[] | null => {
    for (const node of list) {
      if (node.id === pageId) return trail;
      const found = walk(node.children, [...trail, node]);
      if (found) return found;
    }
    return null;
  };
  return walk(nodes, []) ?? [];
}
