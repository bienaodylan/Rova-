import React from 'react';

interface ErrorBoundaryState {
  hasError: boolean;
  message: string;
}

export class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  ErrorBoundaryState
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, message: '' };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    let cleanMsg = error.message || 'Une erreur inattendue est survenue.';
    try {
      const parsed = JSON.parse(error.message);
      if (parsed?.error) {
        cleanMsg = `${parsed.error}${parsed.path ? ` (${parsed.operationType} sur ${parsed.path})` : ''}`;
      }
    } catch {
      // Keep raw message
    }
    return { hasError: true, message: cleanMsg };
  }

  componentDidCatch(error: Error) {
    console.error('ROVA ErrorBoundary caught:', error);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-white text-neutral-950 flex items-center justify-center p-6">
          <div className="max-w-md w-full rounded-3xl border border-neutral-200 p-8 shadow-sm">
            <p className="text-xs font-mono tracking-wider uppercase text-neutral-500 mb-2">
              Notification ROVA
            </p>
            <h1 className="text-xl font-bold tracking-tight mb-3">
              Impossible de terminer cette opération
            </h1>
            <p className="text-sm text-neutral-600 leading-relaxed mb-6 break-words">
              {this.state.message}
            </p>
            <button
              onClick={() => {
                this.setState({ hasError: false, message: '' });
                window.location.reload();
              }}
              className="px-5 py-2.5 rounded-full bg-neutral-950 text-white text-sm font-medium hover:bg-neutral-800 transition-colors"
            >
              Recharger l’espace
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
