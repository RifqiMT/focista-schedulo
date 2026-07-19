import { useEffect, useId, useRef, useState } from "react";
import type { CSSProperties, FormEvent, KeyboardEvent as ReactKeyboardEvent, ReactNode } from "react";
import { createPortal } from "react-dom";
import { apiFetch } from "../apiClient";
import { AI_KEYS_CHANGED_EVENT, aiKeysRequestFields, hasGroqKey, loadAiKeys } from "../aiKeys";

export type SummaryPeriod =
  | "day"
  | "week"
  | "sprint"
  | "month"
  | "bimonth"
  | "quarter"
  | "semester"
  | "year"
  | "next_day"
  | "next_week"
  | "next_sprint"
  | "next_month"
  | "next_quarter"
  | "next_semester"
  | "next_year"
  | "custom";

type DigestStats = {
  totalInRange: number;
  completed: number;
  active: number;
  cancelled: number;
  overdue: number;
  completionRate: number;
};

type WebSource = { title: string; url: string; snippet?: string };

type DateRange = {
  startDate: string;
  endDate: string;
  period: SummaryPeriod;
  label: string;
};

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
  sources?: WebSource[];
};

type TimelineUnit =
  | "day"
  | "week"
  | "sprint"
  | "month"
  | "bimonth"
  | "quarter"
  | "semester"
  | "year"
  | "custom";

type TimelineOffset = "this" | "next";

type ModalTab = "overview" | "ask";

type Props = {
  open: boolean;
  onClose: () => void;
  activeProfileId: string | null;
  activeProfileName: string | null;
};

const TIMELINE_UNITS: {
  id: TimelineUnit;
  label: string;
  hintThis: string;
  hintNext: string;
  supportsNext: boolean;
}[] = [
  { id: "day", label: "Day", hintThis: "Today", hintNext: "Tomorrow", supportsNext: true },
  { id: "week", label: "Week", hintThis: "This week · Mon–Sun", hintNext: "Next week · Mon–Sun", supportsNext: true },
  { id: "sprint", label: "Sprint", hintThis: "Current sprint · 2 weeks", hintNext: "Next sprint · 2 weeks", supportsNext: true },
  { id: "month", label: "Month", hintThis: "This month", hintNext: "Next month", supportsNext: true },
  { id: "bimonth", label: "2 months", hintThis: "Last 2 months", hintNext: "Not available", supportsNext: false },
  { id: "quarter", label: "Quarter", hintThis: "This quarter", hintNext: "Next quarter", supportsNext: true },
  { id: "semester", label: "Half year", hintThis: "This half year", hintNext: "Next half year", supportsNext: true },
  { id: "year", label: "Year", hintThis: "This year", hintNext: "Next year", supportsNext: true },
  { id: "custom", label: "Custom", hintThis: "Pick dates", hintNext: "Pick dates", supportsNext: false }
];

const NEXT_PERIOD: Partial<Record<TimelineUnit, SummaryPeriod>> = {
  day: "next_day",
  week: "next_week",
  sprint: "next_sprint",
  month: "next_month",
  quarter: "next_quarter",
  semester: "next_semester",
  year: "next_year"
};

function resolveApiPeriod(unit: TimelineUnit, offset: TimelineOffset): SummaryPeriod {
  if (unit === "custom") return "custom";
  if (offset === "next") {
    const next = NEXT_PERIOD[unit];
    if (next) return next;
  }
  return unit;
}

function describeTimeline(unit: TimelineUnit, offset: TimelineOffset): { label: string; hint: string } {
  const meta = TIMELINE_UNITS.find((u) => u.id === unit);
  if (!meta) return { label: unit, hint: unit };
  if (unit === "custom") return { label: "Custom", hint: meta.hintThis };
  const useNext = offset === "next" && meta.supportsNext;
  if (unit === "day") {
    return {
      label: useNext ? "Tomorrow" : "Today",
      hint: useNext ? meta.hintNext : meta.hintThis
    };
  }
  if (unit === "bimonth") {
    return { label: "2 months", hint: meta.hintThis };
  }
  const noun = meta.label.toLowerCase();
  return {
    label: useNext ? `Next ${noun}` : `This ${noun}`,
    hint: useNext ? meta.hintNext : meta.hintThis
  };
}

