import { useEffect, useRef, useState } from "react";

type ToastKind = "success" | "error" | "info";

export type Toast = {
  id: string;
  kind: ToastKind;
  title: string;
  message?: string;
  durationMs?: number;
  createdAt: number;
  /** When true, still show during app true-fullscreen modes (e.g. Badges critical hints). */
  bypassTrueFullscreen?: boolean;
};

function toastTtlMs(kind: ToastKind): number {
  const base = kind === "error" ? 8200 : kind === "info" ? 4200 : 3600;
  return Math.max(2400, Math.min(12000, base));
}

function formatMs(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "";
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(ms < 10000 ? 2 : 1)} s`;
}

function ToastIcon({ kind }: { kind: ToastKind }) {
  if (kind === "success") {
    return (
      <svg viewBox="0 0 24 24" focusable="false" aria-hidden="true">
        <path d="M20 6L9 17l-5-5" />
      </svg>
    );
  }
  if (kind === "error") {
    return (
      <svg viewBox="0 0 24 24" focusable="false" aria-hidden="true">
        <circle cx="12" cy="12" r="8.25" />
        <path d="M12 8v5M12 15.75h.01" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" focusable="false" aria-hidden="true">
      <circle cx="12" cy="12" r="8.25" />
      <path d="M12 11.2v5M12 8.1h.01" />
    </svg>
  );
}

function ToastCard({
  toast,
  onDismiss
}: {
  toast: Toast;
  onDismiss: (id: string) => void;
}) {
  const ttl = toastTtlMs(toast.kind);
  const remainingRef = useRef(Math.max(400, ttl - (Date.now() - toast.createdAt)));
  const [paused, setPaused] = useState(false);
  const [progressKey, setProgressKey] = useState(0);

  useEffect(() => {
    if (paused) return;
    const started = Date.now();
    const budget = remainingRef.current;
    const timer = window.setTimeout(() => onDismiss(toast.id), budget);
    return () => {
      window.clearTimeout(timer);
      remainingRef.current = Math.max(400, budget - (Date.now() - started));
    };
  }, [paused, toast.id, onDismiss]);

  const hasDetail = Boolean(toast.message) || typeof toast.durationMs === "number";
  const live = toast.kind === "error" ? "assertive" : "polite";

  return (
    <div
      className={`toast toast--${toast.kind}`}
      role="status"
      aria-live={live}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => {
        setPaused(false);
        setProgressKey((k) => k + 1);
      }}
      onFocusCapture={() => setPaused(true)}
      onBlurCapture={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
          setPaused(false);
          setProgressKey((k) => k + 1);
        }
      }}
    >
      <div className="toast-icon" aria-hidden="true">
        <ToastIcon kind={toast.kind} />
      </div>

      <div className="toast-content">
        <div className="toast-head">
          <p className="toast-title">{toast.title}</p>
          <button
            type="button"
            className="toast-x"
            onClick={() => onDismiss(toast.id)}
            aria-label="Dismiss notification"
            title="Dismiss"
          >
            <svg viewBox="0 0 24 24" focusable="false" aria-hidden="true">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>

        {hasDetail ? (
          <div className="toast-body">
            {toast.message ? <p className="toast-msg">{toast.message}</p> : null}
            {typeof toast.durationMs === "number" ? (
              <span className="toast-meta">{formatMs(toast.durationMs)}</span>
            ) : null}
          </div>
        ) : null}
      </div>

      <div
        key={progressKey}
        className={`toast-progress${paused ? " is-paused" : ""}`}
        style={{ animationDuration: `${remainingRef.current}ms` }}
        aria-hidden="true"
      />
    </div>
  );
}

export function Toaster({
  toasts,
  onDismiss
}: {
  toasts: Toast[];
  onDismiss: (id: string) => void;
}) {
  // Hard cap: only the newest toast is shown (callers should also replace, not stack).
  const toast = toasts[0];
  if (!toast) return null;

  return (
    <div className="toaster" aria-label="Notifications">
      <ToastCard key={toast.id} toast={toast} onDismiss={onDismiss} />
    </div>
  );
}
