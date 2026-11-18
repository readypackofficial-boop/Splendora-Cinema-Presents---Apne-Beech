import React from 'react';

interface State {
  hasError: boolean;
  message: string;
}

export class ErrorBoundary extends React.Component<{ children: React.ReactNode }, State> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, message: '' };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, message: error.message || 'An unexpected error occurred.' };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-[#FAF5EB] text-[#2A1812] flex items-center justify-center p-6">
          <div className="max-w-lg w-full bg-[#FFFDF9] border border-[#C6A15B]/50 p-8 shadow-sm">
            <p className="text-xs uppercase tracking-[0.2em] text-[#7A5C44] mb-2">Splendora Cinema</p>
            <h1 className="font-display text-2xl font-semibold text-[#5B0E1D] mb-3">
              Something interrupted your session
            </h1>
            <p className="text-sm text-[#4A332B] mb-6 leading-relaxed break-words">
              {this.state.message}
            </p>
            <button
              onClick={() => window.location.reload()}
              className="px-5 py-2.5 bg-[#5B0E1D] text-[#FAF5EB] text-sm font-medium hover:bg-[#721627] transition-colors cursor-pointer"
            >
              Reload Application
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
