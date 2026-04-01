import { Task } from "./TaskBoard";
import { useEffect, useState } from "react";

interface TaskEditorDrawerProps {
  task: Task | Task[] | null;
  onClose: () => void;
  onSave: (task: Task | Task[]) => void;
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
  const [labelsInput, setLabelsInput] = useState("");
  const [locationInput, setLocationInput] = useState("");
  const [linksInput, setLinksInput] = useState("");
  const [batchLabelsInputByIdx, setBatchLabelsInputByIdx] = useState<Record<number, string>>({});
  const [batchLocationInputByIdx, setBatchLocationInputByIdx] = useState<Record<number, string>>({});
  const [batchLinksInputByIdx, setBatchLinksInputByIdx] = useState<Record<number, string>>({});

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

  const parseLabelsInput = (raw: string): string[] => {
    const cleaned = raw.trim();
    if (!cleaned) return [];

    // Separators: comma, semicolon, newline. Also allow "and/dan" between words.
    // (Do NOT treat "&" as a separator; users often want it inside a label.)
    const normalized = cleaned
      .replaceAll(";", ",")
      .replace(/\r?\n+/g, ",")
      .replace(/\s+(?:and|dan)\s+/gi, ",");

    const parts = normalized
      .split(",")
      .map((p) => p.trim())
      .filter(Boolean)
      .slice(0, 12);

    const deduped: string[] = [];
    const seen = new Set<string>();
    for (const p of parts) {
      const normalized = p.replace(/\s+/g, " ");
      const key = normalized.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      deduped.push(normalized);
    }
    return deduped;
  };

  const formatLabelsForInput = (tokens: string[] | undefined | null): string =>
    (tokens ?? []).join("\n");

  const normalizeSingleLabel = (raw: string): string => raw.trim().replace(/\s+/g, " ");

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

