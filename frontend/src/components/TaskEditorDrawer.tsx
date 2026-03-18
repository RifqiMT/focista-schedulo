import { Task } from "./TaskBoard";
import { useEffect, useState } from "react";

interface TaskEditorDrawerProps {
  task: Task | null;
  onClose: () => void;
  onSave: (task: Task) => void;
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

export function TaskEditorDrawer({ task, onClose, onSave }: TaskEditorDrawerProps) {
  const [draft, setDraft] = useState<Task | null>(task);
  const [voiceSupported, setVoiceSupported] = useState(true);
  const [listening, setListening] = useState(false);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const [voiceTranscript, setVoiceTranscript] = useState("");
  const [durationUnit, setDurationUnit] = useState<"minute" | "hour" | "day">("minute");
  const [durationAmount, setDurationAmount] = useState<string>("");

  useEffect(() => {
    setDraft(task);
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

    // Deadline date/time: "deadline 2026-01-30 17:00"
    {
      const m = lower.match(/\bdeadline\b([^.]*)/);
      if (m?.[1]) {
        const date = parseSpokenDate(m[1]);
        const time = parseSpokenTime(m[1]);
        if (date) out.deadlineDate = date;
        if (time) out.deadlineTime = time;
      }
    }

    // Labels: "labels work, errands" / "label: work dan errands"
    {
      const m = lower.match(/\b(?:labels?|tag|tags|label)\b[: ]([^.]*)/);
      if (m?.[1]) {
        const raw = m[1]
          .replaceAll(" dan ", ",")
          .replaceAll(" and ", ",")
          .replaceAll(";", ",");
        const parts = raw
          .split(",")
          .map((p) => p.trim())
          .filter(Boolean)
          .slice(0, 12);
        if (parts.length) out.labels = parts.map((p) => p.replace(/\s+/g, " "));
      }
    }

    // Location: "location home office" / "lokasi kantor"
    {
      const m = lower.match(/\b(?:location|lokasi)\b[: ]([^.]*)/);
      if (m?.[1]) {
        const loc = m[1].trim();
        if (loc) out.location = loc;
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

      const mergedLabels =
        parsed.labels && parsed.labels.length
          ? Array.from(new Set([...(prev.labels ?? []), ...parsed.labels]))
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
      if (t.length >= 40 && /\b(at|on|due|deadline|repeat|every|labels?|location|reminder|tanggal|jam|pukul|setiap|pengingat|lokasi|label)\b/.test(t)) {
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

          <div className="field-grid">
            <label className="field">
              <span>Deadline date</span>
              <input
                type="date"
                value={draft.deadlineDate ?? ""}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    deadlineDate: e.target.value || undefined
                  })
                }
              />
            </label>
            <label className="field">
              <span>Deadline time</span>
              <input
                type="time"
                value={draft.deadlineTime ?? ""}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    deadlineTime: e.target.value || undefined
                  })
                }
              />
            </label>
          </div>

          <label className="field">
            <span>Labels (comma separated)</span>
            <input
              value={draft.labels.join(", ")}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  labels: e.target.value
                    .split(",")
                    .map((l) => l.trim())
                    .filter(Boolean)
                })
              }
              placeholder="Work, Deep focus, Errands"
            />
          </label>

          <label className="field">
            <span>Location</span>
            <input
              value={draft.location ?? ""}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  location: e.target.value || undefined
                })
              }
              placeholder="Home office, Gym, Meeting room"
            />
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
            onClick={() => draft && onSave(normalizeDraft(draft))}
            disabled={!draft.title.trim()}
          >
            Save task
          </button>
        </footer>
      </aside>
    </div>
  );
}

