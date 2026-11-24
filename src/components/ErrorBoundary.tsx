import React from "react";
import { AlertTriangle, RotateCcw, Home } from "lucide-react";

interface ErrorBoundaryProps {
  children: React.ReactNode;
  fallbackTitle?: string;
  onRecover?: () => void;
  recoverLabel?: string;
  onBackHome?: () => void;
}

interface ErrorBoundaryState {
  hasError: boolean;
  errorMessage: string;
}

export default class ErrorBoundary extends React.Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, errorMessage: "" };
  }

  static getDerivedStateFromError(error: unknown): ErrorBoundaryState {
    const msg =
      error instanceof Error
        ? error.message || "Terjadi kesalahan render yang tidak terduga."
        : String(error || "Terjadi kesalahan render.");
    return { hasError: true, errorMessage: msg };
  }

  componentDidCatch(error: unknown, info: React.ErrorInfo) {
    console.error("[Synkcut ErrorBoundary] Runtime error caught:", error, info.componentStack);
  }

  handleRetry = () => {
    if (this.props.onRecover) {
      this.props.onRecover();
    }
    this.setState({ hasError: false, errorMessage: "" });
  };

  render() {
    if (!this.state.hasError) {
      return this.props.children;
    }

    return (
      <div
        className="flex h-screen w-full items-center justify-center p-6"
        style={{ backgroundColor: "var(--bg-app, #0d1016)", color: "var(--text-primary, #f1f3f7)" }}
      >
        <div
          className="w-full max-w-md rounded-2xl p-6 shadow-2xl space-y-4"
          style={{
            backgroundColor: "var(--bg-panel, #141820)",
            border: "1px solid var(--border-strong, rgba(255,255,255,0.14))",
          }}
        >
          <div className="flex items-start gap-3">
            <div
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl"
              style={{
                backgroundColor: "var(--danger-soft, rgba(244,63,94,0.15))",
                color: "var(--danger, #f43f5e)",
              }}
            >
              <AlertTriangle className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <h2 className="text-sm font-bold">
                {this.props.fallbackTitle || "Tampilan mengalami gangguan sementara"}
              </h2>
              <p
                className="mt-1 text-xs leading-relaxed"
                style={{ color: "var(--text-secondary, #9aa3b5)" }}
              >
                Synkcut menahan error agar data proyek lo tetap aman. Lo bisa langsung memulihkan
                tampilan tanpa kehilangan pekerjaan.
              </p>
            </div>
          </div>

          {this.state.errorMessage && (
            <div
              className="max-h-24 overflow-y-auto rounded-lg p-2.5 font-mono text-[11px] break-words"
              style={{
                backgroundColor: "var(--bg-elevated, #1b202b)",
                color: "var(--text-muted, #8a94a6)",
                border: "1px solid var(--border-subtle, rgba(255,255,255,0.08))",
              }}
            >
              {this.state.errorMessage}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2 pt-1">
            <button
              type="button"
              onClick={this.handleRetry}
              className="ui-btn-primary inline-flex h-9 flex-1 items-center justify-center gap-1.5 rounded-lg px-3.5 text-xs font-semibold cursor-pointer"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              {this.props.recoverLabel || "Pulihkan Tampilan"}
            </button>
            {this.props.onBackHome && (
              <button
                type="button"
                onClick={() => {
                  this.setState({ hasError: false, errorMessage: "" });
                  this.props.onBackHome?.();
                }}
                className="ui-btn-secondary inline-flex h-9 items-center justify-center gap-1.5 rounded-lg px-3.5 text-xs font-medium cursor-pointer"
              >
                <Home className="h-3.5 w-3.5" />
                Beranda
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }
}