  const formatLinksForInput = (tokens: string[] | undefined | null): string => {
    const parts = (tokens ?? []).map((tok) => {
      const { href, label } = splitLinkStoredToken(tok);
      const displayHref = shortLinkText(href);
      return label ? `${label} | ${displayHref}` : displayHref;
    });
    return parts.join("\n");
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

  const parseLinksInput = (raw: string): string[] => {
    const cleaned = raw.trim();
    if (!cleaned) return [];

    // Split links by separators WITHOUT breaking aliases.
    // - Separators: comma, semicolon, newline
    // - Allow escaping separators inside aliases with backslash: `\,` or `\;`
    // - IMPORTANT: do NOT treat `&` as a separator; users often want it in aliases.
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

    // If a user accidentally pressed Enter inside an alias label (e.g. "Cover\nLetter=>url"),
    // join the split pieces back together when the combined token becomes a valid alias token.
    const mergedParts: string[] = [];
    for (let i = 0; i < parts.length; i++) {
      const a = parts[i] ?? "";
      const b = parts[i + 1] ?? "";
      if (b) {
        const aLooksStandalone =
          !parseLinkAliasToken(a) && normalizeLinkHref(a) === null && !/[|]/.test(a);
        const combined = `${a.trim()} ${b.trim()}`.trim();
        if (aLooksStandalone && parseLinkAliasToken(combined)) {
          mergedParts.push(combined);
          i++; // consume b
          continue;
        }
      }
      mergedParts.push(a);
    }

    const out: string[] = [];
    const seen = new Map<string, string>(); // tokenKey -> stored token
    for (const p of mergedParts.slice(0, 12)) {
      const norm = normalizeLinkToken(p);
      if (!norm) continue;
      const key = linkTokenKey(norm);
      // If the user provided a labeled link, prefer it over plain URL for same href.
      const hasLabel = norm.includes("=>");
      if (hasLabel) {
        // For labeled links, dedupe by href rather than full token.
        const parsed = parseLinkAliasToken(norm);
        const hrefKey = parsed ? `href:${parsed.href.toLowerCase()}` : key;
        seen.set(hrefKey, norm);
      } else if (!seen.has(key)) {
        seen.set(key, norm);
      }
    }
    for (const token of seen.values()) out.push(token);
    return sortLinksAsc(out);
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

  const formatLocationsForInput = (raw: string | undefined | null): string => {
    const tokens = deserializeLocationTokens(raw);
    return tokens
      .map((tok) => {
        const { label, query } = splitLocationStoredToken(tok);
        return label ? `${label} | ${query}` : query;
      })
      .join("\n");
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
      <div className="task-hovercard-labels" style={{ marginTop: "0.45rem" }} aria-label="Preview">
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
    setLabelsInput(formatLabelsForInput(draft.labels));
    setLocationInput(formatLocationsForInput(draft.location));
    setLinksInput(formatLinksForInput(draft.link));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft?.id, createMode]);

  useEffect(() => {
    if (createMode !== "multiple") return;
    const row = batchItems[batchActiveIdx];
    if (!row) return;
    setBatchLabelsInputByIdx((prev) => ({
      ...prev,
      [batchActiveIdx]: prev[batchActiveIdx] ?? formatLabelsForInput(row.labels)
    }));
    setBatchLocationInputByIdx((prev) => ({
      ...prev,
      [batchActiveIdx]: prev[batchActiveIdx] ?? formatLocationsForInput(row.location)
    }));
    setBatchLinksInputByIdx((prev) => ({
      ...prev,
      [batchActiveIdx]: prev[batchActiveIdx] ?? formatLinksForInput(row.link)
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [createMode, batchActiveIdx, batchItems.length]);

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
          /\b(?:location|lokasi|reminder|ingatkan|pengingat|due|tanggal|date|on|time|jam|pukul|repeat|every|priority|project|duration|durasi|selama|for)\b/
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

  const applyVoiceTranscript = (text: string) => {
    const cleaned = text.trim().replace(/\s+/g, " ");
    if (!cleaned) return;

    // Multiple-create: either add list items OR apply fields to the current editor draft.
    if (draft?.id === "new" && createMode === "multiple") {
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

      const looksLikeFieldInput = /\b(priority|prioritas|due|tanggal|date|on|time|jam|pukul|repeat|every|labels?|label|lokasi|location|reminder|ingatkan|pengingat|duration|durasi|selama|for|description|deskripsi|title|judul)\b/i.test(
        text
      );
      const hasListSeparators = /[\n•;]/.test(text) || /\b(?:then|next|and then|also)\b/i.test(text);

      // If it doesn't look like field commands, treat it as a list of task titles.
      if (hasListSeparators && !looksLikeFieldInput) {
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
            .map((t, i) => ({ key: `v-${now}-${i}`, title: t }));
          return [...prev, ...additions].slice(0, 50);
        });
        return;
      }

      // Otherwise apply parsed fields to the active row (dedicated per task).
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
          description: nextDescBase
        };
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

      return {
        ...prev,
        ...taskFields,
        title: nextTitle,
        description: nextDescBase,
        labels: mergedLabels ?? []
      };
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
    <div className="drawer-backdrop" onClick={onClose}>
      <aside className="drawer" onClick={(e) => e.stopPropagation()}>
        <header className="drawer-header">
          <div className="drawer-header-top">
            <div className="drawer-header-copy">
              <h2>{draft.id === "new" ? "Create task" : "Edit task"}</h2>
              <div className="drawer-subtitle">
                {draft.id === "new"
                  ? createMode === "multiple"
                    ? "Add many tasks quickly, then review each with the same editor."
                    : "Fast capture with voice + a clean, focused form."
                  : "Update details and keep your schedule accurate."}
              </div>
            </div>
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
              <span className="drawer-kbd-hint">
                {createMode === "multiple"
                  ? "Paste a list, then review tasks one by one."
                  : "Tip: use Voice capture for speed."}
              </span>
            </div>
          ) : null}
        </header>
        <div className="drawer-body">
          {draft.id === "new" ? null : null}

          <div className="drawer-card">
            <div className="drawer-voice-top">
              <div>
                <div className="drawer-card-title">Voice capture</div>
                <div className="drawer-card-desc">
                  Speak naturally. For multiple tasks, either speak a list (to add rows) or speak field details for the active row.
                </div>
              </div>
              <div className="drawer-voice-meta">
            <button
              type="button"
              className="ghost-button"
              disabled={!voiceSupported || listening}
              onClick={() => startVoiceInput()}
              title={
                voiceSupported
                  ? "Start voice input (auto-stops after 1 minute of silence)"
                  : "Voice input not supported in this browser"
              }
            >
              {listening ? "Listening…" : "Voice input"}
            </button>
            {listening && (
              <span className="pill subtle">
                Auto-stops when you finish speaking
              </span>
            )}
            {voiceError && <span className="pill subtle">Voice: {voiceError}</span>}
              </div>
          </div>
          {listening && voiceTranscript && (
              <div className="drawer-transcript" aria-label="Live transcript">
              {voiceTranscript}
              </div>
            )}
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
                <div className="drawer-row drawer-row--between" style={{ marginTop: "0.55rem" }}>
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
                <div className="drawer-row drawer-row--between" style={{ marginTop: "0.55rem" }}>
                  <span className="muted small" aria-label="Multiple edit hint">
                    Editing {batchItems.length} task{batchItems.length === 1 ? "" : "s"} (latest due date first).
                  </span>
                </div>
              )}

