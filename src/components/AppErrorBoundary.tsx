import React from "react";
import { AlertTriangle, RotateCcw } from "lucide-react";

interface AppErrorBoundaryProps {
  children: React.ReactNode;
}

interface AppErrorBoundaryState {
  hasError: boolean;
  errorMessage: string;
}

/**
 * Root React ErrorBoundary so unexpected render exceptions present a styled,
 * theme-safe recovery screen instead of leaving the Tauri WebView blank.
 */
export class AppErrorBoundary extends React.Component<
  AppErrorBoundaryProps,
  AppErrorBoundaryState
> {
  constructor(props: AppErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, errorMessage: "" };
  }

  static getDerivedStateFromError(error: unknown): AppErrorBoundaryState {
    const raw =
      error instanceof Error
        ? error.message
        : typeof error === "string"
        ? error
        : "Unexpected rendering error";
    return {
      hasError: true,
      errorMessage: raw || "Unexpected rendering error",
    };
  }

  override componentDidCatch(error: unknown, info: React.ErrorInfo): void {
    console.error("Audify UI ErrorBoundary caught error:", error, info);
  }

  private handleReset = (): void => {
    this.setState({ hasError: false, errorMessage: "" });
  };

  private handleReload = (): void => {
    if (typeof window !== "undefined") {
      window.location.reload();
    }
  };

  override render(): React.ReactNode {
    if (!this.state.hasError) {
      return this.props.children;
    }

    return (
      <div
        role="alert"
        className="flex items-center justify-center h-screen w-screen bg-surface-0 text-fg p-4 select-none"
      >
        <div className="w-full max-w-[420px] rounded-sm bg-surface-1 border border-line-strong shadow-2xl overflow-hidden">
          <div className="h-[34px] px-3 border-b border-line bg-surface-header flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-danger shrink-0" />
            <span className="text-[12px] font-semibold text-fg truncate">
              Audify Recovery Mode
            </span>
          </div>

          <div className="p-3.5 space-y-2.5 text-[11.5px]">
            <p className="text-fg-2 leading-relaxed">
              An unexpected interface error occurred. Your audio files and database
              remain untouched.
            </p>
            <div className="p-2 rounded-xs bg-surface-2 border border-line font-mono text-[10.5px] text-fg break-words max-h-[96px] overflow-y-auto select-text">
              {this.state.errorMessage}
            </div>
          </div>

          <div className="px-3.5 py-2.5 border-t border-line bg-surface-header flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={this.handleReset}
              className="h-[26px] px-3 rounded-xs bg-surface-2 hover:bg-surface-3 border border-line text-[11px] font-medium text-fg-2 hover:text-fg transition-colors cursor-pointer"
            >
              Try Recover
            </button>
            <button
              type="button"
              onClick={this.handleReload}
              className="h-[26px] px-3 rounded-xs bg-accent-soft hover:bg-accent hover:text-accent-on border border-accent text-[11px] font-semibold text-accent-fg inline-flex items-center gap-1.5 transition-colors cursor-pointer"
            >
              <RotateCcw className="w-3 h-3 shrink-0" />
              <span>Reload Window</span>
            </button>
          </div>
        </div>
      </div>
    );
  }
}
