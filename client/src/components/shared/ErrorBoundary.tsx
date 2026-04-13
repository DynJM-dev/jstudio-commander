import { Component } from 'react';
import type { ReactNode, ErrorInfo } from 'react';

const M = 'Montserrat, sans-serif';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('[ErrorBoundary]', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div
          className="min-h-screen flex items-center justify-center p-6"
          style={{ fontFamily: M, background: 'var(--color-bg-deep)' }}
        >
          <div className="glass-card p-8 max-w-lg text-center">
            <h2
              className="text-xl font-semibold mb-2"
              style={{ color: 'var(--color-error)' }}
            >
              Something went wrong
            </h2>
            <p
              className="text-sm mb-4"
              style={{ color: 'var(--color-text-secondary)' }}
            >
              {this.state.error?.message}
            </p>
            <button
              onClick={() => window.location.reload()}
              className="px-4 py-2 rounded-lg text-sm font-medium"
              style={{
                fontFamily: M,
                backgroundColor: 'var(--color-accent)',
                color: 'var(--color-text-primary)',
              }}
            >
              Reload
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