              <div className="drawer-card" style={{ marginTop: "0.65rem" }}>
                <div className="drawer-card-head">
                  <div className="drawer-row drawer-row--tight" style={{ justifyContent: "space-between", flex: 1 }}>
                    <div className="drawer-row drawer-row--tight">
                      <div className="drawer-card-title">Task details</div>
                      {batchItems.length > 1 ? (
                        <span className="pill subtle" aria-label="Task position">
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
                      <div className="drawer-card" style={{ padding: 0, border: "none", boxShadow: "none" }}>
                        <div className="drawer-card-head" style={{ marginBottom: "0.6rem" }}>
                          <div>
                            <div className="drawer-card-title">Basics</div>
                          </div>
                        </div>
                      <label className="field">
                        <span>Title</span>
                        <input
                          value={row.title}
                          onChange={(e) => {
                            const v = e.target.value;
                            setBatchItems((prev) =>
                              prev.map((p, i) => (i === batchActiveIdx ? { ...p, title: v } : p))
                            );
                          }}
                          placeholder="What do you want to accomplish?"
                          title="Task title (required)."
                        />
                      </label>

                      <label className="field">
                        <span>Description</span>
                        <textarea
                          value={row.description ?? ""}
                          onChange={(e) => {
                            const v = e.target.value;
                            setBatchItems((prev) =>
                              prev.map((p, i) => (i === batchActiveIdx ? { ...p, description: v } : p))
                            );
                          }}
                          placeholder="Add more context, links, or notes."
                          rows={4}
                          title="Optional description for additional context."
                        />
                      </label>

                      <div className="field-grid">
                        <label className="field">
                          <span>Priority</span>
                          <select
                            value={row.priority ?? "medium"}
                            onChange={(e) => {
                              const v = e.target.value as Task["priority"];
                              setBatchItems((prev) =>
                                prev.map((p, i) => (i === batchActiveIdx ? { ...p, priority: v } : p))
                              );
                            }}
                            title="Priority sets urgency and completion points (low=1, medium=2, high=3, urgent=4)."
                          >
                            <option value="low">Low</option>
                            <option value="medium">Medium</option>
                            <option value="high">High</option>
                            <option value="urgent">Urgent</option>
                          </select>
                        </label>

                        <label className="field">
                          <span>Repeat</span>
                          <select
                            value={row.repeat ?? "none"}
                            onChange={(e) => {
                              const v = e.target.value as Task["repeat"];
                              setBatchItems((prev) =>
                                prev.map((p, i) => (i === batchActiveIdx ? { ...p, repeat: v } : p))
                              );
                            }}
                            title="Repeat pattern for recurring tasks."
                          >
                            <option value="none">No repetition</option>
                            <option value="daily">Daily</option>
                            <option value="weekly">Weekly</option>
                            <option value="weekdays">Weekdays (Mon–Fri)</option>
                            <option value="weekends">Weekends (Sat–Sun)</option>
                            <option value="monthly">Monthly</option>
                            <option value="quarterly">Quarterly</option>
                            <option value="yearly">Annually</option>
                            <option value="custom">Custom…</option>
                          </select>
                        </label>
                      </div>

                      {row.repeat === "custom" ? (
                        <div className="field-grid">
                          <label className="field">
                            <span>Every</span>
                            <input
                              type="number"
                              min={1}
                              value={row.repeatEvery ?? 1}
                              onChange={(e) => {
                                const n = Number(e.target.value) || 1;
                                setBatchItems((prev) =>
                                  prev.map((p, i) =>
                                    i === batchActiveIdx ? { ...p, repeatEvery: n } : p
                                  )
                                );
                              }}
                              title="Repeat interval count (e.g. every 2 weeks)."
                            />
                          </label>
                          <label className="field">
                            <span>Unit</span>
                            <select
                              value={row.repeatUnit ?? "week"}
                              onChange={(e) => {
                                const v = e.target.value as Task["repeatUnit"];
                                setBatchItems((prev) =>
                                  prev.map((p, i) =>
                                    i === batchActiveIdx ? { ...p, repeatUnit: v } : p
                                  )
                                );
                              }}
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

                      <div className="drawer-card" style={{ padding: 0, border: "none", boxShadow: "none" }}>
                        <div className="drawer-card-head" style={{ margin: "0.8rem 0 0.6rem" }}>
                          <div>
                            <div className="drawer-card-title">Schedule</div>
                            <div className="drawer-card-desc">When should it happen, and how long?</div>
                          </div>
                        </div>
                      <div className="field-grid">
                        <label className="field">
                          <span>Date</span>
                          <input
                            type="date"
                            value={row.dueDate ?? ""}
                            onChange={(e) => {
                              const v = e.target.value || undefined;
                              setBatchItems((prev) =>
                                prev.map((p, i) => (i === batchActiveIdx ? { ...p, dueDate: v } : p))
                              );
                            }}
                            title="Due date (optional)."
                          />
                        </label>
                        <label className="field">
                          <span>Time</span>
                          <input
                            type="time"
                            value={row.dueTime ?? ""}
                            onChange={(e) => {
                              const v = e.target.value || undefined;
                              setBatchItems((prev) =>
                                prev.map((p, i) => (i === batchActiveIdx ? { ...p, dueTime: v } : p))
                              );
                            }}
                            title="Due time (optional)."
                          />
                        </label>
                      </div>

                      <label className="field">
                        <span>Duration</span>
                        <div className="drawer-row">
                          <input
                            type="number"
                            min={1}
                            value={batchDurationAmount}
                            onChange={(e) => {
                              const nextAmount = e.target.value;
                              setBatchDurationAmount(nextAmount);
                              const amount = Number(nextAmount);
                              const mult = batchDurationUnit === "day" ? 1440 : batchDurationUnit === "hour" ? 60 : 1;
                              const mins =
                                nextAmount.trim().length > 0 && Number.isFinite(amount) && amount > 0
                                  ? Math.round(amount * mult)
                                  : undefined;
                              setBatchItems((prev) =>
                                prev.map((p, i) =>
                                  i === batchActiveIdx ? { ...p, durationMinutes: mins } : p
                                )
                              );
                            }}
                            placeholder="e.g. 30"
                            title="Estimated duration amount (optional)."
                            style={{ flex: 1, minWidth: 140 }}
                          />
                          <select
                            value={batchDurationUnit}
                            onChange={(e) => {
                              const u = e.target.value as typeof batchDurationUnit;
                              setBatchDurationUnit(u);
                              const amount = Number(batchDurationAmount);
                              const mult = u === "day" ? 1440 : u === "hour" ? 60 : 1;
                              const mins =
                                batchDurationAmount.trim().length > 0 && Number.isFinite(amount) && amount > 0
                                  ? Math.round(amount * mult)
                                  : undefined;
                              setBatchItems((prev) =>
                                prev.map((p, i) =>
                                  i === batchActiveIdx ? { ...p, durationMinutes: mins } : p
                                )
                              );
                            }}
                            title="Duration unit."
                            style={{ width: 160 }}
                          >
                            <option value="minute">Minutes</option>
                            <option value="hour">Hours</option>
                            <option value="day">Days</option>
                          </select>
                        </div>
                      </label>
                      </div>

                      <div className="drawer-card" style={{ padding: 0, border: "none", boxShadow: "none" }}>
                        <div className="drawer-card-head" style={{ margin: "0.8rem 0 0.6rem" }}>
                          <div>
                            <div className="drawer-card-title">Organize</div>
                            <div className="drawer-card-desc">Labels, links, location, and reminders.</div>
                          </div>
                        </div>
                      <label className="field">
                        <span>Reminder</span>
                        <select
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
                      </label>

                      <label className="field">
                        <span>Labels</span>
                        <textarea
                          value={
                            batchLabelsInputByIdx[batchActiveIdx] ?? formatLabelsForInput(row.labels)
                          }
                          onChange={(e) => {
                            const raw = e.target.value;
                            setBatchLabelsInputByIdx((prev) => ({ ...prev, [batchActiveIdx]: raw }));
                            const tokens = parseLabelsInput(raw);
                            setBatchItems((prev) =>
                              prev.map((p, i) => (i === batchActiveIdx ? { ...p, labels: tokens } : p))
                            );
                          }}
                          onBlur={() => {
                            const raw = batchLabelsInputByIdx[batchActiveIdx] ?? "";
                            const tokens = parseLabelsInput(raw);
                            setBatchItems((prev) =>
                              prev.map((p, i) => (i === batchActiveIdx ? { ...p, labels: tokens } : p))
                            );
                            setBatchLabelsInputByIdx((prev) => ({
                              ...prev,
                              [batchActiveIdx]: formatLabelsForInput(tokens)
                            }));
                          }}
                          placeholder={"Work\nDeep focus\nErrands"}
                          title="Multiple labels supported. Use one per line, or separate with commas/semicolons."
                          rows={2}
                          style={{ resize: "vertical" }}
                        />
                      </label>

                      <label className="field">
                        <span>Location</span>
                        <textarea
                          value={
                            batchLocationInputByIdx[batchActiveIdx] ?? formatLocationsForInput(row.location)
                          }
                          onChange={(e) => {
                            const raw = e.target.value;
                            setBatchLocationInputByIdx((prev) => ({ ...prev, [batchActiveIdx]: raw }));
                            const tokens = parseLocationsInput(raw);
                            const v = serializeLocationTokens(tokens);
                            setBatchItems((prev) =>
                              prev.map((p, i) => (i === batchActiveIdx ? { ...p, location: v } : p))
                            );
                          }}
                          onBlur={() => {
                            const raw = batchLocationInputByIdx[batchActiveIdx] ?? "";
                            const tokens = parseLocationsInput(raw);
                            const v = serializeLocationTokens(tokens);
                            setBatchItems((prev) =>
                              prev.map((p, i) => (i === batchActiveIdx ? { ...p, location: v } : p))
                            );
                            setBatchLocationInputByIdx((prev) => ({
                              ...prev,
                              [batchActiveIdx]: formatLocationsForInput(v)
                            }));
                          }}
                          placeholder={"Outdoor\nHome\nAlias=>https://example.com"}
                          title="Multiple locations supported. Use one per line, or separate with commas/semicolons. Aliases: Label=>value, Label -> value, or Label | value. URL-like values become clickable in the preview."
                          rows={2}
                          style={{ resize: "vertical" }}
                        />
                        {renderTokenPreview(
                          (() => {
                            const raw = batchLocationInputByIdx[batchActiveIdx] ?? "";
                            const tokens = parseLocationsInput(raw);
                            return tokens.map((tok) => {
                              const { label, query } = splitLocationStoredToken(tok);
                              const meta = locationHrefMetaForToken(tok);
                              return { key: tok, text: label ?? query, href: meta?.href };
                            });
                          })()
                        )}
                      </label>

                      <label className="field">
                        <span>Links</span>
                        <textarea
                          value={batchLinksInputByIdx[batchActiveIdx] ?? formatLinksForInput(row.link)}
                          onChange={(e) => {
                            const raw = e.target.value;
                            setBatchLinksInputByIdx((prev) => ({ ...prev, [batchActiveIdx]: raw }));
                            const tokens = parseLinksInput(raw);
                            // Only commit parsed tokens when we have a valid link or the user cleared the field.
                            if (tokens.length > 0 || raw.trim().length === 0) {
                              setBatchItems((prev) =>
                                prev.map((p, i) =>
                                  i === batchActiveIdx ? { ...p, link: tokens.length ? tokens : undefined } : p
                                )
                              );
                            }
                          }}
                          onBlur={() => {
                            const raw = batchLinksInputByIdx[batchActiveIdx] ?? "";
                            const tokens = parseLinksInput(raw);
                            setBatchItems((prev) =>
                              prev.map((p, i) =>
                                i === batchActiveIdx ? { ...p, link: tokens.length ? tokens : undefined } : p
                              )
                            );
                            setBatchLinksInputByIdx((prev) => ({
                              ...prev,
                              [batchActiveIdx]: formatLinksForInput(tokens)
                            }));
                          }}
                          placeholder={"Cover Letter=>https://...\nResume=>https://...\nOr plain text notes"}
                          title="Multiple entries supported. Use one per line, or separate with commas/semicolons. Supports plain text, URL, or aliases (Label=>URL, Label -> URL, Label | URL). Clickable preview below."
                          rows={2}
                          style={{ resize: "vertical" }}
                        />
                        {renderTokenPreview(
                          (() => {
                            const raw = batchLinksInputByIdx[batchActiveIdx] ?? "";
                            const tokens = parseLinksInput(raw);
                            return tokens.map((tok) => {
                              const parsed = parseLinkAliasToken(tok);
                              if (!parsed) return { key: tok, text: tok };
                              return {
                                key: tok,
                                text: parsed.label ?? shortLinkText(parsed.href),
                                href: parsed.href
                              };
                            });
                          })()
                        )}
                      </label>
                      </div>
                    </>
                  );
                })()}
              </div>

