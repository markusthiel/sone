/**
 * SONE web — error boundary.
 *
 * Exists because an uncaught exception in the editor took the whole page down
 * to white, with nothing on screen and nothing to act on. The underlying bug is
 * fixed, but "any future crash shows a blank page" is a defect of its own: the
 * person cannot tell whether the app broke, the network dropped, or their work
 * was lost — and a blank page suggests the worst of the three.
 *
 * A class component because React has no hook equivalent; `componentDidCatch`
 * is the only way to catch a render-time throw.
 *
 * What this cannot catch: errors in event handlers, in promises, and in effects
 * scheduled outside React. Those need window.onerror, which is a separate
 * concern from keeping the page visible.
 */

import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
  /** Shown above the error. Says which part failed, not that something failed. */
  where: string;
  /** Rendered instead of the default, when a caller wants to degrade further. */
  fallback?: (error: Error, reset: () => void) => ReactNode;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // Logged with the component stack, because the message alone rarely says
    // which part of the tree threw. This is what a person will be asked to
    // paste, so it has to be findable in the console rather than swallowed.
    console.error(`[sone] ${this.props.where} crashed`, error, info.componentStack);
  }

  private readonly reset = (): void => {
    this.setState({ error: null });
  };

  override render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;

    if (this.props.fallback) return this.props.fallback(error, this.reset);

    return (
      <div className="crash">
        <h2>{this.props.where} stopped working</h2>
        <p className="muted">
          Your work is stored as you type and is not lost by this. Reloading the
          page usually recovers it.
        </p>
        <p>
          <button type="button" className="primary" onClick={() => window.location.reload()}>
            Reload
          </button>{' '}
          <button type="button" className="btn" onClick={this.reset}>
            Try again
          </button>
        </p>
        {/* The message is shown rather than hidden behind a console: the person
            reporting this is the one who can copy it, and asking them to open
            developer tools first loses most reports. */}
        <details>
          <summary>Technical detail</summary>
          <pre className="crash-detail">
            {error.name}: {error.message}
            {error.stack ? `\n\n${error.stack}` : ''}
          </pre>
        </details>
      </div>
    );
  }
}
