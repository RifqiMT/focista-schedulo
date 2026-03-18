import { Task } from "./TaskBoard";
import { useEffect, useRef, useState } from "react";

interface TaskEditorDrawerProps {
  task: Task | null;
  onClose: () => void;
  onSave: (task: Task) => void;
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
  const [draft, setDraft] = useState<Task | null>(task);
  // Keep the text inputs for labels/location empty so users can add new
  // values without having to clear the existing draft content first.
  const [labelsInputValue, setLabelsInputValue] = useState<string>("");
  const hasInteractedWithLabelsRef = useRef(false);
  const [selectedLabelKeys, setSelectedLabelKeys] = useState<Set<string>>(
    () => new Set()
  );
  // Prevent the "sync labels -> input" effect from immediately overwriting
  // the user's cleared buffer right after committing labels via Enter/blur.
  const suppressLabelsInputSyncRef = useRef(false);

  const [linksInputValue, setLinksInputValue] = useState<string>(
    ""
  );
  const [locationInputValue, setLocationInputValue] = useState<string>("");
  const hasInteractedWithLinksRef = useRef(false);
  const suppressLinksInputSyncRef = useRef(false);
  const [voiceSupported, setVoiceSupported] = useState(true);
  const [listening, setListening] = useState(false);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const [voiceTranscript, setVoiceTranscript] = useState("");
  const [durationUnit, setDurationUnit] = useState<"minute" | "hour" | "day">("minute");
  const [durationAmount, setDurationAmount] = useState<string>("");

