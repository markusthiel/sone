/**
 * SONE web — app root.
 *
 * Routing, session gating and layout. Deliberately the only place that knows
 * about all of those at once; everything else takes what it needs as props.
 */

import { useEffect, useState , type ReactElement } from 'react';

import { LoginScreen, SetupScreen, SignupScreen, messageFor } from './components/Auth.tsx';
import { PageStatus, PageView } from './components/PageView.tsx';
import { SearchScreen } from './components/Search.tsx';
import { Settings } from './components/Settings.tsx';
import { Sidebar } from './components/Sidebar.tsx';
import { usePage, useSoneClient } from './hooks/useSoneClient.ts';
import { useLinkInterception, useRoute } from './hooks/useRoute.ts';
import { usePages } from './hooks/usePages.ts';
import { useSession } from './hooks/useSession.ts';
import { paths } from './routes/paths.ts';

export function App(): ReactElement {
  const { route, navigate } = useRoute();
  useLinkInterception(navigate);
  const { state, reload, logout } = useSession();

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
          <button type="button" onClick={() => void reload()}>
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

  if (state.status === 'anonymous') {
    if (route.kind === 'share') {
      return <ShareRoute token={route.token} pageId={route.pageId} />;
    }
    if (route.kind === 'signup') {
      return (
        <SignupScreen
          onDone={() => void reload()}
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
  onLogout,
}: {
  workspaceId: string;
  workspaceName: string;
  displayName: string;
  session: import('./api/client.ts').SessionInfo;
  route: ReturnType<typeof useRoute>['route'];
  navigate: (to: string) => void;
  onLogout: () => void;
}): ReactElement {
  const { client, state: connectionState } = useSoneClient({
    workspaceId,
    displayName,
  });
  const { tree, pages, createPage } = usePages(workspaceId);
  const [drawerOpen, setDrawerOpen] = useState(false);

  const pageId = route.kind === 'page' ? route.pageId : null;
  const handle = usePage(client, pageId);

  // Close the drawer on navigation. Without this, tapping a page on a phone
  // leaves the drawer covering the page that was just opened.
  useEffect(() => {
    setDrawerOpen(false);
  }, [route]);

  // The root redirects to the first page rather than showing an empty shell.
  useEffect(() => {
    if (route.kind !== 'home') return;
    const first = pages[0];
    if (first) navigate(paths.page(first.id, first.title));
  }, [route.kind, pages, navigate]);

  const onCreatePage = async (parentPageId: string | null): Promise<void> => {
    const id = await createPage({ title: '', parentPageId });
    if (id) navigate(paths.page(id));
  };

  return (
    <div className="app with-sidebar">
      <Sidebar
        workspaceName={workspaceName}
        tree={tree}
        currentPageId={pageId}
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        onCreatePage={(parent) => void onCreatePage(parent)}
        onLogout={onLogout}
      />

      <div className="main">
        <div className="topbar">
          <button
            className="quiet"
            type="button"
            onClick={() => setDrawerOpen(true)}
            aria-label="Open navigation"
            aria-expanded={drawerOpen}
            style={{ minWidth: 40 }}
          >
            ☰
          </button>
          <PageStatus handle={handle} connectionState={connectionState} />
        </div>

        {route.kind === 'page' && handle && <PageView handle={handle} />}

        {route.kind === 'page' && !handle && (
          <div className="page-body">
            <p className="muted">Opening…</p>
          </div>
        )}

        {route.kind === 'search' && (
          <SearchScreen workspaceId={workspaceId} initialQuery={route.query} />
        )}

        {route.kind === 'settings' && (
          <Settings
            section={route.section}
            session={session}
            workspaceId={workspaceId}
          />
        )}

        {route.kind === 'home' && pages.length === 0 && (
          <div className="page-body">
            <h1>Nothing here yet</h1>
            <button
              className="primary"
              type="button"
              onClick={() => void onCreatePage(null)}
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
  const [displayName, setDisplayName] = useState('');
  const [joined, setJoined] = useState(false);

  if (!joined) {
    return (
      <div className="centered">
        <form
          className="card"
          onSubmit={(event) => {
            event.preventDefault();
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
  const handle = usePage(client, pageId);
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

  if (fatal) {
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
        {handle ? (
          <PageView handle={handle} />
        ) : (
          <div className="page-body">
            <p className="muted">Opening…</p>
          </div>
        )}
      </div>
    </div>
  );
}
