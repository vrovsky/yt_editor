import React, { Component, ErrorInfo, ReactNode } from 'react';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
  onError?: (error: Error, errorInfo: ErrorInfo) => void;
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
    console.error('ErrorBoundary caught:', error, errorInfo);
    this.props.onError?.(error, errorInfo);
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError && this.state.error) {
      if (this.props.fallback) {
        return this.props.fallback;
      }
      return (
        <div
          style={{
            minHeight: '100dvh',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 24,
            background: 'var(--bg-base)',
            color: 'var(--text-primary)',
            fontFamily: 'var(--font-mono)',
          }}
        >
          <div style={{ fontSize: 32, marginBottom: 16, color: 'var(--danger)' }}>⚠</div>
          <h2 style={{ fontSize: 16, fontWeight: 600, margin: 0, marginBottom: 8 }}>
            Something went wrong
          </h2>
          <p
            style={{
              fontSize: 12,
              color: 'var(--text-muted)',
              maxWidth: 400,
              textAlign: 'center',
              marginBottom: 20,
            }}
          >
            {this.state.error.message}
          </p>
          <button className="btn btn-action" onClick={this.handleRetry} style={{ padding: '10px 20px' }}>
            Try again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

export default ErrorBoundary;