const ASK_SUGGESTIONS = [
  "What is overdue?",
  "What did I finish?",
  "Which urgent tasks remain?",
  "Where should I focus next?"
];

function todayIsoLocal(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function makeMsgId(): string {
  return `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
}

function formatDisplayDate(iso: string): string {
  const d = new Date(`${iso}T12:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

/** Render plain-English AI text with simple paragraph / bullet structure. */
function renderPlainProse(text: string): ReactNode {
  const blocks = text
    .split(/\n{2,}/)
    .map((b) => b.trim())
    .filter(Boolean);

  return blocks.map((block, i) => {
    const lines = block.split("\n").map((l) => l.trim()).filter(Boolean);
    const bulletLines = lines.filter((l) => /^[-•*]\s+/.test(l));
    const labelLines = lines.filter((l) => !/^[-•*]\s+/.test(l));

    // Section label + bullets (e.g. "Open tasks:" then "- ...")
    if (
      bulletLines.length >= 1 &&
      labelLines.length >= 1 &&
      labelLines.length + bulletLines.length === lines.length &&
      /^[-•*]\s+/.test(lines[lines.length - 1]!)
    ) {
      const firstBulletIdx = lines.findIndex((l) => /^[-•*]\s+/.test(l));
      const labels = lines.slice(0, firstBulletIdx);
      const items = lines.slice(firstBulletIdx);
      if (items.every((l) => /^[-•*]\s+/.test(l))) {
        return (
          <div key={i} className="ps-prose-section">
            {labels.map((label, j) => (
              <p key={`l-${j}`} className="ps-prose-section-label">
                {label}
              </p>
            ))}
            <ul className="ps-prose-list">
              {items.map((line, j) => (
                <li key={j}>{line.replace(/^[-•*]\s+/, "")}</li>
              ))}
            </ul>
          </div>
        );
      }
    }

    if (bulletLines.length >= 1 && bulletLines.length === lines.length) {
      return (
        <ul key={i} className="ps-prose-list">
          {lines.map((line, j) => (
            <li key={j}>{line.replace(/^[-•*]\s+/, "")}</li>
          ))}
        </ul>
      );
    }
    return (
      <p key={i}>
        {lines.map((line, j) => (
          <span key={j}>
            {j > 0 ? <br /> : null}
            {line.replace(/^[-•*]\s+/, "• ")}
          </span>
        ))}
      </p>
    );
  });
}

function scopeKey(
  period: SummaryPeriod,
  customStart: string,
  customEnd: string
): string {
  return period === "custom" ? `custom:${customStart}:${customEnd}` : period;
}

function toast(kind: "success" | "error" | "info", title: string, message: string) {
  window.dispatchEvent(
    new CustomEvent("pst:toast", {
      detail: { kind, title, message, durationMs: 2800 }
    })
  );
}

async function readApiError(res: Response): Promise<string> {
  try {
    const data = (await res.json()) as { error?: string | { formErrors?: string[] } };
    if (typeof data.error === "string") return data.error;
    if (data.error && typeof data.error === "object" && Array.isArray(data.error.formErrors)) {
      return data.error.formErrors.join("; ") || res.statusText;
    }
  } catch {
    /* ignore */
  }
  if (res.status === 503) {
    return "Add a Groq API key via AI keys in the header, or set GROQ_API_KEY on the server.";
  }
  if (res.status === 502) {
    return "The AI service is temporarily unavailable. Please try again in a few minutes.";
  }
  return "Something went wrong—please try again.";
}

export function ProductivitySummaryModal({
  open,
  onClose,
  activeProfileId,
  activeProfileName
}: Props) {
  const titleId = useId();
  const descId = useId();
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const chatEndRef = useRef<HTMLDivElement | null>(null);
  const askInputRef = useRef<HTMLInputElement | null>(null);
  const periodScrollRef = useRef<HTMLDivElement | null>(null);
  const generateBtnRef = useRef<HTMLButtonElement | null>(null);
  const [tab, setTab] = useState<ModalTab>("overview");
  const [unit, setUnit] = useState<TimelineUnit>("week");
  const [offset, setOffset] = useState<TimelineOffset>("this");
  const [customStart, setCustomStart] = useState(todayIsoLocal());
  const [customEnd, setCustomEnd] = useState(todayIsoLocal());
  const [enrichWithWeb, setEnrichWithWeb] = useState(true);
  const [summaryBusy, setSummaryBusy] = useState(false);
  const [askBusy, setAskBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summaryText, setSummaryText] = useState<string | null>(null);
  const [summaryRange, setSummaryRange] = useState<DateRange | null>(null);
  const [summaryStats, setSummaryStats] = useState<DigestStats | null>(null);
  const [summarySources, setSummarySources] = useState<WebSource[]>([]);
  const [summaryScope, setSummaryScope] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);
  const [degraded, setDegraded] = useState(false);
  const [question, setQuestion] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [localHasGroq, setLocalHasGroq] = useState(() => hasGroqKey());
  const [contentKey, setContentKey] = useState(0);

  const profileLabel = activeProfileId
    ? activeProfileName ?? "Selected profile"
    : "All profiles";
  const unitMeta = TIMELINE_UNITS.find((u) => u.id === unit);
  const effectiveOffset: TimelineOffset =
    unitMeta && !unitMeta.supportsNext ? "this" : offset;
  const period = resolveApiPeriod(unit, effectiveOffset);
  const periodMeta = describeTimeline(unit, effectiveOffset);

  useEffect(() => {
    const sync = () => setLocalHasGroq(hasGroqKey(loadAiKeys()));
    sync();
    window.addEventListener(AI_KEYS_CHANGED_EVENT, sync);
    return () => window.removeEventListener(AI_KEYS_CHANGED_EVENT, sync);
  }, []);

  useEffect(() => {
    if (!open) return;
    const focusT = window.setTimeout(() => closeRef.current?.focus(), 40);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
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
    if (open) return;
    setError(null);
    setSummaryBusy(false);
    setAskBusy(false);
  }, [open]);

  useEffect(() => {
    if (!open || tab !== "ask") return;
    chatEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, askBusy, open, tab]);

  useEffect(() => {
    if (open && tab === "ask") {
      const t = window.setTimeout(() => askInputRef.current?.focus(), 80);
      return () => window.clearTimeout(t);
    }
  }, [open, tab]);

  useEffect(() => {
    setContentKey((k) => k + 1);
  }, [tab]);

  useEffect(() => {
    const host = periodScrollRef.current;
    if (!host || !open) return;
    const active = host.querySelector<HTMLElement>(".ps-period.is-active");
    active?.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
  }, [unit, open]);

  const profilePayload = activeProfileId ? { profileId: activeProfileId } : { profileId: null };
  const periodBody =
    period === "custom" ? { startDate: customStart, endDate: customEnd } : {};
  const currentScope = scopeKey(period, customStart, customEnd);

  const generateSummary = async () => {
    setError(null);
    setSummaryBusy(true);
    setTab("overview");
    try {
      const res = await apiFetch("/api/productivity-summary", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...profilePayload,
          period,
          enrichWithWeb,
          ...periodBody,
          ...aiKeysRequestFields()
        })
      });
      if (!res.ok) {
        setError(await readApiError(res));
        return;
      }
      const data = (await res.json()) as {
        summary: string;
        range: DateRange;
        stats: DigestStats;
        sources?: WebSource[];
        degraded?: boolean;
      };
      setSummaryText(data.summary);
      setSummaryRange(data.range);
      setSummaryStats(data.stats);
      setSummarySources(data.sources ?? []);
      setSummaryScope(currentScope);
      setDegraded(Boolean(data.degraded));
      setCopied(false);
      setGeneratedAt(
        new Date().toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })
      );
      setContentKey((k) => k + 1);
    } catch (err) {
      console.error("[ProductivitySummary] generate failed", err);
      setError(
        "Could not reach the summary service. Check that the backend is running, then try again."
      );
    } finally {
      setSummaryBusy(false);
    }
  };

  const askQuestion = async (raw?: string, e?: FormEvent) => {
    e?.preventDefault();
    const q = (raw ?? question).trim();
    if (!q || askBusy) return;
    setError(null);
    setAskBusy(true);
    setTab("ask");
    setMessages((prev) => [...prev, { id: makeMsgId(), role: "user", text: q }]);
    setQuestion("");
    try {
      const res = await apiFetch("/api/productivity-summary/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...profilePayload,
          question: q,
          period,
          enrichWithWeb,
          ...periodBody,
          ...aiKeysRequestFields()
        })
      });
      if (!res.ok) {
        const msg = await readApiError(res);
        setError(msg);
        setMessages((prev) => [...prev, { id: makeMsgId(), role: "assistant", text: msg }]);
        return;
      }
      const data = (await res.json()) as {
        answer: string;
        sources?: WebSource[];
        degraded?: boolean;
      };
      setMessages((prev) => [
        ...prev,
        {
          id: makeMsgId(),
          role: "assistant",
          text: data.answer,
          sources: data.sources
        }
      ]);
      if (data.degraded) {
        toast(
          "info",
          "Local answer",
          "AI writing is temporarily unavailable. Showing a digest-based answer."
        );
      }    } catch (err) {
      console.error("[ProductivitySummary] ask failed", err);
      const msg = "Something went wrong—please try again.";
      setError(msg);
      setMessages((prev) => [...prev, { id: makeMsgId(), role: "assistant", text: msg }]);
    } finally {
      setAskBusy(false);
    }
  };

  const clearChat = () => {
    setMessages([]);
    setQuestion("");
    setError(null);
  };

  const copySummary = async () => {
    if (!summaryText) return;
    try {
      await navigator.clipboard.writeText(summaryText);
      setCopied(true);
      toast("success", "Copied", "Summary copied to the clipboard.");
      window.setTimeout(() => setCopied(false), 1800);
    } catch (err) {
      console.error("[ProductivitySummary] copy failed", err);
      toast("error", "Copy failed", "Could not copy the summary.");
    }
  };

  if (!open) return null;

  const hasSummary = Boolean(summaryText && summaryStats && summaryRange);
  const isStale = hasSummary && summaryScope != null && summaryScope !== currentScope;
  const busy = summaryBusy || askBusy;

  const onDialogKeyDown = (e: ReactKeyboardEvent) => {
    if (!(e.metaKey || e.ctrlKey) || e.key !== "Enter") return;
    e.preventDefault();
    if (busy) return;
    if (tab === "overview") void generateSummary();
    else void askQuestion();
  };

  return createPortal(
    <div
      className="badge-modal-backdrop ps-backdrop"
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="badge-modal productivity-modal pa-pro-shell ps-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descId}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={onDialogKeyDown}
      >
        <header className="badge-modal-head productivity-modal-head pa-header ps-head">
          <div className="pa-header-row ps-head-row">
            <div className="pa-header-copy ps-head-copy">
              <div className="ps-eyebrow">AI brief</div>
              <div id={titleId} className="badge-modal-title pa-title ps-title">
                Productivity summary
              </div>
              <div id={descId} className="badge-modal-sub pa-subtitle ps-meta">
                <span className="ps-meta-chip">
                  <span className="ps-meta-k">Profile</span>
                  <span className="ps-meta-v">{profileLabel}</span>
                </span>
                {periodMeta ? (
                  <span className="ps-meta-chip">
                    <span className="ps-meta-k">Timeline</span>
                    <span className="ps-meta-v">{periodMeta.label}</span>
                  </span>
                ) : null}
                {hasSummary && summaryRange && !isStale ? (
                  <span className="ps-meta-chip is-quiet">
                    <span className="ps-meta-k">Range</span>
                    <span className="ps-meta-v">
                      {formatDisplayDate(summaryRange.startDate)} –{" "}
                      {formatDisplayDate(summaryRange.endDate)}
                    </span>
                  </span>
                ) : null}
              </div>
            </div>
            <div className="ps-header-actions">
              <span
                className={`ps-status-pill${localHasGroq ? " is-ready" : " is-needed"}`}
                title={
                  localHasGroq
                    ? "Groq key is available (local or server)"
                    : "Add a Groq key via AI keys in the header"
                }
              >
                <span className="ps-status-dot" aria-hidden="true" />
                {localHasGroq ? "Ready" : "Key needed"}
              </span>
              <button
                ref={closeRef}
                type="button"
                className="pa-close-round"
                onClick={onClose}
                aria-label="Close productivity summary"
                title="Close (Esc)"
              >
                <span aria-hidden="true">×</span>
              </button>
            </div>
          </div>

          <div className="pa-controls-strip ps-controls-strip" role="toolbar" aria-label="Summary filters">
            <div className="ps-toolbar-row">
              <div className="ps-tabs" role="tablist" aria-label="Summary mode">
                <span
                  className={`ps-tab-slider${tab === "ask" ? " is-ask" : ""}`}
                  aria-hidden="true"
                />
                <button
                  type="button"
                  role="tab"
                  aria-selected={tab === "overview"}
                  className={`ps-tab${tab === "overview" ? " is-active" : ""}`}
                  onClick={() => setTab("overview")}
                >
                  Overview
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={tab === "ask"}
                  className={`ps-tab${tab === "ask" ? " is-active" : ""}`}
                  onClick={() => setTab("ask")}
                >
                  Ask
                  {messages.length > 0 ? (
                    <span className="ps-tab-count" aria-hidden="true">
                      {messages.filter((m) => m.role === "user").length}
                    </span>
                  ) : null}
                </button>
              </div>

              <div className="ps-toolbar-right">
                <label
                  className={`ps-switch${enrichWithWeb ? " is-on" : ""}`}
                  title="Include optional web tips via Tavily"
                >
                  <input
                    type="checkbox"
                    checked={enrichWithWeb}
                    onChange={(e) => setEnrichWithWeb(e.target.checked)}
                  />
                  <span className="ps-switch-track" aria-hidden="true">
                    <span className="ps-switch-thumb" />
                  </span>
                  <span className="ps-switch-label">Web tips</span>
                </label>
                {tab === "overview" && (
                  <button
                    ref={generateBtnRef}
                    type="button"
                    className={`primary-button small ps-primary-cta${isStale ? " ps-cta-pulse" : ""}`}
                    onClick={() => void generateSummary()}
                    disabled={busy}
                    title="Generate summary (⌘/Ctrl+Enter)"
                  >
                    {summaryBusy ? "Writing…" : isStale ? "Update" : hasSummary ? "Refresh" : "Generate"}
                  </button>
                )}
                {tab === "ask" && messages.length > 0 && (
                  <button
                    type="button"
                    className="ghost-button small"
                    onClick={clearChat}
                    disabled={busy}
                  >
                    Clear
                  </button>
                )}
              </div>
            </div>

            <div className="ps-period-block">
              <div className="ps-period-head">
                <div className="ps-field-label">Timeline</div>
                <div className="ps-period-hint">{periodMeta.hint}</div>
              </div>

              <div className="ps-timeline-row">
                <div
                  className={`ps-offset${unitMeta && !unitMeta.supportsNext ? " is-disabled" : ""}`}
                  role="group"
                  aria-label="Timeline offset"
                >
                  <button
                    type="button"
                    className={`ps-offset-btn${effectiveOffset === "this" ? " is-active" : ""}`}
                    aria-pressed={effectiveOffset === "this"}
                    disabled={Boolean(unitMeta && !unitMeta.supportsNext)}
                    onClick={() => setOffset("this")}
                  >
                    This
                  </button>
                  <button
                    type="button"
                    className={`ps-offset-btn${effectiveOffset === "next" ? " is-active" : ""}`}
                    aria-pressed={effectiveOffset === "next"}
                    disabled={Boolean(unitMeta && !unitMeta.supportsNext)}
                    title={
                      unitMeta && !unitMeta.supportsNext
                        ? "Next is not available for this timeline"
                        : "Upcoming period"
                    }
                    onClick={() => setOffset("next")}
                  >
                    Next
                  </button>
                </div>

                <div className="ps-period-fade">
                  <div
                    ref={periodScrollRef}
                    className="ps-period-scroll"
                    role="group"
                    aria-label="Timeline unit"
                  >
                    {TIMELINE_UNITS.map((u) => (
                      <button
                        key={u.id}
                        type="button"
                        className={`ps-period${unit === u.id ? " is-active" : ""}`}
                        aria-pressed={unit === u.id}
                        title={
                          offset === "next" && u.supportsNext ? u.hintNext : u.hintThis
                        }
                        onClick={() => {
                          setUnit(u.id);
                          if (!u.supportsNext) setOffset("this");
                        }}
                      >
                        <span className="ps-period-label">{u.label}</span>
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            {unit === "custom" && (
              <div className="ps-custom">
                <label className="ps-date">
                  <span>From</span>
                  <input
                    type="date"
                    value={customStart}
                    onChange={(e) => setCustomStart(e.target.value)}
                  />
                </label>
                <span className="ps-custom-sep" aria-hidden="true">
                  →
                </span>
                <label className="ps-date">
                  <span>To</span>
                  <input
                    type="date"
                    value={customEnd}
                    onChange={(e) => setCustomEnd(e.target.value)}
                  />
                </label>
              </div>
            )}
          </div>
        </header>

        <div className="productivity-modal-body pa-body ps-body">
          {error && (
            <div className="ps-error" role="alert">
              <div className="ps-error-copy">
                <strong>Could not complete request</strong>
                <span>{error}</span>
              </div>
              <button type="button" className="ghost-button small" onClick={() => setError(null)}>
                Dismiss
              </button>
            </div>
          )}

          {tab === "overview" ? (
            <div className="ps-panel" role="tabpanel" aria-label="Overview" key={`ov-${contentKey}`}>
              {summaryBusy && (
                <div className="ps-loading-card" aria-busy="true">
                  <div className="ps-loading-top">
                    <div className="ps-loading">
                      <span className="pa-loading-dot" />
                      <span className="pa-loading-dot" />
                      <span className="pa-loading-dot" />
                      <span className="ps-loading-text">Writing your summary…</span>
                    </div>
                    <span className="ps-loading-chip">Analyzing timeline</span>
                  </div>
                  <div className="ps-skeleton-metrics" aria-hidden="true">
                    <span />
                    <span />
                    <span />
                    <span />
                  </div>
                  <div className="ps-skeleton-lines" aria-hidden="true">
                    <span />
                    <span />
                    <span />
                    <span />
                  </div>
                </div>
              )}

              {!summaryBusy && hasSummary && summaryStats && summaryRange && (
                <div className={`ps-result${isStale ? " is-stale" : ""}`}>
                  {degraded && (
                    <div className="ps-degraded" role="status">
                      <strong>Local brief</strong>
                      <span>
                        AI writing is temporarily unavailable (often a rate limit). Showing a
                        factual timeline brief from your tasks instead.
                      </span>
                    </div>
                  )}
                  {isStale && (
                    <div className="ps-stale" role="status">
                      <div className="ps-stale-copy">
                        <strong>Timeline changed</strong>
                        <span>
                          This brief is for a different period. Update to match{" "}
                          {periodMeta?.label ?? "the selection"}.
                        </span>
                      </div>
                      <button
                        type="button"
                        className="primary-button small"
                        onClick={() => void generateSummary()}
                        disabled={busy}
                      >
                        Update
                      </button>
                    </div>
                  )}

                  <div className="ps-metrics" aria-label="Period snapshot">
                    <div className="ps-metric" style={{ animationDelay: "0ms" }}>
                      <span className="ps-metric-mark is-done" aria-hidden="true" />
                      <span className="ps-metric-k">Completed</span>
                      <span className="ps-metric-v">{summaryStats.completed}</span>
                      <span className="ps-metric-s">{summaryRange.label}</span>
                    </div>
                    <div className="ps-metric" style={{ animationDelay: "50ms" }}>
                      <span className="ps-metric-mark is-open" aria-hidden="true" />
                      <span className="ps-metric-k">Open</span>
                      <span className="ps-metric-v">{summaryStats.active}</span>
                      <span className="ps-metric-s">Remaining</span>
                    </div>
                    <div
                      className={`ps-metric${summaryStats.overdue > 0 ? " is-warn" : ""}`}
                      style={{ animationDelay: "100ms" }}
                    >
                      <span className="ps-metric-mark is-late" aria-hidden="true" />
                      <span className="ps-metric-k">Overdue</span>
                      <span className="ps-metric-v">{summaryStats.overdue}</span>
                      <span className="ps-metric-s">
                        {summaryStats.overdue > 0 ? "Needs attention" : "On track"}
                      </span>
                    </div>
                    <div className="ps-metric is-accent" style={{ animationDelay: "150ms" }}>
                      <div
                        className="ps-rate-ring"
                        style={
                          {
                            "--ps-rate": `${Math.max(0, Math.min(100, summaryStats.completionRate))}`
                          } as CSSProperties
                        }
                        aria-hidden="true"
                      >
                        <span>{Math.round(summaryStats.completionRate)}%</span>
                      </div>
                      <div className="ps-rate-copy">
                        <span className="ps-metric-k">Completion</span>
                        <span className="ps-metric-s">
                          {formatDisplayDate(summaryRange.startDate)} –{" "}
                          {formatDisplayDate(summaryRange.endDate)}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="ps-prose-wrap">
                    <div className="ps-prose-bar">
                      <div className="ps-prose-bar-left">
                        <span className="ps-prose-bar-label">Brief</span>
                        {generatedAt ? (
                          <span className="ps-prose-bar-time">Generated {generatedAt}</span>
                        ) : null}
                      </div>
                      <button
                        type="button"
                        className={`ghost-button small ps-copy-btn${copied ? " is-copied" : ""}`}
                        onClick={() => void copySummary()}
                        disabled={!summaryText}
                      >
                        {copied ? "Copied" : "Copy"}
                      </button>
                    </div>
                    <article className="ps-prose" tabIndex={0} aria-label="Summary narrative">
                      {renderPlainProse(summaryText!)}
                    </article>
                  </div>

                  {summarySources.length > 0 && (
                    <div className="ps-citations">
                      <div className="ps-citations-label">Sources</div>
                      <ul>
                        {summarySources.map((s, i) => (
                          <li key={s.url}>
                            <a href={s.url} target="_blank" rel="noopener noreferrer">
                              <span className="ps-cite-idx">[{i + 1}]</span>
                              <span className="ps-cite-title">{s.title}</span>
                            </a>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}

              {!summaryBusy && !hasSummary && (
                <div className="ps-empty">
                  <div className="ps-empty-visual" aria-hidden="true">
                    <span className="ps-empty-orb" />
                    <span className="ps-empty-orb is-2" />
                    <span className="ps-empty-orb is-3" />
                  </div>
                  <h3>Create a period overview</h3>
                  <p>
                    Choose a timeline, then generate a clear brief of completed work, open items,
                    and what to focus on next.
                  </p>
                  <div className="ps-empty-rail" aria-hidden="true">
                    <div className="ps-empty-step">
                      <span>1</span>
                      <em>Timeline</em>
                    </div>
                    <div className="ps-empty-step">
                      <span>2</span>
                      <em>Web tips</em>
                    </div>
                    <div className="ps-empty-step">
                      <span>3</span>
                      <em>Generate</em>
                    </div>
                  </div>
                  <div className="ps-empty-actions">
                    <button
                      type="button"
                      className="primary-button"
                      onClick={() => void generateSummary()}
                      disabled={busy}
                    >
                      Generate summary
                    </button>
                    <span className="ps-kbd-hint">⌘/Ctrl + Enter</span>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div
              className="ps-panel ps-panel--ask"
              role="tabpanel"
              aria-label="Ask"
              key={`ask-${contentKey}`}
            >
              <div className="ps-chat" role="log" aria-live="polite">
                {messages.length === 0 && !askBusy && (
                  <div className="ps-empty ps-empty--ask">
                    <div className="ps-empty-visual ps-empty-visual--sm" aria-hidden="true">
                      <span className="ps-empty-orb" />
                      <span className="ps-empty-orb is-2" />
                    </div>
                    <h3>Ask about this timeline</h3>
                    <p>
                      Answers come from your to-do list for{" "}
                      <strong>{periodMeta?.label ?? "the selected period"}</strong>
                      {periodMeta ? ` · ${periodMeta.hint}` : ""}.
                    </p>
                    <div className="ps-suggestions" role="group" aria-label="Suggested questions">
                      {ASK_SUGGESTIONS.map((s, idx) => (
                        <button
                          key={s}
                          type="button"
                          className="ps-suggestion"
                          style={{ animationDelay: `${idx * 40}ms` }}
                          onClick={() => void askQuestion(s)}
                          disabled={busy}
                        >
                          {s}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {messages.map((m, idx) => (
                  <div
                    key={m.id}
                    className={`ps-bubble ps-bubble--${m.role}`}
                    style={{ animationDelay: `${Math.min(idx, 6) * 30}ms` }}
                  >
                    <div className="ps-bubble-meta">
                      {m.role === "user" ? "You" : "Assistant"}
                    </div>
                    <div className="ps-bubble-text">
                      {m.role === "assistant" ? renderPlainProse(m.text) : m.text}
                    </div>
                    {m.sources && m.sources.length > 0 && (
                      <ul className="ps-bubble-sources">
                        {m.sources.map((s, i) => (
                          <li key={s.url}>
                            <a href={s.url} target="_blank" rel="noopener noreferrer">
                              [{i + 1}] {s.title}
                            </a>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                ))}

                {askBusy && (
                  <div className="ps-bubble ps-bubble--assistant ps-bubble--typing">
                    <div className="ps-bubble-meta">Assistant</div>
                    <div className="ps-loading ps-loading--inline" aria-label="Thinking">
                      <span className="pa-loading-dot" />
                      <span className="pa-loading-dot" />
                      <span className="pa-loading-dot" />
                    </div>
                  </div>
                )}
                <div ref={chatEndRef} />
              </div>

              <form className="ps-composer" onSubmit={(e) => void askQuestion(undefined, e)}>
                <div className="ps-composer-shell">
                  <input
                    ref={askInputRef}
                    type="text"
                    className="ps-composer-input"
                    value={question}
                    onChange={(e) => setQuestion(e.target.value)}
                    placeholder="Ask about open work, overdue items, priorities…"
                    aria-label="Question about your tasks"
                    disabled={busy}
                    maxLength={2000}
                  />
                  <button
                    type="submit"
                    className="primary-button small"
                    disabled={busy || !question.trim()}
                    title="Ask (⌘/Ctrl+Enter)"
                  >
                    Ask
                  </button>
                </div>
                <div className="ps-composer-hint">Grounded in the selected timeline · ⌘/Ctrl+Enter</div>
              </form>
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