  const parseLabelsInput = (raw: string): string[] => {
    const cleaned = raw
      .trim()
      .replaceAll(";", ",")
      .replaceAll("&", ",")
      // Allow “and” / “dan” style separators from text input.
      .replace(/\s+(?:and|dan)\s+/gi, ",");
    if (!cleaned) return [];

    const parts = cleaned
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
    if (/^www\./i.test(t)) return `https://${t}`;

    // If it looks like a domain (with optional path), assume https.
    if (/^[a-z0-9-]+(\.[a-z0-9-]+)+([/?#].*)?$/i.test(t) && !/\s/.test(t)) {
      return `https://${t}`;
    }

    // Reject whitespace-containing tokens.
    if (/\s/.test(t)) return null;
    return `https://${t}`;
  };

  const parseLinkAliasToken = (raw: string): { href: string; label?: string } | null => {
    const t = raw.trim();
    if (!t) return null;
    const arrowIdx = t.indexOf("=>");
    if (arrowIdx >= 0) {
      const labelRaw = t.slice(0, arrowIdx).trim();
      const hrefRaw = t.slice(arrowIdx + 2).trim();
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
    if (!parsed) return null;
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

  const linkHrefKey = (token: string): string => {
    const { href } = splitLinkStoredToken(token);
    return href.toLowerCase();
  };

  const sortLinksAsc = (links: string[]) => {
    return links
      .slice()
      .sort((a, b) => linkHrefKey(a).localeCompare(linkHrefKey(b)) || a.localeCompare(b));
  };

  const parseLinksInput = (raw: string): string[] => {
    const cleaned = raw
      .trim()
      .replaceAll(";", ",")
      .replaceAll("&", ",")
      .replace(/\n+/g, ",");
    if (!cleaned) return [];

    const parts = cleaned
      .split(",")
      .map((p) => p.trim())
      .filter(Boolean)
      .slice(0, 12);

    const out: string[] = [];
    const seenByHref = new Map<string, string>(); // hrefKey -> stored token
    for (const p of parts) {
      const norm = normalizeLinkToken(p);
      if (!norm) continue;
      const parsed = splitLinkStoredToken(norm);
      const key = parsed.href.toLowerCase();
      // If label exists, prefer it.
      if (parsed.label) {
        seenByHref.set(key, norm);
      } else if (!seenByHref.has(key)) {
        seenByHref.set(key, norm);
      }
    }
    for (const token of seenByHref.values()) out.push(token);
    return sortLinksAsc(out);
  };

  const mergeLinkTokens = (existing: string[], incoming: string[]): string[] => {
    const map = new Map<string, string>(); // hrefKey -> stored token
    for (const e of existing ?? []) {
      const parsed = splitLinkStoredToken(e);
      if (!parsed.href) continue;
      map.set(parsed.href.toLowerCase(), e);
    }

    for (const rawToken of incoming) {
      const norm = normalizeLinkToken(rawToken);
      if (!norm) continue;
      const parsed = splitLinkStoredToken(norm);
      const key = parsed.href.toLowerCase();

      const hasLabel = !!parsed.label;
      if (hasLabel) {
        map.set(key, norm);
      } else if (!map.has(key)) {
        map.set(key, norm);
      }
    }

    return sortLinksAsc(Array.from(map.values()));
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
    const cleaned = raw
      .trim()
      // Allow many common separators.
      .replaceAll("|", ",")
      .replaceAll(";", ",")
      .replaceAll("&", ",")
      .replace(/\n+/g, ",");
    if (!cleaned) return [];

    const parts = cleaned
      .split(",")
      .map((p) => p.trim())
      .filter(Boolean)
      .slice(0, 12);

    const outByQuery = new Map<string, string>(); // queryKey -> stored token
    for (const p of parts) {
      const arrowIdx = p.indexOf("=>");
      let label: string | undefined;
      let query = p;
      if (arrowIdx >= 0) {
        const labelRaw = p.slice(0, arrowIdx).trim();
        const queryRaw = p.slice(arrowIdx + 2).trim();
        if (labelRaw) label = normalizeSingleLocation(labelRaw);
        query = queryRaw;
      }

      query = normalizeSingleLocation(query);
      if (!query) continue;

      const queryKey = query.toLowerCase();
      const storedToken = label ? `${label}=>${query}` : query;

      // Prefer labeled token if provided.
      const existing = outByQuery.get(queryKey);
      if (!existing || label) outByQuery.set(queryKey, storedToken);
    }

    return Array.from(outByQuery.values());
  };

  const mergeLocationTokens = (existing: string[], incoming: string[]): string[] => {
    const getQueryKey = (token: string) => {
      const idx = token.indexOf("=>");
      const q = idx >= 0 ? token.slice(idx + 2) : token;
      return q.trim().toLowerCase();
    };

    const map = new Map<string, string>(); // queryKey -> stored token
    for (const e of existing ?? []) {
      const t = normalizeSingleLocation(e);
      if (!t) continue;
      map.set(getQueryKey(t), t);
    }

    for (const rawToken of incoming) {
      const t0 = rawToken.trim();
      if (!t0) continue;
      const arrowIdx = t0.indexOf("=>");
      let label: string | undefined;
      let query = t0;
      if (arrowIdx >= 0) {
        const labelRaw = t0.slice(0, arrowIdx).trim();
        const queryRaw = t0.slice(arrowIdx + 2).trim();
        if (labelRaw) label = normalizeSingleLocation(labelRaw);
        query = queryRaw;
      }
      query = normalizeSingleLocation(query);
      if (!query) continue;

      const queryKey = query.toLowerCase();
      const storedToken = label ? `${label}=>${query}` : query;
      const existingToken = map.get(queryKey);

      // If incoming provides a label, replace; otherwise keep existing label if any.
      if (!existingToken || label) map.set(queryKey, storedToken);
    }

    return Array.from(map.values());
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

  useEffect(() => {
    setDraft(task);
    setLabelsInputValue("");
    // Keep the input itself empty so the user can add new links without
    // having to clear the existing tokens first.
    setLinksInputValue("");
    // Avoid emitting label updates on open/mount.
    hasInteractedWithLabelsRef.current = false;
    hasInteractedWithLinksRef.current = false;
    setSelectedLabelKeys(new Set());
    setLocationInputValue("");
  }, [task]);

  useEffect(() => {
    // Keep text input in sync when labels are updated via voice or other actions.
    if (!draft) return;
    if (suppressLabelsInputSyncRef.current) {
      suppressLabelsInputSyncRef.current = false;
      return;
    }
    // Input stays blank by design; labels are edited via the chips + Enter/blur.
    setLabelsInputValue("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft?.id, draft?.labels]);

  useEffect(() => {
    // Keep links input in sync when links are updated via voice or other actions.
    if (!draft) return;
    if (suppressLinksInputSyncRef.current) {
      suppressLinksInputSyncRef.current = false;
      return;
    }
    // Input stays empty by design; links render via preview chips.
    setLinksInputValue("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft?.id, draft?.link]);

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

  useEffect(() => {
    setDurationUIFromMinutes(task?.durationMinutes);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task?.id]);

  // Keep Duration UI in sync even when voice updates draft.durationMinutes.
  useEffect(() => {
    setDurationUIFromMinutes(draft?.durationMinutes);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft?.durationMinutes]);

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

  const draftLabels = (draft?.labels ?? []).slice();
  const pendingLabelTokens = parseLabelsInput(labelsInputValue);
  const previewLabels =
    pendingLabelTokens.length > 0
      ? mergeLabelTokens(draftLabels, pendingLabelTokens)
      : draftLabels.slice().sort(
          (a, b) => a.toLowerCase().localeCompare(b.toLowerCase()) || a.localeCompare(b)
        );

  useEffect(() => {
    if (!onLabelsDraftChange) return;
    if (!hasInteractedWithLabelsRef.current) return;
    onLabelsDraftChange(previewLabels);
  }, [onLabelsDraftChange, previewLabels.join("|")]);

  const draftLinks = (draft?.link ?? []).slice();
  const pendingLinkTokens = parseLinksInput(linksInputValue);
  const previewLinks =
    pendingLinkTokens.length > 0
      ? mergeLinkTokens(draftLinks, pendingLinkTokens)
      : draftLinks.slice();

  const draftLocations = deserializeLocationTokens(draft?.location);
  const pendingLocationTokens = parseLocationsInput(locationInputValue);
  const previewLocations =
    pendingLocationTokens.length > 0
      ? mergeLocationTokens(draftLocations, pendingLocationTokens)
      : draftLocations.slice();

  useEffect(() => {
    if (!onLinksDraftChange) return;
    if (!hasInteractedWithLinksRef.current) return;
    onLinksDraftChange(previewLinks);
  }, [onLinksDraftChange, previewLinks.join("|")]);

  const labelKey = (s: string) => s.trim().toLowerCase();
  const sortLabelsAsc = (labels: string[]) =>
    labels
      .slice()
      .sort((a, b) => labelKey(a).localeCompare(labelKey(b)) || a.localeCompare(b));

  const applyLabelSet = (nextLabels: string[]) => {
    if (!draft) return;
    const sorted = sortLabelsAsc(nextLabels);
    hasInteractedWithLabelsRef.current = true;
    suppressLabelsInputSyncRef.current = true;
    setDraft({ ...draft, labels: sorted });
    // Keep the input itself blank; show values as preview chips only.
    setLabelsInputValue("");
    setSelectedLabelKeys(new Set());
  };

  const applyLinkSet = (nextLinks: string[]) => {
    if (!draft) return;
    const sorted = sortLinksAsc(nextLinks);
    hasInteractedWithLinksRef.current = true;
    suppressLinksInputSyncRef.current = true;
    setDraft({ ...draft, link: sorted.length ? sorted : undefined });
    // Keep input empty; user edits via the dedicated input box above.
    setLinksInputValue("");
  };

  const applyLocationSet = (nextLocations: string[]) => {
    if (!draft) return;
    const merged = nextLocations.map((l) => l.trim()).filter(Boolean);
    setDraft({
      ...draft,
      location: serializeLocationTokens(merged)
    });
    setLocationInputValue("");
  };

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
    hasInteractedWithLabelsRef.current = true;
    const cleaned = text.trim().replace(/\s+/g, " ");
    if (!cleaned) return;
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
          <h2>{draft.id === "new" ? "New task" : "Edit task"}</h2>
        </header>
        <div className="drawer-body">
          <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
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
          {listening && voiceTranscript && (
            <p className="muted" style={{ marginTop: "0.5rem" }}>
              {voiceTranscript}
            </p>
          )}

          <label className="field">
            <span>Title</span>
            <input
              value={draft.title}
              onChange={(e) => setDraft({ ...draft, title: e.target.value })}
              placeholder="What do you want to accomplish?"
            />
          </label>

          <label className="field">
            <span>Description</span>
            <textarea
              value={draft.description ?? ""}
              onChange={(e) =>
                setDraft({ ...draft, description: e.target.value })
              }
              placeholder="Add more context, links, or notes."
              rows={4}
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
            <div style={{ display: "flex", gap: "0.5rem" }}>
              <input
                type="number"
                min={1}
                value={durationAmount}
                onChange={(e) => setDurationAmount(e.target.value)}
                placeholder="e.g. 30"
                style={{ flex: 1 }}
              />
              <select
                value={durationUnit}
                onChange={(e) => setDurationUnit(e.target.value as typeof durationUnit)}
                style={{ width: 140 }}
              >
                <option value="minute">Minutes</option>
                <option value="hour">Hours</option>
                <option value="day">Days</option>
              </select>
            </div>
            <div className="muted" style={{ marginTop: "0.35rem" }}>
              Voice examples: “for 30 minutes”, “selama 2 jam”, “durasi 2 hari”.
            </div>
          </label>

          <label className="field">
            <span>Labels (comma separated)</span>
            <input
              value={labelsInputValue}
              onChange={(e) => {
                hasInteractedWithLabelsRef.current = true;
                setLabelsInputValue(e.target.value);
              }}
              onKeyDown={(e) => {
                if (e.key !== "Enter") return;
                e.preventDefault();
                e.stopPropagation();
                if (!draft) return;

                hasInteractedWithLabelsRef.current = true;
                const raw = labelsInputValue;
                const tokens = parseLabelsInput(raw);
                if (!tokens.length) return;

                suppressLabelsInputSyncRef.current = true;
                setDraft((prev) =>
                  prev
                    ? { ...prev, labels: mergeLabelTokens(prev.labels, tokens) }
                    : prev
                );
                setLabelsInputValue("");
              }}
              onBlur={() => {
                if (!draft) return;
                const raw = labelsInputValue;
                setDraft((prev) => {
                  const tokens = parseLabelsInput(raw);
                  if (!tokens.length) return prev;
                  hasInteractedWithLabelsRef.current = true;
                  suppressLabelsInputSyncRef.current = true;
                  return { ...prev, labels: mergeLabelTokens(prev.labels, tokens) };
                });
                setLabelsInputValue("");
              }}
              placeholder="Work, Deep focus, Errands"
            />
            {previewLabels.length > 0 ? (
              <div style={{ marginTop: "0.45rem" }}>
                <div
                  style={{
                    display: "flex",
                    flexWrap: "wrap",
                    gap: "0.35rem"
                  }}
                >
                  {previewLabels.map((l) => {
                    const key = labelKey(l);
                    const isSelected = selectedLabelKeys.has(key);
                    return (
                      <span
                        key={l}
                        className="pill label-pill"
                        role="button"
                        tabIndex={0}
                        onClick={() => {
                          setSelectedLabelKeys((prev) => {
                            const next = new Set(prev);
                            if (next.has(key)) next.delete(key);
                            else next.add(key);
                            return next;
                          });
                        }}
                        style={{
                          cursor: "pointer",
                          display: "inline-flex",
                          alignItems: "center",
                          gap: "0.35rem",
                          borderColor: isSelected ? "rgba(239, 68, 68, 0.85)" : undefined,
                          background: isSelected ? "rgba(254, 226, 226, 0.9)" : undefined
                        }}
                        aria-pressed={isSelected}
                        aria-label={`Select label ${l}`}
                      >
                        {l}
                        <button
                          type="button"
                          className="label-chip-delete"
                          style={{
                            padding: 0,
                            border: "none",
                            background: "transparent",
                            cursor: "pointer",
                            color: "rgba(239, 68, 68, 1)",
                            fontWeight: 900,
                            lineHeight: 1
                          }}
                          aria-label={`Delete label ${l}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            applyLabelSet(previewLabels.filter((x) => labelKey(x) !== key));
                          }}
                        >
                          ×
                        </button>
                      </span>
                    );
                  })}
                </div>

                {selectedLabelKeys.size > 0 ? (
                  <div style={{ marginTop: "0.55rem" }}>
                    <button
                      type="button"
                      className="ghost-button small"
                      onClick={() => {
                        hasInteractedWithLabelsRef.current = true;
                        applyLabelSet(
                          previewLabels.filter((x) => !selectedLabelKeys.has(labelKey(x)))
                        );
                      }}
                    >
                      Remove selected ({selectedLabelKeys.size})
                    </button>
                  </div>
                ) : null}
              </div>
            ) : null}
          </label>

          <label className="field">
            <span>Location</span>
            <input
              value={locationInputValue}
              onChange={(e) => {
                setLocationInputValue(e.target.value);
              }}
              placeholder="Outdoor, Home, Alias=>https://example.com"
              onKeyDown={(e) => {
                if (e.key !== "Enter") return;
                e.preventDefault();
                e.stopPropagation();
                if (!draft) return;
                const tokens = parseLocationsInput(locationInputValue);
                if (!tokens.length) return;
                applyLocationSet(mergeLocationTokens(deserializeLocationTokens(draft.location), tokens));
              }}
              onBlur={() => {
                if (!draft) return;
                const tokens = parseLocationsInput(locationInputValue);
                if (!tokens.length) return;
                applyLocationSet(mergeLocationTokens(deserializeLocationTokens(draft.location), tokens));
              }}
            />
            {previewLocations.length > 0 ? (
              <div style={{ marginTop: "0.45rem" }}>
                <div
                  style={{
                    display: "flex",
                    flexWrap: "wrap",
                    gap: "0.35rem"
                  }}
                >
                  {previewLocations.map((loc) => {
                    const arrowIdx = loc.indexOf("=>");
                    const label = arrowIdx >= 0 ? loc.slice(0, arrowIdx).trim() : "";
                    const query = arrowIdx >= 0 ? loc.slice(arrowIdx + 2).trim() : loc;
                    const display = label || query;
                    const meta = locationHrefMetaForToken(loc);
                    const href = meta?.href ?? null;
                    return (
                      <span
                        key={loc}
                        className="pill label-pill"
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: "0.35rem"
                        }}
                      >
                        <span>{display}</span>
                        {href ? (
                          <a
                            href={href}
                            target="_blank"
                            rel="noreferrer"
                            className="location-map-link"
                            onClick={(e) => e.stopPropagation()}
                            title={
                              meta?.kind === "url" ? `Open ${display}` : `Open ${display}`
                            }
                          >
                            {meta?.kind === "url" ? "Open" : "Open"}
                          </a>
                        ) : null}
                        <button
                          type="button"
                          className="label-chip-delete"
                          aria-label={`Delete location ${display}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            const delQueryKey = query.toLowerCase();
                            applyLocationSet(
                              previewLocations.filter((x) => {
                                const i = x.indexOf("=>");
                                const q = i >= 0 ? x.slice(i + 2).trim() : x;
                                return q.toLowerCase() !== delQueryKey;
                              })
                            );
                          }}
                        >
                          ×
                        </button>
                      </span>
                    );
                  })}
                </div>
              </div>
            ) : null}
          </label>

          <label className="field">
            <span>Link</span>
            <input
              value={linksInputValue}
              onChange={(e) => setLinksInputValue(e.target.value)}
              placeholder="Alias=>URL or URL (comma/newline separated)"
              onKeyDown={(e) => {
                if (e.key !== "Enter") return;
                e.preventDefault();
                e.stopPropagation();
                if (!draft) return;

                const tokens = parseLinksInput(linksInputValue);
                if (!tokens.length) return;
                hasInteractedWithLinksRef.current = true;
                suppressLinksInputSyncRef.current = true;
                setDraft((prev) =>
                  prev
                    ? {
                        ...prev,
                        link: mergeLinkTokens(prev.link ?? [], tokens)
                      }
                    : prev
                );
                setLinksInputValue("");
              }}
              onBlur={() => {
                if (!draft) return;
                const tokens = parseLinksInput(linksInputValue);
                if (!tokens.length) return;
                hasInteractedWithLinksRef.current = true;
                suppressLinksInputSyncRef.current = true;
                setDraft((prev) =>
                  prev
                    ? {
                        ...prev,
                        link: mergeLinkTokens(prev.link ?? [], tokens)
                      }
                    : prev
                );
                setLinksInputValue("");
              }}
            />
            {previewLinks.length > 0 ? (
              <div style={{ marginTop: "0.45rem" }}>
                <div
                  style={{
                    display: "flex",
                    flexWrap: "wrap",
                    gap: "0.35rem"
                  }}
                >
                  {previewLinks.map((l) => {
                    const parsed = parseLinkAliasToken(l) ?? { href: l };
                    const display = parsed.label ?? l;
                    const href = parsed.href;
                    return (
                    <span
                      key={l}
                      className="pill label-pill"
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: "0.35rem"
                      }}
                    >
                      <a
                        href={href}
                        target="_blank"
                        rel="noreferrer"
                        className="link-preview-anchor"
                        onClick={(e) => {
                          // Keep drawer open; do not block navigation.
                          e.stopPropagation();
                        }}
                      >
                        {display}
                      </a>
                      <button
                        type="button"
                        className="label-chip-delete"
                        aria-label={`Delete link ${display}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          const delKey = href.toLowerCase();
                          applyLinkSet(
                            previewLinks.filter((x) => {
                              const p = parseLinkAliasToken(x);
                              const xHref = p?.href ?? x;
                              return xHref.toLowerCase() !== delKey;
                            })
                          );
                        }}
                      >
                        ×
                      </button>
                    </span>
                    );
                  })}
                </div>
              </div>
            ) : null}
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
                    e.target.value === "none"
                      ? undefined
                      : Number(e.target.value)
                })
              }
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
        <footer className="drawer-footer">
          <button className="ghost-button" onClick={onClose}>
            Cancel
          </button>
          <button
            className="primary-button"
            onClick={() => {
              if (!draft) return;
              // Merge any in-progress label text into draft.labels so the user
              // doesn't need to press Enter/blur before saving.
              const tokens = parseLabelsInput(labelsInputValue);
              const labelsToSave =
                tokens.length > 0
                  ? mergeLabelTokens(draft.labels ?? [], tokens)
                  : (draft.labels ?? [])
                      .slice()
                      .sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()) || a.localeCompare(b));
              const linkTokens = parseLinksInput(linksInputValue);
              const linksToSave =
                linkTokens.length > 0
                  ? mergeLinkTokens(draft.link ?? [], linkTokens)
                  : (draft.link ?? []).slice();

              const locationTokens = parseLocationsInput(locationInputValue);
              const baseLocations = deserializeLocationTokens(draft.location);
              const locationsToSave =
                locationTokens.length > 0
                  ? mergeLocationTokens(baseLocations, locationTokens)
                  : baseLocations;

              onSave(
                normalizeDraft({
                  ...draft,
                  labels: labelsToSave,
                  link: linksToSave.length ? linksToSave : undefined,
                  location: serializeLocationTokens(locationsToSave)
                })
              );
            }}
            disabled={!draft.title.trim()}
          >
            Save task
          </button>
        </footer>
      </aside>
    </div>
  );
}

