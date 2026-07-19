import { Task, stripDoubleColonSuffix } from "./TaskBoard";
import { useEffect, useRef, useState } from "react";

interface TaskEditorDrawerProps {
  task: Task | Task[] | null;
  onClose: () => void;
  onSave: (task: Task | Task[]) => void | Promise<void>;
  // Emits live label tokens while user edits, so the board/hovercard can update
  // before "Save task" is pressed.
  onLabelsDraftChange?: (labels: string[]) => void;
  // Emits live link tokens while user edits, so the board/hovercard can update
  // before "Save task" is pressed.
  onLinksDraftChange?: (links: string[]) => void;
}

type SpeechRecognitionCtor = new () => {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((ev: any) => void) | null;
  onerror: ((ev: any) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
};

export function TaskEditorDrawer({
  task,
  onClose,
  onSave,
  onLabelsDraftChange,
  onLinksDraftChange
}: TaskEditorDrawerProps) {
  const [draft, setDraft] = useState<Task | null>(Array.isArray(task) ? task[0] ?? null : task);
  const [createMode, setCreateMode] = useState<"single" | "multiple">("single");
  const [copiedIdKey, setCopiedIdKey] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveProgress, setSaveProgress] = useState(0);
  const [saveStage, setSaveStage] = useState("Saving…");
  const copiedIdTimerRef = useRef<number | null>(null);
  const saveProgressTimerRef = useRef<number | null>(null);

  const copyIdValue = (key: string, value: string) => {
    void (async () => {
      try {
        await navigator.clipboard.writeText(value);
        if (copiedIdTimerRef.current != null) {
          window.clearTimeout(copiedIdTimerRef.current);
        }
        setCopiedIdKey(key);
        copiedIdTimerRef.current = window.setTimeout(() => {
          setCopiedIdKey((prev) => (prev === key ? null : prev));
          copiedIdTimerRef.current = null;
        }, 1100);
      } catch (err) {
        console.error("Failed to copy task id", { key, err });
      }
    })();
  };
  type BatchItem = {
    key: string;
    source?: Task;
    title: string;
    description?: string;
    priority?: Task["priority"];
    dueDate?: string;
    dueTime?: string;
    durationMinutes?: number;
    reminderMinutesBefore?: number;
    repeat?: Task["repeat"];
    repeatEvery?: number;
    repeatUnit?: Task["repeatUnit"];
    labels?: string[];
    location?: string;
    link?: string[];
  };
  const [batchItems, setBatchItems] = useState<BatchItem[]>([]);
  const [batchActiveIdx, setBatchActiveIdx] = useState(0);
  const [batchVoiceTouchedKeys, setBatchVoiceTouchedKeys] = useState<Set<string>>(
    () => new Set()
  );
  // Editor input model is unified across Single and Multiple:
  // direct inputs bind to task fields (labels/link/location stored on the task itself).
  const [voiceSupported, setVoiceSupported] = useState(true);
  const [listening, setListening] = useState(false);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const [voiceTranscript, setVoiceTranscript] = useState("");
  const [durationUnit, setDurationUnit] = useState<"minute" | "hour" | "day">("minute");
  const [durationAmount, setDurationAmount] = useState<string>("");
  const [batchDurationUnit, setBatchDurationUnit] = useState<"minute" | "hour" | "day">("minute");
  const [batchDurationAmount, setBatchDurationAmount] = useState<string>("");
  type PairRow = { key: string; text: string; url: string };
  type TextRow = { key: string; text: string };
  const makePairRow = (text = "", url = ""): PairRow => ({
    key: `p-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    text,
    url
  });
  const makeTextRow = (text = ""): TextRow => ({
    key: `t-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    text
  });
  const [labelRows, setLabelRows] = useState<TextRow[]>(() => [makeTextRow()]);
  const [linkRows, setLinkRows] = useState<PairRow[]>(() => [makePairRow()]);
  const [locationRows, setLocationRows] = useState<PairRow[]>(() => [makePairRow()]);
  const [batchLabelRows, setBatchLabelRows] = useState<TextRow[]>(() => [makeTextRow()]);
  const [batchLinkRows, setBatchLinkRows] = useState<PairRow[]>(() => [makePairRow()]);
  const [batchLocationRows, setBatchLocationRows] = useState<PairRow[]>(() => [makePairRow()]);
  const [voicePanelOpen, setVoicePanelOpen] = useState(true);
  const [bodyScrolled, setBodyScrolled] = useState(false);
  const [basicsTitleTouched, setBasicsTitleTouched] = useState(false);
  const drawerBodyRef = useRef<HTMLDivElement | null>(null);

  const emptyBatchItem = (): BatchItem => ({
    key: `m-${Date.now()}`,
    title: "",
    description: "",
    priority: "medium",
    dueDate: undefined,
    dueTime: undefined,
    durationMinutes: undefined,
    reminderMinutesBefore: undefined,
    repeat: "none",
    repeatEvery: undefined,
    repeatUnit: undefined,
    labels: [],
    location: undefined,
    link: undefined
  });

  const isMultiEdit = Array.isArray(task) && task.length > 0;
  const isMultiCreate = createMode === "multiple" && draft?.id === "new" && !isMultiEdit;
  const multipleFlow = createMode === "multiple" && (draft?.id === "new" || isMultiEdit);

  // (Intentionally no per-task number stepper UI; navigation is via Prev/Next only.)

  const normalizeSingleLabel = (raw: string): string => raw.trim().replace(/\s+/g, " ");

  const labelTokensToRows = (tokens: string[] | undefined | null): TextRow[] => {
    const list = (tokens ?? []).map((t) => normalizeSingleLabel(t)).filter(Boolean);
    if (list.length === 0) return [makeTextRow()];
    return list.map((t) => makeTextRow(t));
  };

  const rowsToLabelTokens = (rows: TextRow[]): string[] => {
    const out: string[] = [];
    const seen = new Set<string>();
    for (const row of rows) {
      const token = normalizeSingleLabel(row.text);
      if (!token) continue;
      const key = token.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(token);
      if (out.length >= 12) break;
    }
    return out;
  };

  const mergeLabelTokens = (existing: string[], incoming: string[]): string[] => {
    const out = [...(existing ?? [])];
    const seen = new Set(out.map((l) => l.toLowerCase()));
    for (const rawToken of incoming) {
      const token = normalizeSingleLabel(rawToken);
      if (!token) continue;
      const key = token.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(token);
    }
    // Deterministic ordering for UX and exports: ascending, case-insensitive.
    const toKey = (s: string) => s.trim().toLowerCase();
    return out
      .slice()
      .sort((a, b) => toKey(a).localeCompare(toKey(b)) || a.localeCompare(b));
  };

  const normalizeLinkHref = (raw: string): string | null => {
    let t = raw.trim();
    if (!t) return null;

    // Strip trailing punctuation that users often paste with URLs.
    t = t.replace(/[),.;]+$/g, "");
    if (!t) return null;

    if (/^https?:\/\//i.test(t)) return t;
    // If it looks like a domain (with optional path), keep as-typed (no forced scheme).
    if (/^[a-z0-9-]+(\.[a-z0-9-]+)+([/?#].*)?$/i.test(t) && !/\s/.test(t)) return t;

    // Reject whitespace-containing tokens.
    if (/\s/.test(t)) return null;
    return t;
  };

  const shortLinkText = (href: string): string => href.replace(/^https?:\/\//i, "");

  const looksLikeUrlValue = (raw: string): boolean => {
    const t = raw.trim();
    if (!t || /\s/.test(t)) return false;
    if (/^https?:\/\//i.test(t) || /^www\./i.test(t)) return true;
    return /^[a-z0-9-]+(\.[a-z0-9-]+)+([/?#].*)?$/i.test(t);
  };

  const linkTokensToPairRows = (tokens: string[] | undefined | null): PairRow[] => {
    const list = (tokens ?? []).map((tok) => tok.trim()).filter(Boolean);
    if (list.length === 0) return [makePairRow()];
    return list.map((tok) => {
      if (tok.includes("=>")) {
        const { href, label } = splitLinkStoredToken(tok);
        return makePairRow(label ?? "", shortLinkText(href));
      }
      if (looksLikeUrlValue(tok)) {
        return makePairRow("", shortLinkText(tok));
      }
      return makePairRow(tok, "");
    });
  };

  const pairRowsToLinkTokens = (rows: PairRow[]): string[] => {
    const out: string[] = [];
    for (const row of rows) {
      const text = row.text.trim().replace(/\s+/g, " ");
      const urlRaw = row.url.trim();
      if (!text && !urlRaw) continue;
      if (urlRaw) {
        const href = normalizeLinkHref(urlRaw) ?? urlRaw;
        const token = text ? `${text}=>${href}` : href;
        const norm = normalizeLinkToken(token);
        if (norm) out.push(norm);
      } else {
        const norm = normalizeLinkToken(text);
        if (norm) out.push(norm);
      }
    }
    return sortLinksAsc(out);
  };

  const locationTokensToPairRows = (raw: string | undefined | null): PairRow[] => {
    const tokens = deserializeLocationTokens(raw);
    if (tokens.length === 0) return [makePairRow()];
    return tokens.map((tok) => {
      const { label, query } = splitLocationStoredToken(tok);
      if (looksLikeUrlValue(query)) {
        return makePairRow(label ?? "", shortLinkText(query));
      }
      if (label) {
        return makePairRow(label, query);
      }
      return makePairRow(query, "");
    });
  };

  const pairRowsToLocationValue = (rows: PairRow[]): string | undefined => {
    const tokens: string[] = [];
    for (const row of rows) {
      const text = row.text.trim().replace(/\s+/g, " ");
      const urlRaw = row.url.trim();
      if (!text && !urlRaw) continue;
      if (urlRaw) {
        const href = normalizeLinkHref(urlRaw) ?? normalizeMaybeUrl(urlRaw) ?? urlRaw;
        tokens.push(text ? `${text}=>${href}` : href);
      } else {
        tokens.push(text);
      }
    }
    return serializeLocationTokens(tokens);
  };

  const commitLinkRows = (rows: PairRow[]) => {
    setLinkRows(rows.length ? rows : [makePairRow()]);
    const tokens = pairRowsToLinkTokens(rows);
    setDraft((prev) => (prev ? { ...prev, link: tokens.length ? tokens : undefined } : prev));
  };

  const commitLocationRows = (rows: PairRow[]) => {
    setLocationRows(rows.length ? rows : [makePairRow()]);
    const value = pairRowsToLocationValue(rows);
    setDraft((prev) => (prev ? { ...prev, location: value } : prev));
  };

  const commitBatchLinkRows = (rows: PairRow[]) => {
    setBatchLinkRows(rows.length ? rows : [makePairRow()]);
    const tokens = pairRowsToLinkTokens(rows);
    setBatchItems((prev) =>
      prev.map((p, i) =>
        i === batchActiveIdx ? { ...p, link: tokens.length ? tokens : undefined } : p
      )
    );
  };

  const commitBatchLocationRows = (rows: PairRow[]) => {
    setBatchLocationRows(rows.length ? rows : [makePairRow()]);
    const value = pairRowsToLocationValue(rows);
    setBatchItems((prev) =>
      prev.map((p, i) => (i === batchActiveIdx ? { ...p, location: value } : p))
    );
  };

  const commitLabelRows = (rows: TextRow[]) => {
    setLabelRows(rows.length ? rows : [makeTextRow()]);
    const tokens = rowsToLabelTokens(rows);
    setDraft((prev) => (prev ? { ...prev, labels: tokens } : prev));
  };

  const commitBatchLabelRows = (rows: TextRow[]) => {
    setBatchLabelRows(rows.length ? rows : [makeTextRow()]);
    const tokens = rowsToLabelTokens(rows);
    setBatchItems((prev) =>
      prev.map((p, i) => (i === batchActiveIdx ? { ...p, labels: tokens } : p))
    );
  };

  const renderTextRowsEditor = (opts: {
    label: string;
    hint: string;
    rows: TextRow[];
    onChange: (rows: TextRow[]) => void;
    textPlaceholder: string;
    preview: Array<{ key: string; text: string }>;
  }) => {
    const { label, hint, rows, onChange, textPlaceholder, preview } = opts;
    const canRemoveRow = (row: TextRow) => rows.length > 1 || !!row.text.trim();
    const filledCount = rowsToLabelTokens(rows).length;

    const updateRow = (idx: number, patch: Partial<TextRow>) => {
      onChange(rows.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
    };

    const addRow = () => {
      if (filledCount >= 12) return;
      onChange([...rows, makeTextRow()]);
    };

    return (
      <div className="drawer-organize-block drawer-pair-field drawer-text-field">
        <div className="drawer-organize-block-head">
          <span className="drawer-organize-block-title">{label}</span>
          <button
            type="button"
            className="drawer-pair-add"
            onClick={addRow}
            disabled={filledCount >= 12}
            title={hint}
          >
            <span aria-hidden="true">+</span>
            Add
          </button>
        </div>
        <div className="drawer-pair-list" role="list" aria-label={label}>
          {rows.map((row, idx) => {
            const filled = !!row.text.trim();
            return (
              <div
                key={row.key}
                className={`drawer-pair-row drawer-text-row${filled ? " is-filled" : ""}`}
                role="listitem"
              >
                <div className="drawer-pair-split drawer-text-split">
                  <div className="drawer-pair-side drawer-pair-side--text">
                    <span className="drawer-pair-side-label" aria-hidden="true">
                      Text
                    </span>
                    <input
                      className="drawer-pair-text"
                      type="text"
                      value={row.text}
                      placeholder={textPlaceholder}
                      aria-label={`${label} text`}
                      onChange={(e) => updateRow(idx, { text: e.target.value })}
                      onKeyDown={(e) => {
                        if (e.key !== "Enter") return;
                        e.preventDefault();
                        if (idx === rows.length - 1) {
                          if (filledCount >= 12) return;
                          addRow();
                          window.setTimeout(() => {
                            const nodes = document.querySelectorAll(
                              `.drawer-text-field [aria-label="${label} text"]`
                            );
                            const last = nodes[nodes.length - 1] as HTMLInputElement | undefined;
                            last?.focus();
                          }, 0);
                        } else {
                          const nodes = document.querySelectorAll(
                            `.drawer-text-field [aria-label="${label} text"]`
                          );
                          const next = nodes[idx + 1] as HTMLInputElement | undefined;
                          next?.focus();
                        }
                      }}
                    />
                  </div>
                </div>
                <button
                  type="button"
                  className="drawer-pair-remove"
                  disabled={!canRemoveRow(row)}
                  onClick={() => {
                    const next = rows.filter((_, i) => i !== idx);
                    onChange(next.length ? next : [makeTextRow()]);
                  }}
                  title="Remove this entry"
                  aria-label="Remove entry"
                >
                  <svg viewBox="0 0 24 24" focusable="false" aria-hidden="true">
                    <path d="M6 6l12 12M18 6L6 18" />
                  </svg>
                </button>
              </div>
            );
          })}
        </div>
        {preview.length > 0 ? (
          <div className="drawer-pair-preview">{renderTokenPreview(preview)}</div>
        ) : null}
      </div>
    );
  };

  const renderPairRowsEditor = (opts: {
    label: string;
    hint: string;
    rows: PairRow[];
    onChange: (rows: PairRow[]) => void;
    textPlaceholder: string;
    urlPlaceholder: string;
    preview: Array<{ key: string; text: string; href?: string }>;
  }) => {
    const { label, hint, rows, onChange, textPlaceholder, urlPlaceholder, preview } = opts;
    const canRemoveRow = (row: PairRow) =>
      rows.length > 1 || !!row.text.trim() || !!row.url.trim();

    const updateRow = (idx: number, patch: Partial<PairRow>) => {
      onChange(rows.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
    };

    const addRow = () => onChange([...rows, makePairRow()]);

    return (
      <div className="drawer-organize-block drawer-pair-field">
        <div className="drawer-organize-block-head">
          <span className="drawer-organize-block-title">{label}</span>
          <button
            type="button"
            className="drawer-pair-add"
            onClick={addRow}
            title={hint}
          >
            <span aria-hidden="true">+</span>
            Add
          </button>
        </div>
        <div className="drawer-pair-list" role="list" aria-label={label}>
          {rows.map((row, idx) => {
            const filled = !!row.text.trim() || !!row.url.trim();
            const urlOk = looksLikeUrlValue(row.url);
            return (
              <div
                key={row.key}
                className={`drawer-pair-row${filled ? " is-filled" : ""}${
                  row.url.trim() ? " has-url" : ""
                }${urlOk ? " has-valid-url" : ""}`}
                role="listitem"
              >
                <div className="drawer-pair-split">
                  <div className="drawer-pair-side drawer-pair-side--text">
                    <span className="drawer-pair-side-label" aria-hidden="true">
                      Text
                    </span>
                    <input
                      className="drawer-pair-text"
                      type="text"
                      value={row.text}
                      placeholder={textPlaceholder}
                      aria-label={`${label} text`}
                      onChange={(e) => updateRow(idx, { text: e.target.value })}
                      onKeyDown={(e) => {
                        if (e.key !== "Enter") return;
                        e.preventDefault();
                        const urlInput = (e.currentTarget
                          .closest(".drawer-pair-row")
                          ?.querySelector(".drawer-pair-url") ?? null) as HTMLInputElement | null;
                        urlInput?.focus();
                      }}
                    />
                  </div>
                  <span className="drawer-pair-divider" aria-hidden="true" />
                  <div className="drawer-pair-side drawer-pair-side--url">
                    <span className="drawer-pair-side-label" aria-hidden="true">
                      URL
                    </span>
                    <input
                      className="drawer-pair-url"
                      type="text"
                      inputMode="url"
                      autoComplete="url"
                      value={row.url}
                      placeholder={urlPlaceholder}
                      aria-label={`${label} URL`}
                      onChange={(e) => updateRow(idx, { url: e.target.value })}
                      onKeyDown={(e) => {
                        if (e.key !== "Enter") return;
                        e.preventDefault();
                        if (idx === rows.length - 1) {
                          addRow();
                          window.setTimeout(() => {
                            const nodes = document.querySelectorAll(
                              `.drawer-pair-field [aria-label="${label} text"]`
                            );
                            const last = nodes[nodes.length - 1] as HTMLInputElement | undefined;
                            last?.focus();
                          }, 0);
                        } else {
                          const nodes = document.querySelectorAll(
                            `.drawer-pair-field [aria-label="${label} text"]`
                          );
                          const next = nodes[idx + 1] as HTMLInputElement | undefined;
                          next?.focus();
                        }
                      }}
                    />
                    {urlOk ? (
                      <span className="drawer-pair-url-ok" title="Looks like a valid URL" aria-hidden="true">
                        ✓
                      </span>
                    ) : null}
                  </div>
                </div>
                <button
                  type="button"
                  className="drawer-pair-remove"
                  disabled={!canRemoveRow(row)}
                  onClick={() => {
                    const next = rows.filter((_, i) => i !== idx);
                    onChange(next.length ? next : [makePairRow()]);
                  }}
                  title="Remove this entry"
                  aria-label="Remove entry"
                >
                  <svg viewBox="0 0 24 24" focusable="false" aria-hidden="true">
                    <path d="M6 6l12 12M18 6L6 18" />
                  </svg>
                </button>
              </div>
            );
          })}
        </div>
        {preview.length > 0 ? (
          <div className="drawer-pair-preview">{renderTokenPreview(preview)}</div>
        ) : null}
      </div>
    );
  };




  const PRIORITY_OPTIONS: Array<{ value: Task["priority"]; label: string }> = [
    { value: "low", label: "Low" },
    { value: "medium", label: "Medium" },
    { value: "high", label: "High" },
    { value: "urgent", label: "Urgent" }
  ];

  const REPEAT_OPTIONS: Array<{ value: NonNullable<Task["repeat"]>; label: string }> = [
    { value: "none", label: "Does not repeat" },
    { value: "daily", label: "Daily" },
    { value: "weekly", label: "Weekly" },
    { value: "weekdays", label: "Weekdays (Mon–Fri)" },
    { value: "weekends", label: "Weekends (Sat–Sun)" },
    { value: "monthly", label: "Monthly" },
    { value: "quarterly", label: "Quarterly" },
    { value: "yearly", label: "Annually" },
    { value: "custom", label: "Custom…" }
  ];

  const syncAutogrowTextarea = (el: HTMLTextAreaElement | null) => {
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${Math.min(Math.max(el.scrollHeight, 68), 240)}px`;
  };

  const renderBasicsEditor = (opts: {
    title: string;
    description: string;
    priority: Task["priority"];
    repeat: NonNullable<Task["repeat"]>;
    repeatEvery?: number;
    repeatUnit?: Task["repeatUnit"];
    titleInputId?: string;
    onChange: (patch: {
      title?: string;
      description?: string;
      priority?: Task["priority"];
      repeat?: Task["repeat"];
      repeatEvery?: number;
      repeatUnit?: Task["repeatUnit"];
    }) => void;
  }) => {
    const {
      title,
      description,
      priority,
      repeat,
      repeatEvery,
      repeatUnit,
      titleInputId,
      onChange
    } = opts;
    const showTitleCue = basicsTitleTouched && !title.trim();

    return (
      <div className="drawer-basics">
        <div className={`drawer-basics-compose${showTitleCue ? " is-title-empty" : ""}`}>
          <label className="drawer-basics-compose-title">
            <span className="drawer-basics-label">Title</span>
            <input
              id={titleInputId}
              className="drawer-basics-title-input"
              value={title}
              onChange={(e) => onChange({ title: e.target.value })}
              onBlur={() => setBasicsTitleTouched(true)}
              placeholder="What do you want to accomplish?"
              title="Task title (required)."
              aria-required="true"
              aria-invalid={showTitleCue}
            />
          </label>
          <label className="drawer-basics-compose-desc">
            <span className="drawer-basics-label">Description</span>
            <textarea
              className="drawer-basics-desc"
              value={description}
              rows={2}
              placeholder="Optional notes or context"
              title="Optional description for additional context."
              ref={(el) => syncAutogrowTextarea(el)}
              onChange={(e) => {
                onChange({ description: e.target.value });
                syncAutogrowTextarea(e.currentTarget);
              }}
            />
          </label>
          {showTitleCue ? <span className="drawer-basics-hint">Title is required.</span> : null}
        </div>

        <div className="drawer-basics-row">
          <div className="drawer-basics-field drawer-basics-field--priority">
            <span className="drawer-basics-label" id="drawer-basics-priority-label">
              Priority
            </span>
            <div
              className="drawer-basics-priority"
              role="radiogroup"
              aria-labelledby="drawer-basics-priority-label"
              title="Priority sets urgency and completion points."
            >
              {PRIORITY_OPTIONS.map((opt) => {
                const active = priority === opt.value;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    className={`drawer-basics-priority-chip priority-${opt.value}${
                      active ? " is-active" : ""
                    }`}
                    onClick={() => onChange({ priority: opt.value })}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
          </div>

          <label className="drawer-basics-field drawer-basics-field--repeat">
            <span className="drawer-basics-label">Repeat</span>
            <select
              className="drawer-basics-select"
              value={repeat}
              onChange={(e) => onChange({ repeat: e.target.value as Task["repeat"] })}
              title="Repeat pattern for recurring tasks."
            >
              {REPEAT_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        {repeat === "custom" ? (
          <div className="drawer-basics-custom" aria-label="Custom repeat interval">
            <label className="drawer-basics-field">
              <span className="drawer-basics-label">Every</span>
              <input
                className="drawer-basics-number"
                type="number"
                min={1}
                value={repeatEvery ?? 1}
                onChange={(e) => onChange({ repeatEvery: Number(e.target.value) || 1 })}
                title="Repeat interval count."
              />
            </label>
            <label className="drawer-basics-field">
              <span className="drawer-basics-label">Unit</span>
              <select
                className="drawer-basics-select"
                value={repeatUnit ?? "week"}
                onChange={(e) =>
                  onChange({ repeatUnit: e.target.value as Task["repeatUnit"] })
                }
                title="Repeat interval unit."
              >
                <option value="day">Day(s)</option>
                <option value="week">Week(s)</option>
                <option value="month">Month(s)</option>
                <option value="quarter">Quarter(s)</option>
                <option value="year">Year(s)</option>
              </select>
            </label>
          </div>
        ) : null}
      </div>
    );
  };



  type DurationUnit = "minute" | "hour" | "day";

  const DURATION_UNIT_OPTIONS: Array<{ value: DurationUnit; label: string }> = [
    { value: "minute", label: "Min" },
    { value: "hour", label: "Hr" },
    { value: "day", label: "Day" }
  ];

  const durationMinutesFromUi = (amountRaw: string, unit: DurationUnit): number | undefined => {
    const amount = Number(amountRaw);
    const mult = unit === "day" ? 1440 : unit === "hour" ? 60 : 1;
    if (amountRaw.trim().length === 0 || !Number.isFinite(amount) || amount <= 0) return undefined;
    return Math.round(amount * mult);
  };

  const renderScheduleEditor = (opts: {
    dueDate?: string;
    dueTime?: string;
    durationAmount: string;
    durationUnit: DurationUnit;
    onDueDate: (value?: string) => void;
    onDueTime: (value?: string) => void;
    onDurationAmount: (value: string) => void;
    onDurationUnit: (unit: DurationUnit) => void;
  }) => {
    const {
      dueDate,
      dueTime,
      durationAmount,
      durationUnit,
      onDueDate,
      onDueTime,
      onDurationAmount,
      onDurationUnit
    } = opts;
    const hasDate = !!dueDate;
    const hasTime = !!dueTime;
    const hasDuration = durationAmount.trim().length > 0;

    return (
      <div className="drawer-schedule">
        <div className="drawer-schedule-compose">
          <div className="drawer-schedule-when">
            <label className="drawer-schedule-field">
              <span className="drawer-schedule-label-row">
                <span className="drawer-schedule-label">Date</span>
                {hasDate ? (
                  <button
                    type="button"
                    className="drawer-schedule-clear"
                    onClick={() => onDueDate(undefined)}
                    title="Clear date"
                    aria-label="Clear date"
                  >
                    Clear
                  </button>
                ) : null}
              </span>
              <input
                className="drawer-schedule-input"
                type="date"
                value={dueDate ?? ""}
                onChange={(e) => onDueDate(e.target.value || undefined)}
                title="Due date (optional)."
              />
            </label>
            <label className="drawer-schedule-field">
              <span className="drawer-schedule-label-row">
                <span className="drawer-schedule-label">Time</span>
                {hasTime ? (
                  <button
                    type="button"
                    className="drawer-schedule-clear"
                    onClick={() => onDueTime(undefined)}
                    title="Clear time"
                    aria-label="Clear time"
                  >
                    Clear
                  </button>
                ) : null}
              </span>
              <input
                className="drawer-schedule-input"
                type="time"
                value={dueTime ?? ""}
                onChange={(e) => onDueTime(e.target.value || undefined)}
                title="Due time (optional)."
              />
            </label>
          </div>

          <div className="drawer-schedule-duration">
            <span className="drawer-schedule-label-row">
              <span className="drawer-schedule-label" id="drawer-schedule-duration-label">
                Duration
              </span>
              {hasDuration ? (
                <button
                  type="button"
                  className="drawer-schedule-clear"
                  onClick={() => onDurationAmount("")}
                  title="Clear duration"
                  aria-label="Clear duration"
                >
                  Clear
                </button>
              ) : null}
            </span>
            <div className="drawer-schedule-duration-row">
              <input
                className="drawer-schedule-input drawer-schedule-amount"
                type="number"
                min={1}
                inputMode="numeric"
                value={durationAmount}
                onChange={(e) => onDurationAmount(e.target.value)}
                placeholder="Optional"
                title="Estimated duration amount (optional)."
                aria-labelledby="drawer-schedule-duration-label"
              />
              <div className="drawer-schedule-units" role="radiogroup" aria-label="Duration unit">
                {DURATION_UNIT_OPTIONS.map((opt) => {
                  const active = durationUnit === opt.value;
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      role="radio"
                      aria-checked={active}
                      className={`drawer-schedule-unit-chip${active ? " is-active" : ""}`}
                      onClick={() => onDurationUnit(opt.value)}
                      title={
                        opt.value === "minute" ? "Minutes" : opt.value === "hour" ? "Hours" : "Days"
                      }
                    >
                      {opt.label}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  };

  const parseLinkAliasToken = (raw: string): { href: string; label?: string } | null => {
    const t = raw.trim();
    if (!t) return null;
    // Accept multiple alias separators for UX:
    // - `Label=>https://...` (canonical stored format)
    // - `Label -> https://...`
    // - `Label | https://...`
    const m = t.match(/^\s*(.*?)\s*(=>|->|\|)\s*(\S.*?)\s*$/);
    if (m) {
      const labelRaw = (m[1] ?? "").trim();
      const hrefRaw = (m[3] ?? "").trim();
      if (!hrefRaw) return null;
      const href = normalizeLinkHref(hrefRaw);
      if (!href) return null;
      const label = labelRaw ? labelRaw.replace(/\s+/g, " ").trim() : undefined;
      return { href, label };
    }

    const href = normalizeLinkHref(t);
    if (!href) return null;
    return { href };
  };

  const normalizeLinkToken = (raw: string): string | null => {
    const parsed = parseLinkAliasToken(raw);
    if (!parsed) {
      // Allow non-hyperlink tokens (plain text “references”) in the Links field.
      // These render as non-clickable chips in the UI and can be combined with real hyperlinks.
      const t = raw.trim().replace(/\s+/g, " ");
      return t ? t : null;
    }
    if (parsed.label) return `${parsed.label}=>${parsed.href}`;
    return parsed.href;
  };

  const splitLinkStoredToken = (token: string): { href: string; label?: string } => {
    const t = token.trim();
    const idx = t.indexOf("=>");
    if (idx >= 0) {
      const label = t.slice(0, idx).trim();
      const href = t.slice(idx + 2).trim();
      return href ? { href, label: label || undefined } : { href: t };
    }
    return { href: t };
  };

  const linkTokenKey = (token: string): string => {
    const parsed = parseLinkAliasToken(token);
    if (parsed) return `href:${parsed.href.toLowerCase()}`;
    return `text:${token.trim().replace(/\s+/g, " ").toLowerCase()}`;
  };

  const sortLinksAsc = (links: string[]) => {
    return links
      .slice()
      .sort((a, b) => linkTokenKey(a).localeCompare(linkTokenKey(b)) || a.localeCompare(b));
  };

  const normalizeSingleLocation = (raw: string): string =>
    raw.trim().replace(/\s+/g, " ");

  // Locations are persisted as a single string in the backend.
  // We encode multiple locations as a pipe-delimited list: `loc1|loc2|...`.
  const deserializeLocationTokens = (raw: string | undefined | null): string[] => {
    const t = raw?.trim() ?? "";
    if (!t) return [];
    if (t.includes("|")) {
      return t
        .split("|")
        .map((s) => normalizeSingleLocation(s))
        .filter(Boolean);
    }
    // Backward compatible: a single legacy location is stored as-is.
    return [normalizeSingleLocation(t)].filter(Boolean);
  };

  const serializeLocationTokens = (tokens: string[]): string | undefined => {
    const cleaned = tokens.map(normalizeSingleLocation).filter(Boolean);
    return cleaned.length ? cleaned.join("|") : undefined;
  };

  const parseLocationsInput = (raw: string): string[] => {
    const cleaned = raw.trim();
    if (!cleaned) return [];

    // Split locations by separators WITHOUT breaking labels.
    // - Separators: comma, semicolon, newline
    // - Allow escaping separators inside labels with backslash: `\,` or `\;`
    // - Do NOT treat `&` as a separator; it can be part of a label.
    const parts: string[] = [];
    let cur = "";
    let escaping = false;
    for (let i = 0; i < cleaned.length; i++) {
      const ch = cleaned[i]!;
      if (escaping) {
        cur += ch;
        escaping = false;
        continue;
      }
      if (ch === "\\") {
        escaping = true;
        continue;
      }
      if (ch === "," || ch === ";" || ch === "\n" || ch === "\r") {
        const t = cur.trim();
        if (t) parts.push(t);
        cur = "";
        continue;
      }
      cur += ch;
    }
    const tail = cur.trim();
    if (tail) parts.push(tail);

    const parseLocationAliasInputToken = (
      token: string
    ): { query: string; label?: string } | null => {
      const t = token.trim();
      if (!t) return null;
      const m = t.match(/^\s*(.*?)\s*(=>|->|\|)\s*(\S.*?)\s*$/);
      if (m) {
        const labelRaw = (m[1] ?? "").trim();
        const queryRaw = (m[3] ?? "").trim();
        if (!queryRaw) return null;
        const query = normalizeSingleLocation(queryRaw);
        if (!query) return null;
        const label = labelRaw ? normalizeSingleLocation(labelRaw) : undefined;
        return { query, label };
      }
      const query = normalizeSingleLocation(t);
      if (!query) return null;
      return { query };
    };

    // If a user accidentally pressed Enter inside an alias label (e.g. "Coffee\nShop | Jakarta"),
    // join the split pieces back together when the combined token becomes a valid alias token.
    const mergedParts: string[] = [];
    for (let i = 0; i < parts.length; i++) {
      const a = parts[i] ?? "";
      const b = parts[i + 1] ?? "";
      if (b) {
        const aParsed = parseLocationAliasInputToken(a);
        const aLooksStandalone = !!aParsed && !aParsed.label && aParsed.query === a.trim();
        const combined = `${a.trim()} ${b.trim()}`.trim();
        if (aLooksStandalone && parseLocationAliasInputToken(combined)?.label) {
          mergedParts.push(combined);
          i++; // consume b
          continue;
        }
      }
      mergedParts.push(a);
    }

    const outByQuery = new Map<string, string>(); // queryKey -> stored token
    for (const p of mergedParts.slice(0, 12)) {
      const parsed = parseLocationAliasInputToken(p);
      if (!parsed) continue;
      const label = parsed.label;
      const query = parsed.query;

      const queryKey = query.toLowerCase();
      const storedToken = label ? `${label}=>${query}` : query;

      // Prefer labeled token if provided.
      const existing = outByQuery.get(queryKey);
      if (!existing || label) outByQuery.set(queryKey, storedToken);
    }

    return Array.from(outByQuery.values());
  };

  const splitLocationStoredToken = (token: string): { query: string; label?: string } => {
    const t = token.trim();
    const idx = t.indexOf("=>");
    if (idx >= 0) {
      const label = t.slice(0, idx).trim();
      const query = t.slice(idx + 2).trim();
      return { query: query || t, label: label || undefined };
    }
    return { query: t };
  };

  const normalizeMaybeUrl = (raw: string): string | null => {
    const t = raw.trim();
    if (!t) return null;
    if (/^https?:\/\//i.test(t)) return t;
    if (/^www\./i.test(t)) return `https://${t}`;
    // Treat plain domains as URLs (with optional path/query).
    if (/^[a-z0-9-]+(\.[a-z0-9-]+)+([/?#].*)?$/i.test(t) && !/\s/.test(t)) {
      return `https://${t}`;
    }
    return null;
  };

  const locationHrefMetaForToken = (
    raw: string
  ): { href: string; kind: "url" | "maps" } | null => {
    const t0 = raw.trim();
    if (!t0) return null;
    const arrowIdx = t0.indexOf("=>");
    const query = (arrowIdx >= 0 ? t0.slice(arrowIdx + 2) : t0).trim();

    if (!query) return null;

    // If user provided a real hyperlink, open it directly.
    const maybeUrl = normalizeMaybeUrl(query);
    if (maybeUrl) return { href: maybeUrl, kind: "url" };
    return null;
  };

  const renderTokenPreview = (
    tokens: Array<{ key: string; text: string; href?: string }>
  ) => {
    if (tokens.length === 0) return null;
    return (
      <div className="task-hovercard-labels drawer-token-preview" aria-label="Preview">
        {tokens.map((t) =>
          t.href ? (
            <a
              key={t.key}
              className="task-hovercard-chip task-link-chip"
              href={t.href}
              target="_blank"
              rel="noreferrer"
              onClick={(e) => e.stopPropagation()}
              title={t.href}
            >
              {t.text}
            </a>
          ) : (
            <span key={t.key} className="task-hovercard-chip">
              {t.text}
            </span>
          )
        )}
      </div>
    );
  };

  useEffect(() => {
    setSaving(false);
    setSaveProgress(0);
    setSaveStage("Saving…");
    if (saveProgressTimerRef.current != null) {
      window.clearInterval(saveProgressTimerRef.current);
      saveProgressTimerRef.current = null;
    }
    if (Array.isArray(task)) {
      const compareDueDateDesc = (a: Task, b: Task) => {
        // Match list/table sorting: missing dueDate goes last, otherwise ISO desc.
        if (!a.dueDate && !b.dueDate) return 0;
        if (!a.dueDate) return 1;
        if (!b.dueDate) return -1;
        return b.dueDate.localeCompare(a.dueDate);
      };
      const sorted = task.slice().sort(compareDueDateDesc);
      setDraft(sorted[0] ?? null);
      setCreateMode("multiple");
      setBatchItems(
        sorted.map((t, idx) => ({
          key: `e-${t.id}-${idx}`,
          source: t,
          title: t.title ?? "",
          description: t.description ?? "",
          priority: t.priority ?? "medium",
          dueDate: t.dueDate,
          dueTime: t.dueTime,
          durationMinutes: t.durationMinutes,
          reminderMinutesBefore: t.reminderMinutesBefore,
          repeat: t.repeat ?? "none",
          repeatEvery: t.repeatEvery,
          repeatUnit: t.repeatUnit,
          labels: t.labels ?? [],
          location: t.location,
          link: t.link
        }))
      );
      setBatchActiveIdx(0);
      setBatchVoiceTouchedKeys(new Set());
      return;
    }

    setDraft(task);
    setCreateMode("single");
    setBatchItems([]);
    setBatchActiveIdx(0);
    setBatchVoiceTouchedKeys(new Set());
  }, [task]);

  const setDurationUIFromMinutes = (mins: number | undefined | null) => {
    if (mins === undefined || mins === null) {
      setDurationUnit("minute");
      setDurationAmount("");
      return;
    }
    if (mins % 1440 === 0) {
      setDurationUnit("day");
      setDurationAmount(String(mins / 1440));
      return;
    }
    if (mins % 60 === 0) {
      setDurationUnit("hour");
      setDurationAmount(String(mins / 60));
      return;
    }
    setDurationUnit("minute");
    setDurationAmount(String(mins));
  };

  const setBatchDurationUIFromMinutes = (mins: number | undefined | null) => {
    if (mins === undefined || mins === null) {
      setBatchDurationUnit("minute");
      setBatchDurationAmount("");
      return;
    }
    if (mins % 1440 === 0) {
      setBatchDurationUnit("day");
      setBatchDurationAmount(String(mins / 1440));
      return;
    }
    if (mins % 60 === 0) {
      setBatchDurationUnit("hour");
      setBatchDurationAmount(String(mins / 60));
      return;
    }
    setBatchDurationUnit("minute");
    setBatchDurationAmount(String(mins));
  };

  useEffect(() => {
    const t0 = Array.isArray(task) ? task[0] ?? null : task;
    setDurationUIFromMinutes(t0?.durationMinutes);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [Array.isArray(task) ? task[0]?.id : task?.id]);

  // Keep Duration UI in sync even when voice updates draft.durationMinutes.
  useEffect(() => {
    setDurationUIFromMinutes(draft?.durationMinutes);
  }, [draft?.durationMinutes]);

  useEffect(() => {
    if (createMode !== "multiple") return;
    // In both multi-create and multi-edit, Duration UI is shared, so it must be
    // re-hydrated from the active row whenever the selection changes.
    const row = batchItems[batchActiveIdx];
    setBatchDurationUIFromMinutes(row?.durationMinutes);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [createMode, batchActiveIdx, batchItems[batchActiveIdx]?.durationMinutes]);

  useEffect(() => {
    if (typeof window === "undefined") {
      setVoiceSupported(false);
      return;
    }
    const w = window as any;
    const has =
      typeof w.SpeechRecognition === "function" ||
      typeof w.webkitSpeechRecognition === "function";
    setVoiceSupported(has);
  }, []);

  useEffect(() => {
    if (!task) return;
    const isNew = !Array.isArray(task) && task.id === "new";
    setVoicePanelOpen(isNew);
  }, [task]);

  useEffect(() => {
    if (!draft) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (saving) return;
      e.preventDefault();
      onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [draft, onClose, saving]);

  useEffect(() => {
    return () => {
      if (saveProgressTimerRef.current != null) {
        window.clearInterval(saveProgressTimerRef.current);
        saveProgressTimerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!draft) return;
    const timer = window.setTimeout(() => {
      const titleInput = document.getElementById("task-editor-title") as HTMLInputElement | null;
      titleInput?.focus({ preventScroll: true });
    }, 40);
    return () => window.clearTimeout(timer);
  }, [draft?.id, batchActiveIdx, multipleFlow, createMode]);

  useEffect(() => {
    const el = drawerBodyRef.current;
    if (!el || !draft) return;
    const onScroll = () => setBodyScrolled(el.scrollTop > 6);
    onScroll();
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, [draft]);

  useEffect(() => {
    if (!onLabelsDraftChange) return;
    if (!draft || draft.id === "new") return;
    onLabelsDraftChange(draft.labels ?? []);
  }, [onLabelsDraftChange, draft?.id, (draft?.labels ?? []).join("|")]);

  useEffect(() => {
    if (!onLinksDraftChange) return;
    if (!draft || draft.id === "new") return;
    onLinksDraftChange(draft.link ?? []);
  }, [onLinksDraftChange, draft?.id, (draft?.link ?? []).join("|")]);

  // Keep raw token inputs editable (don't fight the user's typing).
  useEffect(() => {
    if (!draft) return;
    if (createMode !== "single") return;
    setBasicsTitleTouched(false);
    setLabelRows(labelTokensToRows(draft.labels));
    setLinkRows(linkTokensToPairRows(draft.link));
    setLocationRows(locationTokensToPairRows(draft.location));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft?.id, createMode]);

  useEffect(() => {
    if (createMode !== "multiple") return;
    const row = batchItems[batchActiveIdx];
    if (!row) return;
    setBasicsTitleTouched(false);
    setBatchLabelRows(labelTokensToRows(row.labels));
    setBatchLinkRows(linkTokensToPairRows(row.link));
    setBatchLocationRows(locationTokensToPairRows(row.location));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [createMode, batchActiveIdx, batchItems[batchActiveIdx]?.key]);

  if (!draft) return null;

  const normalizeDraft = (t: Task): Task => {
    if (t.repeat === "custom") {
      return {
        ...t,
        repeatEvery: t.repeatEvery ?? 1,
        repeatUnit: t.repeatUnit ?? "week"
      };
    }
    // Ensure duration is persisted based on amount+unit inputs.
    const amount = Number(durationAmount);
    const mult = durationUnit === "day" ? 1440 : durationUnit === "hour" ? 60 : 1;
    const durationMinutes =
      durationAmount.trim().length > 0 && Number.isFinite(amount) && amount > 0
        ? Math.round(amount * mult)
        : undefined;
    return { ...t, durationMinutes };
  };

  const normalizeISODate = (y: number, m: number, d: number) => {
    const yy = String(y).padStart(4, "0");
    const mm = String(m).padStart(2, "0");
    const dd = String(d).padStart(2, "0");
    return `${yy}-${mm}-${dd}`;
  };

  const numberWordToInt = (raw: string): number | null => {
    const s = raw.trim().toLowerCase();
    if (!s) return null;
    if (/^\d+$/.test(s)) return Number(s);
    const map: Record<string, number> = {
      one: 1,
      two: 2,
      three: 3,
      four: 4,
      five: 5,
      six: 6,
      seven: 7,
      eight: 8,
      nine: 9,
      ten: 10,
      eleven: 11,
      twelve: 12,
      thirteen: 13,
      fourteen: 14,
      fifteen: 15,
      sixteen: 16,
      seventeen: 17,
      eighteen: 18,
      nineteen: 19,
      twenty: 20,
      // Indonesian
      satu: 1,
      dua: 2,
      tiga: 3,
      empat: 4,
      lima: 5,
      enam: 6,
      tujuh: 7,
      delapan: 8,
      sembilan: 9,
      sepuluh: 10,
      sebelas: 11,
      dua_belas: 12,
      tiga_belas: 13,
      empat_belas: 14,
      lima_belas: 15,
      enam_belas: 16,
      tujuh_belas: 17,
      delapan_belas: 18,
      sembilan_belas: 19,
      dua_puluh: 20
    };
    const key = s.replace(/\s+/g, "_").replace(/-/g, "_");
    return map[key] ?? null;
  };

  const monthNameToNumber = (raw: string): number | null => {
    const s = raw.trim().toLowerCase();
    const map: Record<string, number> = {
      january: 1,
      jan: 1,
      januari: 1,
      february: 2,
      feb: 2,
      februari: 2,
      march: 3,
      mar: 3,
      maret: 3,
      april: 4,
      apr: 4,
      may: 5,
      mei: 5,
      june: 6,
      jun: 6,
      juni: 6,
      july: 7,
      jul: 7,
      juli: 7,
      august: 8,
      aug: 8,
      agustus: 8,
      september: 9,
      sep: 9,
      oktober: 10,
      october: 10,
      oct: 10,
      okt: 10,
      november: 11,
      nov: 11,
      desember: 12,
      december: 12,
      dec: 12,
      des: 12
    };
    return map[s] ?? null;
  };

  const parseSpokenDate = (raw: string): string | null => {
    const s = raw.trim();
    // yyyy-mm-dd
    {
      const m = s.match(/\b(20\d{2})-(\d{1,2})-(\d{1,2})\b/);
      if (m) return normalizeISODate(Number(m[1]), Number(m[2]), Number(m[3]));
    }
    // dd-mm-yyyy or dd/mm/yyyy
    {
      const m = s.match(/\b(\d{1,2})[\/\-](\d{1,2})[\/\-](20\d{2})\b/);
      if (m) return normalizeISODate(Number(m[3]), Number(m[2]), Number(m[1]));
    }
    // dd mm yyyy (spoken without separators)
    {
      const m = s.match(/\b(\d{1,2})\s+(\d{1,2})\s+(20\d{2})\b/);
      if (m) return normalizeISODate(Number(m[3]), Number(m[2]), Number(m[1]));
    }
    // dd Month yyyy (English/Indonesian month names)
    {
      const m = s.match(
        /\b(\d{1,2})\s+(january|jan|januari|february|feb|februari|march|mar|maret|april|apr|may|mei|june|jun|juni|july|jul|juli|august|aug|agustus|september|sep|october|oct|oktober|okt|november|nov|december|dec|desember|des)\s+(20\d{2})\b/i
      );
      if (m) {
        const month = monthNameToNumber(m[2]);
        if (month) return normalizeISODate(Number(m[3]), month, Number(m[1]));
      }
    }
    return null;
  };

  const parseSpokenTime = (raw: string): string | null => {
    const s = raw.trim();
    // "14:00" "14.00" "14 00"
    const m = s.match(/\b([01]?\d|2[0-3])[:. ]([0-5]\d)\b/);
    if (!m) return null;
    const hh = String(Number(m[1])).padStart(2, "0");
    const mm = String(Number(m[2])).padStart(2, "0");
    return `${hh}:${mm}`;
  };

  const parseSpokenTimeAmPm = (raw: string): string | null => {
    const s = raw.trim().toLowerCase();
    // "12 pm", "12 p.m.", "12 p. m.", "3am", "3 a.m.", "2:15 p.m."
    const m = s.match(
      /\b(1[0-2]|0?[1-9])\s*(?::\s*([0-5]\d))?\s*(a\s*\.?\s*m\s*\.?|p\s*\.?\s*m\s*\.?)\b/
    );
    if (!m) return null;
    let h = Number(m[1]);
    const minutes = m[2] ? Number(m[2]) : 0;
    const isPm = m[3].replace(/\s+/g, "").startsWith("p");
    if (isPm && h !== 12) h += 12;
    if (!isPm && h === 12) h = 0;
    const hh = String(h).padStart(2, "0");
    const mm = String(minutes).padStart(2, "0");
    return `${hh}:${mm}`;
  };

  const parseRelativeDate = (raw: string): string | null => {
    const s = raw.toLowerCase();
    const base = new Date();
    const iso = (d: Date) => {
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, "0");
      const day = String(d.getDate()).padStart(2, "0");
      return `${y}-${m}-${day}`;
    };
    if (/\b(today|hari ini)\b/.test(s)) return iso(base);
    if (/\b(tomorrow|besok)\b/.test(s)) {
      const d = new Date(base.getTime());
      d.setDate(d.getDate() + 1);
      return iso(d);
    }
    return null;
  };

  const parseVoiceFields = (
    rawText: string
  ): Partial<Task> & { labels?: string[]; _explicitTitle?: boolean; _explicitDescription?: boolean } => {
    const text = rawText.trim().replace(/\s+/g, " ");
    const lower = text.toLowerCase();

    const out: Partial<Task> & {
      labels?: string[];
      _explicitTitle?: boolean;
      _explicitDescription?: boolean;
    } = {};

    // Priority (English + Indonesian)
    if (
      /\b(priority|prioritas)\b/.test(lower) ||
      /\b(low|medium|high|urgent|rendah|sedang|tinggi|mendesak|darurat)\b/.test(lower) ||
      /\b(higher priority|high priority|urgent priority|low priority)\b/.test(lower) ||
      /\b(prioritas (lebih )?(tinggi|rendah|sedang)|lebih (tinggi|mendesak))\b/.test(lower)
    ) {
      if (/\b(urgent|mendesak|darurat)\b/.test(lower)) out.priority = "urgent";
      else if (/\b(high|tinggi)\b/.test(lower)) out.priority = "high";
      else if (/\b(medium|sedang)\b/.test(lower)) out.priority = "medium";
      else if (/\b(low|rendah)\b/.test(lower)) out.priority = "low";
      else if (/\b(higher priority|high priority)\b/.test(lower)) out.priority = "high";
    }

    // Repeat (standard)
    if (/\b(repeat|repeats|ulang|pengulangan|berulang)\b/.test(lower)) {
      if (/\b(daily|harian)\b/.test(lower)) out.repeat = "daily";
      else if (/\b(weekly|mingguan)\b/.test(lower)) out.repeat = "weekly";
      else if (/\b(monthly|bulanan)\b/.test(lower)) out.repeat = "monthly";
      else if (/\b(quarterly|triwulan|kuartal)\b/.test(lower)) out.repeat = "quarterly";
      else if (/\b(yearly|annual|tahunan)\b/.test(lower)) out.repeat = "yearly";
      else if (/\b(weekdays|hari kerja)\b/.test(lower)) out.repeat = "weekdays";
      else if (/\b(weekends|akhir pekan)\b/.test(lower)) out.repeat = "weekends";
      else if (/\b(none|no repeat|tidak)\b/.test(lower)) out.repeat = "none";
    }

    // Repeat custom: "every 2 weeks" / "setiap 2 minggu"
    {
      const m = lower.match(
        /\b(?:every|setiap)\s+(\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|satu|dua|tiga|empat|lima|enam|tujuh|delapan|sembilan|sepuluh|sebelas|dua belas|tiga belas|empat belas|lima belas|enam belas|tujuh belas|delapan belas|sembilan belas|dua puluh)\s*(day|days|hari|week|weeks|minggu|month|months|bulan|quarter|quarters|kuartal|triwulan|year|years|tahun)\b/
      );
      if (m) {
        const every = numberWordToInt(m[1]) ?? Number(m[1]);
        const unitRaw = m[2];
        const unit: Task["repeatUnit"] =
          unitRaw.startsWith("day") || unitRaw === "hari"
            ? "day"
            : unitRaw.startsWith("week") || unitRaw === "minggu"
              ? "week"
              : unitRaw.startsWith("month") || unitRaw === "bulan"
                ? "month"
                : unitRaw.startsWith("quarter") ||
                    unitRaw === "kuartal" ||
                    unitRaw === "triwulan"
                  ? "quarter"
                  : "year";
        if (Number.isFinite(every) && every > 0) {
          out.repeat = "custom";
          out.repeatEvery = every;
          out.repeatUnit = unit;
        }
      }
    }

    // Due date/time: "due 2026-01-21 14:00" / "tanggal 21-01-2026 jam 14 00" / "pukul 14.00"
    {
      const dueChunk =
        lower.match(/\b(?:due|tanggal|date|on)\b[^.]*$/)?.[0] ?? lower;
      const date = parseSpokenDate(dueChunk) ?? parseRelativeDate(lower);
      const time =
        // Prefer AM/PM parsing when present so "2:15 p.m." becomes 14:15 (not 02:15).
        parseSpokenTimeAmPm(dueChunk) ??
        parseSpokenTime(dueChunk) ??
        parseSpokenTime(
          (lower.match(/\b(?:jam|pukul|at)\b[^.]*$/)?.[0] ?? "") as string
        ) ??
        parseSpokenTimeAmPm(
          (lower.match(/\b(?:jam|pukul|at)\b[^.]*$/)?.[0] ?? "") as string
        );
      if (date) out.dueDate = date;
      if (time) out.dueTime = time;
    }

    // Labels: "labels work, errands" / "label: work dan errands"
    {
      const m = lower.match(/\b(?:labels?|tag|tags|label)\b[: ]([^.]*)/);
      if (m?.[1]) {
        // Stop label capture when another field keyword starts later in the sentence.
        // Example: "label home location gym" should become ["home"], not ["home location gym"].
        const raw0 = m[1];
        const stopMatch = raw0.match(
          /\b(?:location|lokasi|links?|tautan|url|reminder|ingatkan|pengingat|due|tanggal|date|on|time|jam|pukul|repeat|every|priority|project|duration|durasi|selama|for)\b/
        );
        const raw1 = (stopMatch?.index !== undefined ? raw0.slice(0, stopMatch.index) : raw0).trim();

        const raw = raw1
          .replaceAll(" dan ", ",")
          .replaceAll(" and ", ",")
          .replaceAll("&", ",")
          .replaceAll(";", ",");

        const parts = raw
          .split(",")
          .map((p) => p.trim())
          .filter(Boolean)
          .slice(0, 12);

        if (parts.length) {
          const normalized = parts.map((p) => p.replace(/\s+/g, " "));
          // De-duplicate case-insensitively, but preserve the first seen casing.
          const seen = new Set<string>();
          const deduped: string[] = [];
          for (const l of normalized) {
            const key = l.toLowerCase();
            if (seen.has(key)) continue;
            seen.add(key);
            deduped.push(l);
          }
          out.labels = deduped;
        }
      }
    }

    // Location: "location home office" / "lokasi kantor"
    {
      const m = lower.match(/\b(?:location|lokasi)\b[: ]([^.]*)/);
      if (m?.[1]) {
        const raw = m[1].trim();
        if (raw) {
          // Support multiple locations spoken like:
          // "location home office, gym" / "location home office and gym"
          const normalized = raw
            .replace(/\s+(?:and|dan)\s+/gi, ",")
            .replaceAll(";", ",")
            .replaceAll("&", ",")
            .replace(/\n+/g, ",")
            .replaceAll("|", ",");
          const tokens = parseLocationsInput(normalized);
          if (tokens.length) out.location = serializeLocationTokens(tokens);
        }
      }
    }

    // Links: "link docs https://example.com" / "links notes example.com"
    {
      const m = lower.match(/\b(?:links?|tautan|url)\b[: ]([^.]*)/);
      if (m?.[1]) {
        const raw = m[1].trim();
        if (raw) {
          const normalized = raw
            .replace(/\s+(?:and|dan)\s+/gi, "|")
            .replaceAll(";", "|")
            .replaceAll(",", "|")
            .replace(/\n+/g, "|");
          const parts = normalized
            .split("|")
            .map((p) => p.trim())
            .filter(Boolean)
            .slice(0, 12);
          const tokens: string[] = [];
          for (const part of parts) {
            const norm = normalizeLinkToken(part);
            if (norm) tokens.push(norm);
          }
          if (tokens.length) out.link = sortLinksAsc(tokens);
        }
      }
    }

    // Reminder: "reminder 15 minutes" / "ingatkan 1 jam sebelum" / "15 menit sebelum"
    {
      const m = lower.match(
        /\b(?:reminder|ingatkan|pengingat)\b[: ]?(\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|satu|dua|tiga|empat|lima|enam|tujuh|delapan|sembilan|sepuluh|sebelas|dua belas)\s*(minute|minutes|menit|hour|hours|jam|day|days|hari)\b/
      );
      const m2 = lower.match(
        /\b(\d+)\s*(minute|minutes|menit|hour|hours|jam|day|days|hari)\s+(?:before|sebelum)\b/
      );
      const pick = m ?? m2;
      if (pick) {
        const n = numberWordToInt(pick[1]) ?? Number(pick[1]);
        const unit = pick[2];
        const mult =
          unit.startsWith("hour") || unit === "jam"
            ? 60
            : unit.startsWith("day") || unit === "hari"
              ? 1440
              : 1;
        const minutes = n * mult;
        if (Number.isFinite(minutes) && minutes >= 0) {
          out.reminderMinutesBefore = minutes;
        }
      }
    }

    // Duration: "duration 45 minutes" / "for 30 minutes" / "selama 2 jam" / "durasi 1.5 jam"
    {
      const m = lower.match(
        /\b(?:duration|durasi|selama|for)\b[: ]*([0-9]+(?:\.[0-9]+)?)\s*(minutes?|mins?|menit|hours?|hrs?|jam|days?|hari)\b/
      );
      if (m) {
        const n = Number(m[1]);
        const unit = m[2];
        const mins =
          unit.startsWith("hour") || unit.startsWith("hr") || unit === "jam"
            ? Math.round(n * 60)
            : unit.startsWith("day") || unit === "hari"
              ? Math.round(n * 1440)
            : Math.round(n);
        if (Number.isFinite(mins) && mins > 0) out.durationMinutes = mins;
      }
    }

    // Explicit title/description phrases
    {
      const m = rawText.match(/\b(?:title|judul)\b[: ](.+)/i);
      if (m?.[1]) {
        out._explicitTitle = true;
        out.title = m[1].trim();
      }
    }
    {
      const m = rawText.match(/\b(?:description|deskripsi|details?)\b[: ](.+)/i);
      if (m?.[1]) {
        out._explicitDescription = true;
        out.description = m[1].trim();
      }
    }

    return out;
  };

  const syncOrganizeEditorsFromTask = (
    source: {
      labels?: string[] | null;
      link?: string[] | null;
      location?: string | null;
    } | null | undefined,
    mode: "single" | "batch"
  ) => {
    if (mode === "batch") {
      setBatchLabelRows(labelTokensToRows(source?.labels));
      setBatchLinkRows(linkTokensToPairRows(source?.link));
      setBatchLocationRows(locationTokensToPairRows(source?.location));
      return;
    }
    setLabelRows(labelTokensToRows(source?.labels));
    setLinkRows(linkTokensToPairRows(source?.link));
    setLocationRows(locationTokensToPairRows(source?.location));
  };

  const applyVoiceTranscript = (text: string) => {
    const cleaned = text.trim().replace(/\s+/g, " ");
    if (!cleaned) return;

    // Ensure the voice panel is visible so transcript / status stay in view.
    setVoicePanelOpen(true);

    // Multiple create/edit: apply to the active batch row (UI state lives in batchItems).
    if (createMode === "multiple") {
      const splitBatchTitles = (raw: string): string[] => {
        const t = raw
          .trim()
          .replace(/\s*\n+\s*/g, "\n")
          .replaceAll("•", "\n")
          .replaceAll(";", "\n")
          .replace(/\s*\.\s+/g, "\n")
          .replace(/\s+(?:then|next|and then|also)\s+/gi, "\n")
          .replace(/\s*,\s*/g, "\n");
        const lines = t
          .split("\n")
          .map((s) => s.trim())
          .filter(Boolean);
        const out: string[] = [];
        const seen = new Set<string>();
        for (const line of lines) {
          const key = line.toLowerCase();
          if (seen.has(key)) continue;
          seen.add(key);
          out.push(line);
        }
        return out.slice(0, 50);
      };

      const looksLikeFieldInput = /\b(priority|prioritas|due|tanggal|date|on|time|jam|pukul|repeat|every|labels?|label|lokasi|location|links?|tautan|url|reminder|ingatkan|pengingat|duration|durasi|selama|for|description|deskripsi|title|judul)\b/i.test(
        text
      );
      const hasListSeparators = /[\n•;]/.test(text) || /\b(?:then|next|and then|also)\b/i.test(text);

      // Multi-create only: treat spoken lists as new task titles.
      if (!isMultiEdit && hasListSeparators && !looksLikeFieldInput) {
        const incoming = splitBatchTitles(text);
        if (incoming.length === 0) return;
        setBatchItems((prev) => {
          const existingKeys = new Set(
            prev.map((p) => p.title.trim().toLowerCase()).filter(Boolean)
          );
          const now = Date.now();
          const additions = incoming
            .map((t) => t.trim())
            .filter(Boolean)
            .filter((t) => !existingKeys.has(t.toLowerCase()))
            .map((t, i) => ({ ...emptyBatchItem(), key: `v-${now}-${i}`, title: t }));
          return [...prev, ...additions].slice(0, 50);
        });
        return;
      }

      const parsed = parseVoiceFields(cleaned);
      setBatchItems((prev) => {
        const base = prev.length ? prev.slice() : [emptyBatchItem()];
        const idx = Math.max(0, Math.min(base.length - 1, batchActiveIdx));
        const cur = base[idx] ?? emptyBatchItem();

        const nextTitleFromSpeech =
          typeof parsed.title === "string" && parsed.title.trim().length > 0
            ? parsed.title.trim()
            : cleaned.split(" ").slice(0, 8).join(" ");
        const nextTitle =
          (parsed._explicitTitle ? nextTitleFromSpeech : cur.title).trim().length > 0
            ? (parsed._explicitTitle ? nextTitleFromSpeech : cur.title)
            : nextTitleFromSpeech;

        const existingDesc = (cur.description ?? "").trim();
        const nextDescBase = parsed._explicitDescription
          ? String(parsed.description ?? "").trim()
          : existingDesc.length > 0
            ? `${existingDesc}\n${cleaned}`
            : cleaned;

        const mergedLabels =
          parsed.labels && parsed.labels.length
            ? mergeLabelTokens(cur.labels ?? [], parsed.labels)
            : cur.labels;

        const {
          labels: _labels,
          _explicitTitle: _et,
          _explicitDescription: _ed,
          ...taskFields
        } = parsed;

        base[idx] = {
          ...cur,
          ...taskFields,
          title: nextTitle,
          description: nextDescBase,
          labels: mergedLabels ?? []
        };
        queueMicrotask(() => {
          syncOrganizeEditorsFromTask(base[idx], "batch");
        });
        return base;
      });
      setBatchVoiceTouchedKeys((prev) => {
        const next = new Set(prev);
        const key = batchItems[batchActiveIdx]?.key;
        if (key) next.add(key);
        return next;
      });
      if (parsed.durationMinutes !== undefined) {
        setBatchDurationUIFromMinutes(parsed.durationMinutes);
      }
      return;
    }

    const parsed = parseVoiceFields(cleaned);
    setDraft((prev) => {
      if (!prev) return prev;
      const nextTitleFromSpeech =
        typeof parsed.title === "string" && parsed.title.trim().length > 0
          ? parsed.title.trim()
          : cleaned.split(" ").slice(0, 8).join(" ");
      const nextTitle =
        (parsed._explicitTitle ? nextTitleFromSpeech : prev.title).trim().length > 0
          ? (parsed._explicitTitle ? nextTitleFromSpeech : prev.title)
          : nextTitleFromSpeech;

      const existingDesc = (prev.description ?? "").trim();
      const nextDescBase = parsed._explicitDescription
        ? String(parsed.description ?? "").trim()
        : existingDesc.length > 0
          ? `${existingDesc}\n${cleaned}`
          : cleaned;

      // Merge labels case-insensitively while preserving the casing
      // of the first occurrence (existing labels win).
      const mergedLabels =
        parsed.labels && parsed.labels.length
          ? mergeLabelTokens(prev.labels ?? [], parsed.labels)
          : prev.labels;

      const {
        labels: _labels,
        _explicitTitle: _et,
        _explicitDescription: _ed,
        ...taskFields
      } = parsed;

      const next = {
        ...prev,
        ...taskFields,
        title: nextTitle,
        description: nextDescBase,
        labels: mergedLabels ?? []
      };
      queueMicrotask(() => {
        syncOrganizeEditorsFromTask(next, "single");
      });
      return next;
    });

    if (parsed.durationMinutes !== undefined) {
      setDurationUIFromMinutes(parsed.durationMinutes);
    }
  };

  const startVoiceInput = () => {
    if (!voiceSupported) return;
    const w = window as any;
    const Ctor: SpeechRecognitionCtor | undefined =
      (w.SpeechRecognition as SpeechRecognitionCtor | undefined) ??
      (w.webkitSpeechRecognition as SpeechRecognitionCtor | undefined);
    if (!Ctor) {
      setVoiceSupported(false);
      return;
    }

    setVoiceError(null);
    setVoiceTranscript("");
    setListening(true);

    const recognition = new Ctor();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = navigator.language || "en-US";

    let accumulatedFinal = "";
    // Smarter auto-stop:
    // - hardMaxMs: never listen forever
    // - idleMs: stop after short inactivity even without explicit punctuation
    // - afterFinalMs: stop quickly after we get a final chunk that looks "done"
    const hardMaxMs = 60_000;
    const idleMs = 8_000;
    const afterFinalMs = 1_600;

    let hardTimer: number | null = null;
    let idleTimer: number | null = null;
    let finishTimer: number | null = null;

    const clearTimers = () => {
      if (hardTimer) window.clearTimeout(hardTimer);
      if (idleTimer) window.clearTimeout(idleTimer);
      if (finishTimer) window.clearTimeout(finishTimer);
      hardTimer = null;
      idleTimer = null;
      finishTimer = null;
    };

    const scheduleIdleStop = () => {
      if (idleTimer) window.clearTimeout(idleTimer);
      idleTimer = window.setTimeout(() => recognition.stop(), idleMs);
    };

    const scheduleFinishStop = (ms: number) => {
      if (finishTimer) window.clearTimeout(finishTimer);
      finishTimer = window.setTimeout(() => recognition.stop(), ms);
    };

    const looksComplete = (s: string) => {
      const t = s.trim().toLowerCase();
      if (!t) return false;
      if (/[.!?]\s*$/.test(t)) return true;
      if (/\b(done|that's all|that is all|finish|finished|selesai|cukup|sudah)\b/.test(t)) {
        return true;
      }
      // If we already have a reasonable amount of content, be willing to stop sooner.
      if (t.length >= 40 && /\b(at|on|due|repeat|every|labels?|location|reminder|tanggal|jam|pukul|setiap|pengingat|lokasi|label)\b/.test(t)) {
        return true;
      }
      return false;
    };

    recognition.onresult = (event: any) => {
      // any result means we're still active
      scheduleIdleStop();
      let interim = "";
      let sawFinal = false;
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const res = event.results[i];
        const txt = String(res[0]?.transcript ?? "");
        if (res.isFinal) {
          accumulatedFinal += txt;
          sawFinal = true;
        }
        else interim += txt;
      }
      const combined = `${accumulatedFinal}${interim}`.trim();
      setVoiceTranscript(combined);

      // If we got a final chunk and it looks like the sentence wrapped up,
      // stop quickly so we can populate the fields immediately.
      if (sawFinal && looksComplete(combined)) {
        scheduleFinishStop(afterFinalMs);
      }
    };

    recognition.onerror = (event: any) => {
      setVoiceError(String(event?.error ?? "voice_error"));
    };

    recognition.onend = () => {
      clearTimers();
      setListening(false);
      const finalText = accumulatedFinal.trim();
      if (finalText) applyVoiceTranscript(finalText);
    };

    // Start timers on launch too, in case the API never fires interim results.
    hardTimer = window.setTimeout(() => recognition.stop(), hardMaxMs);
    scheduleIdleStop();
    try {
      recognition.start();
    } catch {
      clearTimers();
      setListening(false);
      setVoiceError("voice_start_failed");
    }
  };

  return (
    <div
      className="drawer-backdrop"
      onClick={() => {
        if (saving) return;
        onClose();
      }}
    >
      <aside
        className="drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="task-editor-heading"
        onClick={(e) => e.stopPropagation()}
      >
        <header
          className={`drawer-header drawer-header--pro${bodyScrolled ? " is-scrolled" : ""}`}
        >
          <div className="drawer-header-line">
            <div className="drawer-header-copy">
              <h2 id="task-editor-heading">
                {draft.id === "new" ? "Create task" : "Edit task"}
              </h2>
              {multipleFlow && batchItems.length > 0 ? (
                <span className="drawer-mode-meta" aria-live="polite">
                  {batchActiveIdx + 1}/{batchItems.length}
                </span>
              ) : null}
              {isMultiEdit ? (
                <span className="drawer-mode-meta drawer-mode-meta--soft">
                  {Array.isArray(task) ? task.length : 1} selected
                </span>
              ) : null}
            </div>

            {draft.id === "new" ? (
              <div className="drawer-header-actions" role="tablist" aria-label="Create mode">
                <div className="segmented">
                  <button
                    type="button"
                    className={`ghost-button small ${createMode === "single" ? "is-active" : ""}`}
                    onClick={() => setCreateMode("single")}
                    title="Create one task (standard editor)"
                    role="tab"
                    aria-selected={createMode === "single"}
                  >
                    Single
                  </button>
                  <button
                    type="button"
                    className={`ghost-button small ${createMode === "multiple" ? "is-active" : ""}`}
                    onClick={() => {
                      setCreateMode("multiple");
                      setBatchItems([{ ...emptyBatchItem(), key: `m-${Date.now()}` }]);
                      setBatchActiveIdx(0);
                    }}
                    title="Create multiple tasks at once"
                    role="tab"
                    aria-selected={createMode === "multiple"}
                  >
                    Multiple
                  </button>
                </div>
              </div>
            ) : null}
          </div>

          {draft.id !== "new" ? (
            <div className="drawer-id-meta" aria-label="Task identifiers">
              {(
                [
                  { key: "id", label: "ID", value: stripDoubleColonSuffix(draft.id) },
                  draft.parentId
                    ? {
                        key: "parent",
                        label: "Parent",
                        value: stripDoubleColonSuffix(draft.parentId)
                      }
                    : null,
                  draft.childId
                    ? {
                        key: "child",
                        label: "Child",
                        value: stripDoubleColonSuffix(draft.childId)
                      }
                    : null
                ] as Array<{ key: string; label: string; value: string } | null>
              )
                .filter((x): x is { key: string; label: string; value: string } =>
                  Boolean(x?.value)
                )
                .map((item, index) => {
                  const copied = copiedIdKey === item.key;
                  return (
                    <span key={item.key} className="drawer-id-meta-pair">
                      {index > 0 ? (
                        <span className="drawer-id-meta-sep" aria-hidden="true">
                          ·
                        </span>
                      ) : null}
                      <button
                        type="button"
                        className={`drawer-id-meta-btn${copied ? " is-copied" : ""}`}
                        title="Click to copy"
                        aria-label={`Copy ${item.label} ${item.value}`}
                        onClick={() => copyIdValue(item.key, item.value)}
                      >
                        <span className="drawer-id-meta-k">{item.label}</span>
                        <span className="drawer-id-meta-v">
                          {copied ? "Copied" : item.value}
                        </span>
                      </button>
                    </span>
                  );
                })}
            </div>
          ) : (
            <p className="drawer-subtitle">
              {createMode === "multiple"
                ? "Paste a list, then review tasks one by one."
                : "Fast capture with voice + a clean, focused form."}
            </p>
          )}
        </header>
        <div className="drawer-body" ref={drawerBodyRef}>
          <div
            className={`drawer-card drawer-card--voice${
              voicePanelOpen ? "" : " drawer-card--voice-collapsed"
            }${listening ? " is-listening" : ""}`}
          >
            <div
              className="drawer-voice-bar"
              onClick={
                !voicePanelOpen && draft.id !== "new"
                  ? () => setVoicePanelOpen(true)
                  : undefined
              }
              role={!voicePanelOpen && draft.id !== "new" ? "button" : undefined}
              tabIndex={!voicePanelOpen && draft.id !== "new" ? 0 : undefined}
              onKeyDown={
                !voicePanelOpen && draft.id !== "new"
                  ? (e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        setVoicePanelOpen(true);
                      }
                    }
                  : undefined
              }
              aria-label={!voicePanelOpen && draft.id !== "new" ? "Show voice input" : undefined}
            >
              <div className="drawer-voice-copy">
                <div className="drawer-voice-title-row">
                  <span className="drawer-voice-mark" aria-hidden="true" />
                  <div className="drawer-card-title">Voice</div>
                  {listening ? (
                    <span className="drawer-voice-status" aria-live="polite">
                      Listening
                    </span>
                  ) : !voiceSupported ? (
                    <span className="drawer-voice-status is-muted">Unavailable</span>
                  ) : !voicePanelOpen ? (
                    <span className="drawer-voice-status is-muted drawer-voice-status--idle">
                      Ready
                    </span>
                  ) : null}
                </div>
                <div className="drawer-card-desc">
                  {!voicePanelOpen
                    ? "Tap to dictate updates"
                    : listening
                      ? "Speak naturally — stops when you pause."
                      : draft.id === "new"
                        ? "Speak to fill fields, or list multiple tasks."
                        : "Speak to update this task."}
                </div>
              </div>
              <div
                className="drawer-voice-actions"
                onClick={(e) => e.stopPropagation()}
                onKeyDown={(e) => e.stopPropagation()}
              >
                {draft.id !== "new" ? (
                  <button
                    type="button"
                    className={`drawer-voice-collapse${voicePanelOpen ? "" : " is-expand"}`}
                    aria-expanded={voicePanelOpen}
                    onClick={() => setVoicePanelOpen((v) => !v)}
                    title={voicePanelOpen ? "Hide voice" : "Show voice"}
                  >
                    <span>{voicePanelOpen ? "Hide" : "Show"}</span>
                    <span className="drawer-voice-chevron" aria-hidden="true" />
                  </button>
                ) : null}
                {voicePanelOpen ? (
                  <button
                    type="button"
                    className={`drawer-voice-cta${listening ? " is-listening" : ""}`}
                    disabled={!voiceSupported || listening}
                    onClick={() => startVoiceInput()}
                    title={
                      voiceSupported
                        ? "Start voice input (auto-stops after a short pause)"
                        : "Voice input not supported in this browser"
                    }
                  >
                    <span className="drawer-voice-btn-dot" aria-hidden="true" />
                    {listening ? "Listening…" : "Start listening"}
                  </button>
                ) : null}
              </div>
            </div>
            {voicePanelOpen && (listening || voiceError || voiceTranscript) ? (
              <div className="drawer-voice-body">
                {voiceError ? (
                  <div className="drawer-voice-error" role="status">
                    Voice: {voiceError}
                  </div>
                ) : null}
                {listening && voiceTranscript ? (
                  <div className="drawer-transcript" aria-label="Live transcript">
                    {voiceTranscript}
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>

          {multipleFlow ? (
            <div className="drawer-card">
              <div className="drawer-card-head">
                <div>
                  <div className="drawer-card-title">Multiple tasks</div>
                  <div className="drawer-card-desc">
                    Add tasks, then review each one with the same editor (like a guided form).
                  </div>
                </div>
              </div>

              {isMultiCreate ? (
                <div className="drawer-row drawer-row--between drawer-row--spaced">
                  <div className="drawer-row drawer-row--tight">
                    <button
                      type="button"
                      className="ghost-button small"
                      onClick={() => {
                        const now = Date.now();
                        setBatchItems((prev) => {
                          const next = [...prev, { ...emptyBatchItem(), key: `m-${now}` }].slice(0, 50);
                          setBatchActiveIdx(Math.max(0, Math.min(49, next.length - 1)));
                          return next;
                        });
                      }}
                      title="Add another task"
                    >
                      Add task
                    </button>
                    <button
                      type="button"
                      className="ghost-button small"
                      disabled={batchItems.length <= 1}
                      onClick={() => {
                        setBatchItems((prev) => {
                          if (prev.length <= 1) return prev;
                          const idx = Math.max(0, Math.min(prev.length - 1, batchActiveIdx));
                          const next = prev.filter((_, i) => i !== idx);
                          setBatchActiveIdx((cur) => Math.max(0, Math.min(cur, next.length - 1)));
                          return next.length ? next : [{ ...emptyBatchItem(), key: `m-${Date.now()}` }];
                        });
                      }}
                      title="Remove current task"
                    >
                      Remove
                    </button>
                  </div>
                </div>
              ) : (
                <div className="drawer-row drawer-row--between drawer-row--spaced">
                  <span className="muted small" aria-label="Multiple edit hint">
                    Editing {batchItems.length} task{batchItems.length === 1 ? "" : "s"} (latest due date first).
                  </span>
                </div>
              )}

              <div className="drawer-card drawer-card--inset">
                <div className="drawer-card-head">
                  <div className="drawer-row drawer-row--tight drawer-row--spread">
                    <div className="drawer-row drawer-row--tight">
                      <div className="drawer-card-title">Task details</div>
                      {batchItems.length > 1 ? (
                        <span className="pill subtle drawer-step-pill" aria-label="Task position">
                          {batchActiveIdx + 1}/{batchItems.length}
                        </span>
                      ) : null}
                    </div>
                    {batchItems[batchActiveIdx] &&
                    batchVoiceTouchedKeys.has(batchItems[batchActiveIdx]!.key) ? (
                      <span className="pill subtle" title="This task has been updated by voice input">
                        Voice-updated
                      </span>
                    ) : (
                      <span className="pill subtle" title="You can fill fields manually or using voice input">
                        Manual/voice
                      </span>
                    )}
                  </div>
                </div>

                {(() => {
                  const row = batchItems[batchActiveIdx];
                  if (!row) return null;
                  return (
                    <>
                      <div className="drawer-card drawer-card--nested drawer-card--basics">
                        <div className="drawer-card-head drawer-card-head--section">
                          <div>
                            <div className="drawer-card-title">Basics</div>
                            <div className="drawer-card-desc">Title, context, priority, and repeat.</div>
                          </div>
                        </div>
                        {renderBasicsEditor({
                          title: row.title,
                          description: row.description ?? "",
                          priority: row.priority ?? "medium",
                          repeat: (row.repeat ?? "none") as NonNullable<Task["repeat"]>,
                          repeatEvery: row.repeatEvery,
                          repeatUnit: row.repeatUnit,
                          titleInputId: "task-editor-title",
                          onChange: (patch) => {
                            setBatchItems((prev) =>
                              prev.map((p, i) => (i === batchActiveIdx ? { ...p, ...patch } : p))
                            );
                          }
                        })}
                      </div>

                      <div className="drawer-card drawer-card--nested drawer-card--schedule">
                        <div className="drawer-card-head drawer-card-head--section">
                          <div>
                            <div className="drawer-card-title">Schedule</div>
                            <div className="drawer-card-desc">When it happens, and how long it takes.</div>
                          </div>
                        </div>
                        {renderScheduleEditor({
                          dueDate: row.dueDate,
                          dueTime: row.dueTime,
                          durationAmount: batchDurationAmount,
                          durationUnit: batchDurationUnit,
                          onDueDate: (v) => {
                            setBatchItems((prev) =>
                              prev.map((p, i) => (i === batchActiveIdx ? { ...p, dueDate: v } : p))
                            );
                          },
                          onDueTime: (v) => {
                            setBatchItems((prev) =>
                              prev.map((p, i) => (i === batchActiveIdx ? { ...p, dueTime: v } : p))
                            );
                          },
                          onDurationAmount: (nextAmount) => {
                            setBatchDurationAmount(nextAmount);
                            const mins = durationMinutesFromUi(nextAmount, batchDurationUnit);
                            setBatchItems((prev) =>
                              prev.map((p, i) =>
                                i === batchActiveIdx ? { ...p, durationMinutes: mins } : p
                              )
                            );
                          },
                          onDurationUnit: (u) => {
                            setBatchDurationUnit(u);
                            const mins = durationMinutesFromUi(batchDurationAmount, u);
                            setBatchItems((prev) =>
                              prev.map((p, i) =>
                                i === batchActiveIdx ? { ...p, durationMinutes: mins } : p
                              )
                            );
                          }
                        })}
                      </div>

                      <div className="drawer-card drawer-card--nested drawer-card--organize">
                        <div className="drawer-card-head drawer-card-head--section">
                          <div>
                            <div className="drawer-card-title">Organize</div>
                            <div className="drawer-card-desc">Tags, places, links, and reminders.</div>
                          </div>
                        </div>
                      {renderTextRowsEditor({
                        label: "Labels",
                        hint: "Add a label",
                        rows: batchLabelRows,
                        onChange: commitBatchLabelRows,
                        textPlaceholder: "e.g. Work, Deep focus",
                        preview: rowsToLabelTokens(batchLabelRows).map((tok) => ({
                          key: tok,
                          text: tok
                        }))
                      })}

                      {renderPairRowsEditor({
                        label: "Location",
                        hint: "Add a place name and optional map/URL",
                        rows: batchLocationRows,
                        onChange: commitBatchLocationRows,
                        textPlaceholder: "Place name or note",
                        urlPlaceholder: "https://…",
                        preview: batchLocationRows
                          .map((r) => {
                            const value = pairRowsToLocationValue([r]);
                            if (!value) return null;
                            const tok = deserializeLocationTokens(value)[0];
                            if (!tok) return null;
                            const { label, query } = splitLocationStoredToken(tok);
                            const meta = locationHrefMetaForToken(tok);
                            return {
                              key: r.key,
                              text: label ?? query,
                              href: meta?.href
                            };
                          })
                          .filter(Boolean) as Array<{ key: string; text: string; href?: string }>
                      })}

                      {renderPairRowsEditor({
                        label: "Links",
                        hint: "Add a label and optional URL",
                        rows: batchLinkRows,
                        onChange: commitBatchLinkRows,
                        textPlaceholder: "Label or note",
                        urlPlaceholder: "https://…",
                        preview: pairRowsToLinkTokens(batchLinkRows).map((tok) => {
                          const parsed = parseLinkAliasToken(tok);
                          if (!parsed) return { key: tok, text: tok };
                          return {
                            key: tok,
                            text: parsed.label ?? shortLinkText(parsed.href),
                            href: parsed.href
                          };
                        })
                      })}

                      <div className="drawer-organize-block">
                        <div className="drawer-organize-block-head">
                          <span className="drawer-organize-block-title">Reminder</span>
                        </div>
                        <select
                          className="drawer-organize-select"
                          value={
                            row.reminderMinutesBefore !== undefined
                              ? String(row.reminderMinutesBefore)
                              : "none"
                          }
                          onChange={(e) => {
                            const v =
                              e.target.value === "none" ? undefined : Number(e.target.value);
                            setBatchItems((prev) =>
                              prev.map((p, i) =>
                                i === batchActiveIdx ? { ...p, reminderMinutesBefore: v } : p
                              )
                            );
                          }}
                          title="Notification timing before the task."
                        >
                          <option value="none">No reminder</option>
                          <option value="0">At start time</option>
                          <option value="5">5 minutes before</option>
                          <option value="10">10 minutes before</option>
                          <option value="15">15 minutes before</option>
                          <option value="30">30 minutes before</option>
                          <option value="60">1 hour before</option>
                          <option value="1440">1 day before</option>
                        </select>
                      </div>
                      </div>
                    </>
                  );
                })()}
              </div>

            </div>
          ) : null}

          {multipleFlow ? null : (
            <div className="drawer-card drawer-card--basics">
              <div className="drawer-card-head">
                <div>
                  <div className="drawer-card-title">Basics</div>
                  <div className="drawer-card-desc">Start with a clear title and optional context.</div>
                </div>
              </div>
              {renderBasicsEditor({
                title: draft.title,
                description: draft.description ?? "",
                priority: draft.priority,
                repeat: (draft.repeat ?? "none") as NonNullable<Task["repeat"]>,
                repeatEvery: draft.repeatEvery,
                repeatUnit: draft.repeatUnit,
                titleInputId: "task-editor-title",
                onChange: (patch) => setDraft({ ...draft, ...patch })
              })}
            </div>
          )}

          {multipleFlow ? null : (
            <div className="drawer-card drawer-card--schedule">
              <div className="drawer-card-head">
                <div>
                  <div className="drawer-card-title">Schedule</div>
                  <div className="drawer-card-desc">When it’s due, and how long it typically takes.</div>
                </div>
              </div>
              {renderScheduleEditor({
                dueDate: draft.dueDate,
                dueTime: draft.dueTime,
                durationAmount,
                durationUnit,
                onDueDate: (v) => setDraft({ ...draft, dueDate: v }),
                onDueTime: (v) => setDraft({ ...draft, dueTime: v }),
                onDurationAmount: setDurationAmount,
                onDurationUnit: setDurationUnit
              })}
            </div>
          )}

          {multipleFlow ? null : (
            <div className="drawer-card drawer-card--organize">
              <div className="drawer-card-head">
                <div>
                  <div className="drawer-card-title">Organize</div>
                  <div className="drawer-card-desc">Tags, places, links, and reminders.</div>
                </div>
              </div>

          {renderTextRowsEditor({
            label: "Labels",
            hint: "Add a label",
            rows: labelRows,
            onChange: commitLabelRows,
            textPlaceholder: "e.g. Work, Deep focus",
            preview: rowsToLabelTokens(labelRows).map((tok) => ({
              key: tok,
              text: tok
            }))
          })}

          {renderPairRowsEditor({
            label: "Location",
            hint: "Add a place name and optional map/URL",
            rows: locationRows,
            onChange: commitLocationRows,
            textPlaceholder: "Place name or note",
            urlPlaceholder: "https://…",
            preview: locationRows
              .map((r) => {
                const value = pairRowsToLocationValue([r]);
                if (!value) return null;
                const tok = deserializeLocationTokens(value)[0];
                if (!tok) return null;
                const { label, query } = splitLocationStoredToken(tok);
                const meta = locationHrefMetaForToken(tok);
                return {
                  key: r.key,
                  text: label ?? query,
                  href: meta?.href
                };
              })
              .filter(Boolean) as Array<{ key: string; text: string; href?: string }>
          })}

          {renderPairRowsEditor({
            label: "Links",
            hint: "Add a label and optional URL",
            rows: linkRows,
            onChange: commitLinkRows,
            textPlaceholder: "Label or note",
            urlPlaceholder: "https://…",
            preview: pairRowsToLinkTokens(linkRows).map((tok) => {
              const parsed = parseLinkAliasToken(tok);
              if (!parsed) return { key: tok, text: tok };
              return {
                key: tok,
                text: parsed.label ?? shortLinkText(parsed.href),
                href: parsed.href
              };
            })
          })}

          <div className="drawer-organize-block">
            <div className="drawer-organize-block-head">
              <span className="drawer-organize-block-title">Reminder</span>
            </div>
            <select
              className="drawer-organize-select"
              value={
                draft.reminderMinutesBefore !== undefined
                  ? String(draft.reminderMinutesBefore)
                  : "none"
              }
              onChange={(e) =>
                setDraft({
                  ...draft,
                  reminderMinutesBefore:
                        e.target.value === "none" ? undefined : Number(e.target.value)
                })
              }
                  title="Notification timing before the task."
            >
              <option value="none">No reminder</option>
              <option value="0">At start time</option>
              <option value="5">5 minutes before</option>
              <option value="10">10 minutes before</option>
              <option value="15">15 minutes before</option>
              <option value="30">30 minutes before</option>
              <option value="60">1 hour before</option>
              <option value="1440">1 day before</option>
            </select>
          </div>
            </div>
          )}
        </div>
        <footer className="drawer-footer">
          {saving ? (
            <div
              className="drawer-save-progress profile-loading"
              role="status"
              aria-live="polite"
              aria-busy="true"
            >
              <div className="profile-loading-stage">{saveStage}</div>
              <div
                className="profile-loading-track"
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(saveProgress)}
              >
                <div className="profile-loading-fill" style={{ width: `${saveProgress}%` }} />
              </div>
              <div className="profile-loading-meta">
                <span>{Math.round(saveProgress)}%</span>
                <span className="profile-loading-hint">Please wait — keeping the drawer open until save finishes.</span>
              </div>
            </div>
          ) : null}
          <div className="drawer-footer-left">
            {multipleFlow && batchItems.length > 0 ? (
              <span className="pill subtle drawer-footer-progress" aria-live="polite">
                Task {batchActiveIdx + 1} of {batchItems.length}
              </span>
            ) : (
              <span className="drawer-footer-hint muted small">
                {draft.id === "new" ? "Title required to save" : "Changes save when you confirm"}
              </span>
            )}
            {multipleFlow && batchItems.length > 1 ? (
              <>
                <button
                  type="button"
                  className="ghost-button"
                  onClick={() => setBatchActiveIdx((i) => Math.max(0, i - 1))}
                  disabled={saving || batchActiveIdx <= 0}
                  title="Previous task"
                >
                  Prev
                </button>
                <button
                  type="button"
                  className="ghost-button"
                  onClick={() =>
                    setBatchActiveIdx((i) => Math.min(Math.max(0, batchItems.length - 1), i + 1))
                  }
                  disabled={saving || batchActiveIdx >= batchItems.length - 1}
                  title="Next task"
                >
                  Next
                </button>
              </>
            ) : null}
          </div>

          <div className="drawer-footer-right">
          <button className="ghost-button" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button
            className="primary-button"
            onClick={() => {
              if (!draft || saving) return;
                let payload: Task | Task[] | null = null;
                if (multipleFlow) {
                  const out = batchItems
                    .slice(0, 50)
                    .map((item) => {
                      const base: Task | null = item.source ? item.source : draft;
                      if (!base) return null;
                      const next: Task = {
                        ...base,
                        id: item.source ? item.source.id : "new",
                        title: item.title.trim(),
                        description: (item.description ?? "").trim() ? item.description : undefined,
                        priority: item.priority ?? "medium",
                        dueDate: item.dueDate,
                        dueTime: item.dueTime,
                        durationMinutes: item.durationMinutes,
                        repeat: item.repeat ?? "none",
                        repeatEvery: item.repeatEvery,
                        repeatUnit: item.repeatUnit,
                        labels: item.labels ?? [],
                        location: item.location,
                        link: item.link,
                        reminderMinutesBefore: item.reminderMinutesBefore,
                        completed: item.source ? item.source.completed : false
                      };
                      if (!item.source) next.projectId = base.projectId;
                      return next;
                    })
                    .filter((x): x is Task => x !== null && x.title.trim().length > 0);

                  if (out.length === 0) return;
                  payload = out;
                } else {
                  payload = normalizeDraft(draft);
                }
                if (!payload) return;

                const isCreate = Array.isArray(payload)
                  ? payload.every((t) => t.id === "new")
                  : payload.id === "new";
                setSaving(true);
                setSaveProgress(8);
                setSaveStage(isCreate ? "Creating task…" : "Saving changes…");
                if (saveProgressTimerRef.current != null) {
                  window.clearInterval(saveProgressTimerRef.current);
                }
                saveProgressTimerRef.current = window.setInterval(() => {
                  setSaveProgress((p) => {
                    if (p >= 88) return p;
                    const next = p + (p < 40 ? 7 : p < 70 ? 4 : 1.5);
                    return Math.min(88, next);
                  });
                  setSaveStage((prev) => {
                    if (prev.includes("Confirming")) return prev;
                    return isCreate ? "Writing to storage…" : "Confirming changes…";
                  });
                }, 220);

                void (async () => {
                  try {
                    await Promise.resolve(onSave(payload!));
                    setSaveProgress(100);
                    setSaveStage(isCreate ? "Created" : "Saved");
                  } catch (err) {
                    console.error("[TaskEditorDrawer] save failed", err);
                    setSaveStage("Save failed — try again");
                  } finally {
                    if (saveProgressTimerRef.current != null) {
                      window.clearInterval(saveProgressTimerRef.current);
                      saveProgressTimerRef.current = null;
                    }
                    // Brief settle so the bar can reach 100% before parent closes the drawer.
                    window.setTimeout(() => {
                      setSaving(false);
                      setSaveProgress(0);
                    }, 180);
                  }
                })();
              }}
              disabled={
                saving ||
                (multipleFlow
                  ? batchItems.every((x) => !x.title.trim())
                  : !draft.title.trim())
              }
            >
              {saving
                ? "Saving…"
                : multipleFlow
                  ? isMultiEdit
                    ? "Save changes"
                    : "Create tasks"
                  : "Save task"}
          </button>
          </div>
        </footer>
      </aside>
    </div>
  );
}