            </div>
          ) : null}

          {multipleFlow ? null : (
            <div className="drawer-card">
              <div className="drawer-card-head">
                <div>
                  <div className="drawer-card-title">Basics</div>
                  <div className="drawer-card-desc">Start with a clear title and optional context.</div>
                </div>
              </div>

          <label className="field">
            <span>Title</span>
            <input
              value={draft.title}
              onChange={(e) => setDraft({ ...draft, title: e.target.value })}
              placeholder="What do you want to accomplish?"
                  title="Task title (required)."
            />
          </label>

          <label className="field">
            <span>Description</span>
            <textarea
              value={draft.description ?? ""}
                onChange={(e) => setDraft({ ...draft, description: e.target.value })}
              placeholder="Add more context, links, or notes."
              rows={4}
                title="Optional description for additional context."
            />
          </label>

          <div className="field-grid">
            <label className="field">
              <span>Priority</span>
              <select
                value={draft.priority}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    priority: e.target.value as Task["priority"]
                  })
                }
                  title="Priority sets urgency and completion points (low=1, medium=2, high=3, urgent=4)."
              >
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
                <option value="urgent">Urgent</option>
              </select>
            </label>

            <label className="field">
              <span>Repeat</span>
              <select
                value={draft.repeat ?? "none"}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    repeat: e.target.value as Task["repeat"]
                  })
                }
                  title="Repeat pattern for recurring tasks."
              >
                <option value="none">No repetition</option>
                <option value="daily">Daily</option>
                <option value="weekly">Weekly</option>
                <option value="weekdays">Weekdays (Mon–Fri)</option>
                <option value="weekends">Weekends (Sat–Sun)</option>
                <option value="monthly">Monthly</option>
                <option value="quarterly">Quarterly</option>
                <option value="yearly">Annually</option>
                <option value="custom">Custom…</option>
              </select>
            </label>
          </div>
            </div>
          )}

          {draft.repeat === "custom" && (
            <div className="field-grid">
              <label className="field">
                <span>Every</span>
                <input
                  type="number"
                  min={1}
                  value={draft.repeatEvery ?? 1}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      repeatEvery: Number(e.target.value) || 1
                    })
                  }
                />
              </label>
              <label className="field">
                <span>Unit</span>
                <select
                  value={draft.repeatUnit ?? "week"}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      repeatUnit: e.target.value as Task["repeatUnit"]
                    })
                  }
                >
                  <option value="day">Day(s)</option>
                  <option value="week">Week(s)</option>
                  <option value="month">Month(s)</option>
                  <option value="quarter">Quarter(s)</option>
                  <option value="year">Year(s)</option>
                </select>
              </label>
            </div>
          )}

          {multipleFlow ? null : (
            <div className="drawer-card">
              <div className="drawer-card-head">
                <div>
                  <div className="drawer-card-title">Schedule</div>
                  <div className="drawer-card-desc">
                    Set when it’s due and how long it typically takes.
                  </div>
                </div>
              </div>

          <div className="field-grid">
            <label className="field">
              <span>Date</span>
              <input
                type="date"
                value={draft.dueDate ?? ""}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    dueDate: e.target.value || undefined
                  })
                }
              />
            </label>
            <label className="field">
              <span>Time</span>
              <input
                type="time"
                value={draft.dueTime ?? ""}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    dueTime: e.target.value || undefined
                  })
                }
              />
            </label>
          </div>

          <label className="field">
            <span>Duration</span>
                <div className="drawer-row">
              <input
                type="number"
                min={1}
                value={durationAmount}
                onChange={(e) => setDurationAmount(e.target.value)}
                placeholder="e.g. 30"
                    style={{ flex: 1, minWidth: 140 }}
              />
              <select
                value={durationUnit}
                onChange={(e) => setDurationUnit(e.target.value as typeof durationUnit)}
                    style={{ width: 160 }}
              >
                <option value="minute">Minutes</option>
                <option value="hour">Hours</option>
                <option value="day">Days</option>
              </select>
            </div>
                <div className="muted small" style={{ marginTop: "0.35rem" }}>
              Voice examples: “for 30 minutes”, “selama 2 jam”, “durasi 2 hari”.
            </div>
          </label>
            </div>
          )}

          {multipleFlow ? null : (
            <div className="drawer-card">
              <div className="drawer-card-head">
                <div>
                  <div className="drawer-card-title">Organize</div>
                  <div className="drawer-card-desc">Labels, links, location, and reminders.</div>
                </div>
              </div>

          <label className="field">
                <span>Labels</span>
                <textarea
                  value={labelsInput}
              onChange={(e) => {
                    const raw = e.target.value;
                    setLabelsInput(raw);
                const tokens = parseLabelsInput(raw);
                    setDraft({ ...draft, labels: tokens });
              }}
              onBlur={() => {
                    const tokens = parseLabelsInput(labelsInput);
                    setDraft({ ...draft, labels: tokens });
                    setLabelsInput(formatLabelsForInput(tokens));
                  }}
                  placeholder={"Work\nDeep focus\nErrands"}
                  title="Multiple labels supported. Use one per line, or separate with commas/semicolons."
                  rows={2}
                  style={{ resize: "vertical" }}
                />
          </label>

          <label className="field">
            <span>Location</span>
                <textarea
                  value={locationInput}
              onChange={(e) => {
                    const raw = e.target.value;
                    setLocationInput(raw);
                    const tokens = parseLocationsInput(raw);
                    const v = serializeLocationTokens(tokens);
                    setDraft({ ...draft, location: v });
              }}
              onBlur={() => {
                    const tokens = parseLocationsInput(locationInput);
                    const v = serializeLocationTokens(tokens);
                    setDraft({ ...draft, location: v });
                    setLocationInput(formatLocationsForInput(v));
                  }}
                  placeholder={"Outdoor\nHome\nAlias=>https://example.com"}
                  title="Multiple locations supported. Use one per line, or separate with commas/semicolons. Aliases: Label=>value, Label -> value, or Label | value. URL-like values become clickable in the preview."
                  rows={2}
                  style={{ resize: "vertical" }}
                />
                {renderTokenPreview(
                  (() => {
                    const tokens = parseLocationsInput(locationInput);
                    return tokens.map((tok) => {
                      const { label, query } = splitLocationStoredToken(tok);
                      const meta = locationHrefMetaForToken(tok);
                      return {
                        key: tok,
                        text: label ?? query,
                        href: meta?.href
                      };
                    });
                  })()
                )}
          </label>

          <label className="field">
                <span>Links</span>
                <textarea
                  value={linksInput}
                  onChange={(e) => {
                    const raw = e.target.value;
                    setLinksInput(raw);
                    const tokens = parseLinksInput(raw);
                    // Only commit parsed tokens when we have a valid link or the user cleared the field.
                    if (tokens.length > 0 || raw.trim().length === 0) {
                      setDraft({ ...draft, link: tokens.length ? tokens : undefined });
                    }
              }}
              onBlur={() => {
                    const tokens = parseLinksInput(linksInput);
                    setDraft({ ...draft, link: tokens.length ? tokens : undefined });
                    setLinksInput(formatLinksForInput(tokens));
                  }}
                  placeholder={"Cover Letter=>https://...\nResume=>https://...\nOr plain text notes"}
                  title="Multiple entries supported. Use one per line, or separate with commas/semicolons. Supports plain text, URL, or aliases (Label=>URL, Label -> URL, Label | URL). Clickable preview below."
                  rows={3}
                  style={{ resize: "vertical" }}
                />
                {renderTokenPreview(
                  (() => {
                    const tokens = parseLinksInput(linksInput);
                    return tokens.map((tok) => {
                      const parsed = parseLinkAliasToken(tok);
                      if (!parsed) {
                        return { key: tok, text: tok };
                      }
                      return {
                        key: tok,
                        text: parsed.label ?? shortLinkText(parsed.href),
                        href: parsed.href
                      };
                    });
                  })()
                )}
          </label>

          <label className="field">
            <span>Reminder</span>
            <select
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
          </label>
            </div>
          )}
        </div>
        <footer className="drawer-footer">
          <div className="drawer-footer-left">
            {multipleFlow && batchItems.length > 1 ? (
              <>
                <button
                  type="button"
                  className="ghost-button"
                  onClick={() => setBatchActiveIdx((i) => Math.max(0, i - 1))}
                  disabled={batchActiveIdx <= 0}
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
                  disabled={batchActiveIdx >= batchItems.length - 1}
                  title="Next task"
                >
                  Next
                </button>
              </>
            ) : null}
          </div>

          <div className="drawer-footer-right">
          <button className="ghost-button" onClick={onClose}>
            Cancel
          </button>
          <button
            className="primary-button"
            onClick={() => {
              if (!draft) return;
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
                  onSave(out);
                  return;
                }
                onSave(normalizeDraft(draft));
              }}
              disabled={
                multipleFlow
                  ? batchItems.every((x) => !x.title.trim())
                  : !draft.title.trim()
              }
            >
              {multipleFlow ? (isMultiEdit ? "Save changes" : "Create tasks") : "Save task"}
          </button>
          </div>
        </footer>
      </aside>
    </div>
  );
}

