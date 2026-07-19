import { useEffect, useId, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { apiFetch } from "../apiClient";
import {
  clearAiKeys,
  hasAnyAiKey,
  hasGroqKey,
  loadAiKeys,
  looksLikeGroqKey,
  looksLikeTavilyKey,
  saveAiKeys,
  type AiKeyCheckState,
  type AiKeyProvider,
  type AiKeys
} from "../aiKeys";

type Props = {
  open: boolean;
  onClose: () => void;
};

type FieldCheck = {
  state: AiKeyCheckState;
  message: string | null;
};

const IDLE_CHECK: FieldCheck = { state: "idle", message: null };
const VALIDATE_DEBOUNCE_MS = 700;

function keysEqual(a: AiKeys, b: AiKeys): boolean {
  return a.groqApiKey === b.groqApiKey && a.tavilyApiKey === b.tavilyApiKey;
}

function formatHint(provider: AiKeyProvider, value: string): FieldCheck | null {
  const trimmed = value.trim();
  if (!trimmed) return IDLE_CHECK;
  if (provider === "groq" && !looksLikeGroqKey(trimmed)) {
    return { state: "format", message: "Groq keys usually start with gsk_." };
  }
  if (provider === "tavily" && !looksLikeTavilyKey(trimmed)) {
    return { state: "format", message: "Tavily keys usually start with tvly-." };
  }
  return null;
}

export function AiKeysModal({ open, onClose }: Props) {
  const titleId = useId();
  const descId = useId();
  const groqRef = useRef<HTMLInputElement | null>(null);
  const groqSeq = useRef(0);
  const tavilySeq = useRef(0);
  const [saved, setSaved] = useState<AiKeys>(() => loadAiKeys());
  const [draft, setDraft] = useState<AiKeys>(() => loadAiKeys());
  const [showGroq, setShowGroq] = useState(false);
  const [showTavily, setShowTavily] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedFlash, setSavedFlash] = useState(false);
  const [entered, setEntered] = useState(false);
  const [groqCheck, setGroqCheck] = useState<FieldCheck>(IDLE_CHECK);
  const [tavilyCheck, setTavilyCheck] = useState<FieldCheck>(IDLE_CHECK);

  useEffect(() => {
    if (!open) {
      setEntered(false);
      return;
    }
    const current = loadAiKeys();
    setSaved(current);
    setDraft(current);
    setError(null);
    setSavedFlash(false);
    setShowGroq(false);
    setShowTavily(false);
    setGroqCheck(IDLE_CHECK);
    setTavilyCheck(IDLE_CHECK);
    const t = window.setTimeout(() => setEntered(true), 16);
    const focusT = window.setTimeout(() => groqRef.current?.focus(), 50);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.clearTimeout(t);
      window.clearTimeout(focusT);
      document.body.style.overflow = prev;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  useEffect(() => {
    if (!open) return;
    const hint = formatHint("groq", draft.groqApiKey);
    if (hint) {
      setGroqCheck(hint);
      return;
    }
    if (!draft.groqApiKey.trim()) {
      setGroqCheck(IDLE_CHECK);
      return;
    }

    const seq = ++groqSeq.current;
    setGroqCheck({ state: "checking", message: "Checking with Groq…" });
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const res = await apiFetch("/api/ai-keys/validate", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ provider: "groq", apiKey: draft.groqApiKey.trim() })
          });
          if (seq !== groqSeq.current) return;
          const data = (await res.json()) as {
            valid?: boolean;
            reason?: string;
          };
          if (!res.ok) {
            setGroqCheck({
              state: "invalid",
              message: data.reason ?? "Could not validate this Groq key."
            });
            return;
          }
          setGroqCheck({
            state: data.valid ? "valid" : "invalid",
            message: data.valid
              ? data.reason ?? "Groq key looks valid."
              : data.reason ?? "This Groq key was rejected."
          });
        } catch (err) {
          console.error("[AiKeys] Groq validate failed", err);
          if (seq !== groqSeq.current) return;
          setGroqCheck({
            state: "invalid",
            message: "Could not reach the server to validate this key."
          });
        }
      })();
    }, VALIDATE_DEBOUNCE_MS);

    return () => window.clearTimeout(timer);
  }, [draft.groqApiKey, open]);

  useEffect(() => {
    if (!open) return;
    const hint = formatHint("tavily", draft.tavilyApiKey);
    if (hint) {
      setTavilyCheck(hint);
      return;
    }
    if (!draft.tavilyApiKey.trim()) {
      setTavilyCheck(IDLE_CHECK);
      return;
    }

    const seq = ++tavilySeq.current;
    setTavilyCheck({ state: "checking", message: "Checking with Tavily…" });
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const res = await apiFetch("/api/ai-keys/validate", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ provider: "tavily", apiKey: draft.tavilyApiKey.trim() })
          });
          if (seq !== tavilySeq.current) return;
          const data = (await res.json()) as {
            valid?: boolean;
            reason?: string;
          };
          if (!res.ok) {
            setTavilyCheck({
              state: "invalid",
              message: data.reason ?? "Could not validate this Tavily key."
            });
            return;
          }
          setTavilyCheck({
            state: data.valid ? "valid" : "invalid",
            message: data.valid
              ? data.reason ?? "Tavily key looks valid."
              : data.reason ?? "This Tavily key was rejected."
          });
        } catch (err) {
          console.error("[AiKeys] Tavily validate failed", err);
          if (seq !== tavilySeq.current) return;
          setTavilyCheck({
            state: "invalid",
            message: "Could not reach the server to validate this key."
          });
        }
      })();
    }, VALIDATE_DEBOUNCE_MS);

    return () => window.clearTimeout(timer);
  }, [draft.tavilyApiKey, open]);

  if (!open) return null;

  const dirty = !keysEqual(draft, saved);
  const groqReady = groqCheck.state === "valid";
  const groqNeeded = !draft.groqApiKey.trim() || groqCheck.state === "format" || groqCheck.state === "invalid";
  const tavilyReady = tavilyCheck.state === "valid";
  const checking = groqCheck.state === "checking" || tavilyCheck.state === "checking";
  const blockSave =
    (Boolean(draft.groqApiKey.trim()) && groqCheck.state !== "valid" && groqCheck.state !== "idle") ||
    (Boolean(draft.tavilyApiKey.trim()) && tavilyCheck.state !== "valid" && tavilyCheck.state !== "idle");

  const onSave = () => {
    setError(null);
    if (blockSave || checking) {
      setError("Wait for key checks to finish, or fix invalid keys before saving.");
      return;
    }
    try {
      saveAiKeys(draft);
      const next = {
        groqApiKey: draft.groqApiKey.trim(),
        tavilyApiKey: draft.tavilyApiKey.trim()
      };
      setSaved(next);
      setDraft(next);
      setSavedFlash(true);
      window.setTimeout(() => setSavedFlash(false), 1600);
      window.dispatchEvent(
        new CustomEvent("pst:toast", {
          detail: {
            kind: "success",
            title: "AI keys saved",
            message: hasGroqKey(next)
              ? "Stored in this browser for Productivity Summary."
              : "Saved. Add a valid Groq key to enable summaries.",
            durationMs: 3200
          }
        })
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Could not save keys.";
      setError(msg);
    }
  };

  const onClear = () => {
    setError(null);
    clearAiKeys();
    const empty = { groqApiKey: "", tavilyApiKey: "" };
    setSaved(empty);
    setDraft(empty);
    setShowGroq(false);
    setShowTavily(false);
    setGroqCheck(IDLE_CHECK);
    setTavilyCheck(IDLE_CHECK);
    window.dispatchEvent(
      new CustomEvent("pst:toast", {
        detail: {
          kind: "info",
          title: "AI keys cleared",
          message: "Local Groq and Tavily keys were removed from this browser.",
          durationMs: 2800
        }
      })
    );
  };

  const onDialogKeyDown = (e: ReactKeyboardEvent) => {
    if (!(e.metaKey || e.ctrlKey) || e.key !== "Enter") return;
    e.preventDefault();
    if (dirty && !blockSave && !checking) onSave();
  };

  const statusClass = (check: FieldCheck, emptyNeeded: boolean) => {
    if (check.state === "valid") return " is-ready";
    if (check.state === "checking") return " is-checking";
    if (check.state === "format" || check.state === "invalid") return " is-needed";
    if (emptyNeeded) return " is-needed";
    return " is-idle";
  };

  return createPortal(
    <div
      className={`aik-backdrop${entered ? " is-entered" : ""}`}
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className={`aik-shell${entered ? " is-entered" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descId}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={onDialogKeyDown}
      >
        <header className="aik-head">
          <div className="aik-head-copy">
            <div className="aik-eyebrow">Local browser</div>
            <h2 id={titleId} className="aik-title">
              AI keys
            </h2>
            <p id={descId} className="aik-desc">
              Used for Productivity Summary. Keys are checked automatically as you type.
            </p>
            <div className="aik-status-row" aria-label="Key status" aria-live="polite">
              <span className={`aik-status${statusClass(groqCheck, !draft.groqApiKey.trim())}`}>
                <span className="aik-status-dot" aria-hidden="true" />
                {groqCheck.state === "checking"
                  ? "Groq checking"
                  : groqReady
                    ? "Groq valid"
                    : groqNeeded
                      ? "Groq needed"
                      : "Groq"}
              </span>
              <span
                className={`aik-status${statusClass(tavilyCheck, false)}${
                  !draft.tavilyApiKey.trim() ? " is-idle" : ""
                }`}
              >
                <span className="aik-status-dot" aria-hidden="true" />
                {tavilyCheck.state === "checking"
                  ? "Tavily checking"
                  : tavilyReady
                    ? "Tavily valid"
                    : draft.tavilyApiKey.trim()
                      ? "Tavily invalid"
                      : "Tavily optional"}
              </span>
            </div>
          </div>
        </header>

        <div className="aik-body">
          <div
            className={`aik-card${
              groqCheck.state === "valid"
                ? " is-valid"
                : groqCheck.state === "format" || groqCheck.state === "invalid"
                  ? " is-invalid"
                  : groqCheck.state === "checking"
                    ? " is-checking"
                    : ""
            }`}
            style={{ animationDelay: "40ms" }}
          >
            <div className="aik-card-top">
              <div>
                <div className="aik-card-title">Groq</div>
                <div className="aik-card-sub">Required for summaries and Ask</div>
              </div>
              <a
                className="aik-link"
                href="https://console.groq.com/keys"
                target="_blank"
                rel="noopener noreferrer"
              >
                Get key
              </a>
            </div>
            <div className="aik-input-shell">
              <input
                ref={groqRef}
                type={showGroq ? "text" : "password"}
                autoComplete="off"
                spellCheck={false}
                value={draft.groqApiKey}
                onChange={(e) => setDraft((d) => ({ ...d, groqApiKey: e.target.value }))}
                placeholder="gsk_…"
                aria-label="Groq API key"
                aria-invalid={groqCheck.state === "format" || groqCheck.state === "invalid"}
              />
              <button
                type="button"
                className="aik-reveal"
                onClick={() => setShowGroq((v) => !v)}
                aria-pressed={showGroq}
                aria-label={showGroq ? "Hide Groq key" : "Show Groq key"}
              >
                {showGroq ? "Hide" : "Show"}
              </button>
            </div>
            {groqCheck.message && (
              <p className={`aik-field-msg is-${groqCheck.state}`}>{groqCheck.message}</p>
            )}
          </div>

          <div
            className={`aik-card${
              tavilyCheck.state === "valid"
                ? " is-valid"
                : tavilyCheck.state === "format" || tavilyCheck.state === "invalid"
                  ? " is-invalid"
                  : tavilyCheck.state === "checking"
                    ? " is-checking"
                    : ""
            }`}
            style={{ animationDelay: "90ms" }}
          >
            <div className="aik-card-top">
              <div>
                <div className="aik-card-title">Tavily</div>
                <div className="aik-card-sub">Optional web tips</div>
              </div>
              <a
                className="aik-link"
                href="https://app.tavily.com/home"
                target="_blank"
                rel="noopener noreferrer"
              >
                Get key
              </a>
            </div>
            <div className="aik-input-shell">
              <input
                type={showTavily ? "text" : "password"}
                autoComplete="off"
                spellCheck={false}
                value={draft.tavilyApiKey}
                onChange={(e) => setDraft((d) => ({ ...d, tavilyApiKey: e.target.value }))}
                placeholder="tvly_…"
                aria-label="Tavily API key"
                aria-invalid={tavilyCheck.state === "format" || tavilyCheck.state === "invalid"}
              />
              <button
                type="button"
                className="aik-reveal"
                onClick={() => setShowTavily((v) => !v)}
                aria-pressed={showTavily}
                aria-label={showTavily ? "Hide Tavily key" : "Show Tavily key"}
              >
                {showTavily ? "Hide" : "Show"}
              </button>
            </div>
            {tavilyCheck.message && (
              <p className={`aik-field-msg is-${tavilyCheck.state}`}>{tavilyCheck.message}</p>
            )}
          </div>

          <p className="aik-note">
            Keys are sent only to your Focista API for checks and summaries. Never logged or
            committed.
          </p>

          {error && (
            <div className="aik-error" role="alert">
              <strong>Could not save</strong>
              <span>{error}</span>
            </div>
          )}
        </div>

        <footer className="aik-foot">
          <button
            type="button"
            className="ghost-button"
            onClick={onClear}
            disabled={!hasAnyAiKey(draft) && !hasAnyAiKey(saved)}
          >
            Clear
          </button>
          <div className="aik-foot-right">
            <button type="button" className="ghost-button" onClick={onClose}>
              Cancel
            </button>
            <button
              type="button"
              className={`primary-button${savedFlash ? " aik-saved" : ""}`}
              onClick={onSave}
              disabled={(!dirty && !savedFlash) || blockSave || checking}
              title="Save (⌘/Ctrl+Enter)"
            >
              {savedFlash ? "Saved" : checking ? "Checking…" : "Save"}
            </button>
          </div>
        </footer>
      </div>
    </div>,
    document.body
  );
}
