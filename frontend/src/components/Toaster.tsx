import { useEffect } from "react";

export type ToastKind = "success" | "error" | "info";

export type Toast = {
  id: string;
  kind: ToastKind;
  title: string;
  message?: string;
  durationMs?: number;
  createdAt: number;
};

export function Toaster({
  toasts,
  onDismiss
}: {
  toasts: Toast[];
  onDismiss: (id: string) => void;
}) {
  useEffect(() => {
    if (!toasts.length) return;
    const timers = toasts.map((t) => {
      const ttl = Math.max(2200, Math.min(12000, t.kind === "error" ? 10000 : 5000));
      return window.setTimeout(() => onDismiss(t.id), ttl);
    });
    return () => timers.forEach((x) => window.clearTimeout(x));
  }, [toasts, onDismiss]);

  if (!toasts.length) return null;

  return (
    <div className="toaster" role="status" aria-live="polite" aria-label="Notifications">
      {toasts.map((t) => (
        <div key={t.id} className={`toast toast--${t.kind}`} role="status">
          <div className="toast-head">
            <div className="toast-title">{t.title}</div>
            <button
              type="button"
              className="toast-x"
              onClick={() => onDismiss(t.id)}
              aria-label="Dismiss notification"
              title="Dismiss"
            >
              ×
            </button>
          </div>
          <div className="toast-body">
            {t.message ? <div className="toast-msg">{t.message}</div> : null}
            {typeof t.durationMs === "number" ? (
              <div className="toast-meta">Took {formatMs(t.durationMs)}</div>
            ) : null}
          </div>
        </div>
      ))}
    </div>
  );
}

function formatMs(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "";
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(ms < 10000 ? 2 : 1)} s`;
}

