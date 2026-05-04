import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { toastBadgesFullWindowLayout } from "../badgeFullscreen";
import { BadgesModalDialogBody } from "./BadgesModalDialogBody";
import {
  exitBrowserFullscreenAll,
  prefersCssOnlyElementFullscreen,
  PST_TRUE_FULLSCREEN_CONTEXT_EVENT
} from "../fullscreenApi";
import { ProductivityAnalysisModal } from "./ProductivityAnalysisModal";
import { apiFetch, apiUrl } from "../apiClient";

interface Stats {
  profileId?: string | null;
  completedToday: number;
  streakDays: number;
  level: number;
  xpToNext: number;
  pointsToday: number;
  totalPoints: number;
  last7Days?: {
    date: string;
    completed: number;
    points: number;
    taskXpMin?: number | null;
    taskXpMax?: number | null;
    taskXpAvg?: number | null;
    weekdayTaskMin?: number;
    weekdayTaskMax?: number;
    weekdayTaskAvg?: number;
  }[];
  pointsByPriority?: { low: number; medium: number; high: number; urgent: number };
  achievements?: {
    id: string;
    name: string;
    description: string;
    progress: number;
    goal: number;
    achieved: boolean;
    meta?: any;
  }[];
  milestoneAchievements?: {
    badgesEarned: MilestoneBlock;
    streakDays: MilestoneBlock;
    tasksCompleted: MilestoneBlock;
    xpGained: MilestoneBlock;
    levelsUp: MilestoneBlock;
  };
}

interface MilestoneBlock {
  id: string;
  name: string;
  unit: string;
  current: number;
  next: number | null;
  progressToNext: number;
  achievedCount?: number;
  recentUnlocked: number[];
  milestones?: number[];
  achieved?: number[];
  unlockDetails?: Record<
    string,
    {
      dateIso: string;
      task?: {
        id: string;
        title: string;
        dueDate?: string;
        dueTime?: string;
        projectId?: string | null;
        projectName?: string;
        priority?: string;
      };
      source?: string;
    }
  >;
}

function capMilestoneBadges(values: number[], maxBadges: number): number[] {
  const uniqSorted = Array.from(new Set(values)).sort((a, b) => a - b);
  if (uniqSorted.length === 0) return uniqSorted;

  // If the source list is shorter, pad it so each section can show up to `maxBadges` tiers.
  // This keeps the UI consistent (e.g. always "…/150") while still respecting the max cap.
  if (uniqSorted.length < maxBadges) {
    const padded = uniqSorted.slice();
    const last = padded[padded.length - 1]!;
    const prev = padded.length >= 2 ? padded[padded.length - 2]! : last;
    const rawStep = last - prev;
    const step = rawStep > 0 ? rawStep : 1;
    while (padded.length < maxBadges) {
      padded.push(padded[padded.length - 1]! + step);
    }
    return padded;
  }

  if (uniqSorted.length === maxBadges) return uniqSorted;

  // Keep early milestones dense, then down-sample the long tail (always include the last milestone).
  const keepHead = Math.min(100, Math.max(50, Math.floor(maxBadges * 0.66)));
  const head = uniqSorted.slice(0, keepHead);
  const tail = uniqSorted.slice(keepHead);
  const remaining = maxBadges - head.length;
  if (remaining <= 0) return head.slice(0, maxBadges);

  if (tail.length <= remaining) return head.concat(tail);

  const step = Math.ceil(tail.length / remaining);
  const sampledTail: number[] = [];
  for (let i = 0; i < tail.length && sampledTail.length < remaining; i += step) {
    sampledTail.push(tail[i]!);
  }
  const last = tail[tail.length - 1]!;
  if (sampledTail[sampledTail.length - 1] !== last) {
    sampledTail[sampledTail.length - 1] = last;
  }
  return head.concat(sampledTail).slice(0, maxBadges);
}

export function GamificationPanel({ activeProfileId }: { activeProfileId: string | null }) {
  const [stats, setStats] = useState<Stats | null>(null);
  const [profileById, setProfileById] = useState<Record<string, { name: string; title: string }>>({});
  const latestFetchIdRef = useRef(0);
  const statsAbortRef = useRef<AbortController | null>(null);
  const sseRef = useRef<EventSource | null>(null);
  const statsRefreshDebounceRef = useRef<number | null>(null);
  const [badgesOpen, setBadgesOpen] = useState(false);
  const [analysisOpen, setAnalysisOpen] = useState(false);
  const [hoveredBadge, setHoveredBadge] = useState<{
    title: string;
    subtitle: string;
    status: "Unlocked" | "Locked";
    progressLine: string;
    metaLines?: string[];
    progressPct?: number;
    whenLine?: string;
    taskLine?: string;
    chips?: { label: string; value: string }[];
    mouseX: number;
    mouseY: number;
  } | null>(null);
  const hovercardRef = useRef<HTMLDivElement | null>(null);
  const [hovercardPos, setHovercardPos] = useState<{ left: number; top: number } | null>(null);
  const [weeklyBarHover, setWeeklyBarHover] = useState<{
    date: string;
    completed: number;
    points: number;
    taskXpMin: number | null;
    taskXpMax: number | null;
    taskXpAvg: number | null;
    weekdayTaskMin: number;
    weekdayTaskMax: number;
    weekdayTaskAvg: number;
    mouseX: number;
    mouseY: number;
  } | null>(null);
  const weeklyTooltipRef = useRef<HTMLDivElement | null>(null);
  const [weeklyTooltipPos, setWeeklyTooltipPos] = useState<{ left: number; top: number } | null>(
    null
  );
  const [expandedBadgeSections, setExpandedBadgeSections] = useState<Record<string, boolean>>({});
  const badgePanelRef = useRef<HTMLDivElement | null>(null);
  const badgesLayoutToastSentRef = useRef(false);

  const fetchStats = useCallback(async () => {
    const fetchId = ++latestFetchIdRef.current;
    statsAbortRef.current?.abort();
    const controller = new AbortController();
    statsAbortRef.current = controller;
    try {
      const requestedProfileId = activeProfileId ?? null;
      const url = new URL(apiUrl("/api/stats"));
      if (activeProfileId) url.searchParams.set("profileId", activeProfileId);
      const res = await apiFetch(`${url.pathname}${url.search}`, {
        cache: "no-store",
        signal: controller.signal
      });
      if (!res.ok) return;
      const data: Stats = await res.json();
      // Ignore late responses from older requests.
      if (fetchId !== latestFetchIdRef.current) return;
      const responseProfileId = data.profileId ?? null;
      if (import.meta.env.DEV && responseProfileId !== requestedProfileId) {
        console.warn("[progress-scope-mismatch]", {
          requestedProfileId,
          responseProfileId
        });
      }
      if (responseProfileId !== requestedProfileId) return;
      setStats(data);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      // ignore transient network errors
    }
  }, [activeProfileId]);

  useEffect(() => {
    // Initial load
    void fetchStats();

    const onDataChanged = (ev?: Event) => {
      const source = (ev as CustomEvent<{ source?: string }> | undefined)?.detail?.source;
      // Local task/project mutations are shown optimistically in TaskBoard.
      // Refresh progress immediately so Progress stays in lock-step with visible task status.
      if (source === "local") {
        if (statsRefreshDebounceRef.current) {
          window.clearTimeout(statsRefreshDebounceRef.current);
          statsRefreshDebounceRef.current = null;
        }
        void fetchStats();
        return;
      }
      // Coalesce rapid task/project mutation bursts into one stats refresh.
      if (statsRefreshDebounceRef.current) {
        window.clearTimeout(statsRefreshDebounceRef.current);
      }
      statsRefreshDebounceRef.current = window.setTimeout(() => {
        statsRefreshDebounceRef.current = null;
        void fetchStats();
      }, 180);
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void fetchStats();
      }
    };
    const onFocus = () => {
      void fetchStats();
    };

    window.addEventListener("pst:tasks-changed", onDataChanged);
    window.addEventListener("pst:projects-changed", onDataChanged);
    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("focus", onFocus);

    // Gentle periodic refresh (e.g. if backend state changes indirectly).
    const intervalId = window.setInterval(() => {
      void fetchStats();
    }, 15_000);

    // Real-time updates via SSE (fallback is the interval + events above).
    try {
      const es = new EventSource(apiUrl("/api/events"));
      sseRef.current = es;
      es.addEventListener("dataVersion", () => {
        void fetchStats();
      });
      es.addEventListener("error", () => {
        // Browser will auto-retry based on server-sent `retry`.
      });
    } catch {
      // ignore (SSE unsupported / blocked)
    }

    return () => {
      window.clearInterval(intervalId);
      if (statsRefreshDebounceRef.current) {
        window.clearTimeout(statsRefreshDebounceRef.current);
        statsRefreshDebounceRef.current = null;
      }
      if (sseRef.current) {
        try {
          sseRef.current.close();
        } catch {
          // ignore
        }
        sseRef.current = null;
      }
      window.removeEventListener("pst:tasks-changed", onDataChanged);
      window.removeEventListener("pst:projects-changed", onDataChanged);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("focus", onFocus);
    };
  }, [fetchStats]);

  useEffect(() => {
    // Prevent showing stale cross-profile numbers while new scoped data is loading.
    setStats(null);
    void fetchStats();
  }, [activeProfileId, fetchStats]);

  const completedToday = stats?.completedToday ?? 0;
  const streakDays = stats?.streakDays ?? 0;
  const level = stats?.level ?? 1;
  const xpToNext = stats?.xpToNext ?? 50;
  const pointsToday = stats?.pointsToday ?? 0;
  const totalPoints = stats?.totalPoints ?? 0;

  const pointsIntoLevel = totalPoints % 50;
  const xpBarPercent = Math.min(100, (pointsIntoLevel / 50) * 100);
  const last7 = useMemo(() => stats?.last7Days ?? [], [stats?.last7Days]);
  const maxDaily = Math.max(1, ...last7.map((d) => d.completed));
  const achievements = stats?.achievements ?? [];
  const milestones = stats?.milestoneAchievements ?? null;
  const activeProfileNameOnly = activeProfileId
    ? (profileById[activeProfileId]?.name ?? "Selected profile")
    : null;
  const activeProfileLabel = activeProfileId
    ? (() => {
        const p = profileById[activeProfileId];
        if (!p) return "Selected profile";
        return p.title ? `${p.name} - ${p.title}` : p.name;
      })()
    : null;

  useEffect(() => {
    const run = async () => {
      try {
        const res = await apiFetch("/api/profiles");
        if (!res.ok) return;
        const data = (await res.json()) as Array<{ id: string; name: string; title: string }>;
        setProfileById(
          data.reduce<Record<string, { name: string; title: string }>>((acc, p) => {
            acc[p.id] = { name: p.name, title: p.title ?? "" };
            return acc;
          }, {})
        );
      } catch {
        // ignore transient failures
      }
    };
    void run();
  }, []);

  const closeBadgesModal = useCallback(() => {
    void exitBrowserFullscreenAll();
    setBadgesOpen(false);
  }, []);

  useEffect(() => {
    if (!badgesOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      closeBadgesModal();
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [badgesOpen, closeBadgesModal]);

  useEffect(() => {
    window.dispatchEvent(new Event(PST_TRUE_FULLSCREEN_CONTEXT_EVENT));
  }, [badgesOpen]);

  useEffect(() => {
    if (badgesOpen) return;
    void exitBrowserFullscreenAll();
    setExpandedBadgeSections({});
    setHoveredBadge(null);
  }, [badgesOpen]);

  /*
   * Scroll lock only on iOS-like UAs (CSS-only expanded). On desktop, locking `html`/`body` breaks or
   * blocks element fullscreen in Chromium/WebKit; the portaled overlay already covers the viewport.
   */
  useEffect(() => {
    if (!badgesOpen || !prefersCssOnlyElementFullscreen()) return;
    const prevHtml = document.documentElement.style.overflow;
    const prevBody = document.body.style.overflow;
    document.documentElement.style.overflow = "hidden";
    document.body.style.overflow = "hidden";
    return () => {
      document.documentElement.style.overflow = prevHtml;
      document.body.style.overflow = prevBody;
    };
  }, [badgesOpen]);

  useEffect(() => {
    if (!badgesOpen) {
      badgesLayoutToastSentRef.current = false;
      return;
    }
    if (!prefersCssOnlyElementFullscreen() || badgesLayoutToastSentRef.current) return;
    badgesLayoutToastSentRef.current = true;
    toastBadgesFullWindowLayout();
  }, [badgesOpen]);

  const badgeSections = useMemo(() => {
    if (!milestones) return [];
    const sections: {
      key: string;
      title: string;
      icon: "streak" | "tasks" | "xp" | "levels" | "badges";
      current: number;
      unit: string;
      milestones: number[];
      unlockDetails?: MilestoneBlock["unlockDetails"];
      unlockedCount: number;
      percentUnlocked: number;
    }[] = [
      {
        key: "streakDays",
        title: "Day streaks",
        icon: "streak",
        current: milestones.streakDays.current,
        unit: "days",
        milestones: capMilestoneBadges(
          milestones.streakDays.milestones ?? milestones.streakDays.recentUnlocked,
          150
        ),
        unlockDetails: milestones.streakDays.unlockDetails,
        unlockedCount: 0,
        percentUnlocked: 0
      },
      {
        key: "tasksCompleted",
        title: "Tasks completed",
        icon: "tasks",
        current: milestones.tasksCompleted.current,
        unit: "tasks",
        milestones: capMilestoneBadges(
          milestones.tasksCompleted.milestones ?? milestones.tasksCompleted.recentUnlocked,
          150
        ),
        unlockDetails: milestones.tasksCompleted.unlockDetails,
        unlockedCount: 0,
        percentUnlocked: 0
      },
      {
        key: "xpGained",
        title: "Experience gained",
        icon: "xp",
        current: milestones.xpGained.current,
        unit: "XP",
        milestones: capMilestoneBadges(
          milestones.xpGained.milestones ?? milestones.xpGained.recentUnlocked,
          150
        ),
        unlockDetails: milestones.xpGained.unlockDetails,
        unlockedCount: 0,
        percentUnlocked: 0
      },
      {
        key: "levelsUp",
        title: "Levels up",
        icon: "levels",
        current: milestones.levelsUp.current,
        unit: "levels",
        milestones: capMilestoneBadges(
          milestones.levelsUp.milestones ?? milestones.levelsUp.recentUnlocked,
          150
        ),
        unlockDetails: milestones.levelsUp.unlockDetails,
        unlockedCount: 0,
        percentUnlocked: 0
      },
      {
        key: "badgesEarned",
        title: "Badges earned",
        icon: "badges",
        current: milestones.badgesEarned.current,
        unit: "badges",
        milestones: capMilestoneBadges(
          milestones.badgesEarned.milestones ?? milestones.badgesEarned.recentUnlocked,
          150
        ),
        unlockDetails: milestones.badgesEarned.unlockDetails,
        unlockedCount: 0,
        percentUnlocked: 0
      }
    ];
    return sections.map((s) => {
      const unlockedCount = s.milestones.reduce((acc, m) => acc + (s.current >= m ? 1 : 0), 0);
      const percentUnlocked = (100 * unlockedCount) / Math.max(1, s.milestones.length);
      return { ...s, unlockedCount, percentUnlocked };
    });
  }, [milestones]);

  useEffect(() => {
    if (!hoveredBadge) return;
    const onScroll = () => setHoveredBadge(null);
    window.addEventListener("scroll", onScroll, { passive: true, capture: true });
    return () => window.removeEventListener("scroll", onScroll, { capture: true } as any);
  }, [hoveredBadge]);

  useEffect(() => {
    if (!weeklyBarHover) return;
    const onScroll = () => setWeeklyBarHover(null);
    window.addEventListener("scroll", onScroll, { passive: true, capture: true });
    return () => window.removeEventListener("scroll", onScroll, { capture: true } as any);
  }, [weeklyBarHover]);

  useLayoutEffect(() => {
    if (!weeklyBarHover) {
      setWeeklyTooltipPos(null);
      return;
    }
    const el = weeklyTooltipRef.current;
    if (!el) return;

    const place = () => {
      const rect = el.getBoundingClientRect();
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const pad = 12;
      const ox = 10;
      const oy = 10;
      const { mouseX, mouseY } = weeklyBarHover;
      let left = mouseX + ox;
      let top = mouseY + oy;
      if (left + rect.width > vw - pad) {
        left = mouseX - rect.width - ox;
      }
      if (top + rect.height > vh - pad) {
        top = mouseY - rect.height - oy;
      }
      left = Math.max(pad, Math.min(vw - rect.width - pad, left));
      top = Math.max(pad, Math.min(vh - rect.height - pad, top));
      setWeeklyTooltipPos({ left, top });
    };

    const raf = window.requestAnimationFrame(place);
    return () => window.cancelAnimationFrame(raf);
  }, [weeklyBarHover]);

  useLayoutEffect(() => {
    if (!hoveredBadge) {
      setHovercardPos(null);
      return;
    }
    const el = hovercardRef.current;
    if (!el) return;

    const place = () => {
      const rect = el.getBoundingClientRect();
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const pad = 12;
      // Small gap so the pointer sits just outside the tooltip corner (feels “attached” to the cursor).
      const ox = 10;
      const oy = 10;
      const { mouseX, mouseY } = hoveredBadge;

      // Default: top-left of tooltip slightly below/right of the pointer (standard hover follow).
      let left = mouseX + ox;
      let top = mouseY + oy;

      if (left + rect.width > vw - pad) {
        left = mouseX - rect.width - ox;
      }
      if (top + rect.height > vh - pad) {
        top = mouseY - rect.height - oy;
      }

      left = Math.max(pad, Math.min(vw - rect.width - pad, left));
      top = Math.max(pad, Math.min(vh - rect.height - pad, top));

      setHovercardPos({ left, top });
    };

    // Measure after render.
    const raf = window.requestAnimationFrame(place);
    return () => window.cancelAnimationFrame(raf);
  }, [hoveredBadge]);

  const formatHoverDate = (dateIso: string): string =>
    new Date(dateIso + "T12:00:00").toLocaleDateString(undefined, {
      weekday: "short",
      year: "numeric",
      month: "short",
      day: "2-digit"
    });

  const relativeDays = (dateIso: string): string => {
    const d = new Date(dateIso + "T12:00:00").getTime();
    const now = Date.now();
    const days = Math.round((d - now) / 86_400_000);
    const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
    return rtf.format(days, "day");
  };

  const priorityLabel = (p: string | undefined): string | null => {
    if (!p) return null;
    switch (p) {
      case "urgent":
        return "Urgent";
      case "high":
        return "High";
      case "medium":
        return "Medium";
      case "low":
        return "Low";
      default:
        return p;
    }
  };

  const formatWeeklyBarAccessibilityTitle = (d: {
    date: string;
    completed: number;
    points: number;
    taskXpMin?: number | null;
    taskXpMax?: number | null;
    taskXpAvg?: number | null;
    weekdayTaskMin?: number;
    weekdayTaskMax?: number;
    weekdayTaskAvg?: number;
  }): string => {
    const when = new Date(d.date + "T12:00:00").toLocaleDateString(undefined, {
      weekday: "long",
      month: "short",
      day: "numeric",
      year: "numeric"
    });
    const weekdayMin = d.weekdayTaskMin ?? 0;
    const weekdayMax = d.weekdayTaskMax ?? 0;
    const weekdayAvg = d.weekdayTaskAvg ?? 0;
    if (d.completed <= 0) {
      return `${when}. No tasks completed. This weekday (filtered history): min ${weekdayMin}, max ${weekdayMax}, average ${formatStatAvg(weekdayAvg)}.`;
    }
    const min = d.taskXpMin;
    const max = d.taskXpMax;
    const avg = d.taskXpAvg;
    let base = `${when}. ${d.completed} task(s) completed, ${d.points} XP total.`;
    if (min != null && max != null && avg != null) {
      const avgStr = Number.isInteger(avg) ? String(avg) : avg.toFixed(1);
      base += ` Per-task XP (priority): min ${min}, max ${max}, average ${avgStr}.`;
    }
    base += ` This weekday (filtered history): min ${weekdayMin}, max ${weekdayMax}, average ${formatStatAvg(weekdayAvg)}.`;
    return base;
  };

  const formatStatAvg = (n: number): string =>
    Number.isInteger(n) ? String(n) : n.toFixed(1);

  return (
    <section className="gamification-panel">
      <div className="panel-head">
        <div>
          <h2>Progress</h2>
          <div className="muted small">
            {activeProfileId ? `Profile: ${activeProfileLabel}` : "Profile: All profiles"}
          </div>
        </div>
        <div className="progress-toolbar" role="group" aria-label="Progress actions">
          <button
            className="progress-toolbar-btn"
            type="button"
            onClick={() => setAnalysisOpen(true)}
            title="Open historical charts for completions, XP, level, and milestones."
            aria-label="Open productivity analysis"
          >
            <span className="progress-toolbar-glyph" aria-hidden="true">
              <svg viewBox="0 0 24 24" focusable="false">
                <path d="M4 18h16M7 15l3-4 3 2 4-6" />
              </svg>
            </span>
            <span className="progress-toolbar-label">Analysis</span>
          </button>
          <button
            className="progress-toolbar-btn"
            type="button"
            onClick={() => setBadgesOpen(true)}
            title="Browse milestone badge tiers and your unlock progress."
            aria-label="Open badges"
          >
            <span className="progress-toolbar-glyph" aria-hidden="true">
              <svg viewBox="0 0 24 24" focusable="false">
                <path d="M12 3l2.8 5.6 6.2.9-4.5 4.4 1.1 6.1L12 17.1 6.4 20l1.1-6.1L3 9.5l6.2-.9L12 3z" />
              </svg>
            </span>
            <span className="progress-toolbar-label">Badges</span>
          </button>
        </div>
      </div>
      <div className="gamification-card">
        <div className="stat-row">
          <div>
            <div className="stat-label">Completed today</div>
            <div className="stat-value">{completedToday}</div>
          </div>
          <div>
            <div className="stat-label">Streak</div>
            <div className="stat-value">{streakDays}d</div>
          </div>
        </div>

        <div className="xp-section">
          <div className="stat-label">Level {level}</div>
          <div className="xp-bar">
            <div
              className="xp-bar-fill"
              style={{ width: `${xpBarPercent}%` }}
            />
          </div>
          <div className="xp-caption">
            <span>
              {pointsIntoLevel}/50 XP this level ({xpToNext} to level {level + 1})
            </span>
            <span className="muted"> · </span>
            <span>{pointsToday} XP from tasks completed today</span>
          </div>
        </div>

        {last7.length > 0 && (
          <div className="weekly-section">
            <div className="weekly-header">
              <div className="stat-label">Current week</div>
              <div className="muted">{last7.reduce((s, d) => s + d.completed, 0)} completed</div>
            </div>
            <div
              className="weekly-bars"
              aria-label="Weekly completion chart"
              onMouseLeave={() => {
                setWeeklyBarHover(null);
                setWeeklyTooltipPos(null);
              }}
            >
              {last7.map((d) => {
                const height = Math.max(8, Math.round((d.completed / maxDaily) * 42));
                const label = new Date(d.date + "T12:00:00").toLocaleDateString(undefined, {
                  weekday: "short"
                });
                const taskXpMin = d.taskXpMin ?? null;
                const taskXpMax = d.taskXpMax ?? null;
                const taskXpAvg = d.taskXpAvg ?? null;
                const weekdayTaskMin = d.weekdayTaskMin ?? 0;
                const weekdayTaskMax = d.weekdayTaskMax ?? 0;
                const weekdayTaskAvg = d.weekdayTaskAvg ?? 0;
                return (
                  <div
                    key={d.date}
                    className="weekly-bar-col"
                    aria-label={formatWeeklyBarAccessibilityTitle(d)}
                    onMouseEnter={(e) => {
                      setWeeklyTooltipPos(null);
                      setWeeklyBarHover({
                        date: d.date,
                        completed: d.completed,
                        points: d.points,
                        taskXpMin,
                        taskXpMax,
                        taskXpAvg,
                        weekdayTaskMin,
                        weekdayTaskMax,
                        weekdayTaskAvg,
                        mouseX: e.clientX,
                        mouseY: e.clientY
                      });
                    }}
                    onMouseMove={(e) => {
                      setWeeklyBarHover((h) =>
                        h && h.date === d.date
                          ? { ...h, mouseX: e.clientX, mouseY: e.clientY }
                          : h
                      );
                    }}
                  >
                    <div className="weekly-bar" style={{ height }} aria-hidden="true" />
                    <div className="weekly-bar-label">{label}</div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {achievements.length > 0 && (
          <div className="achievements">
            <div className="stat-label">Achievements</div>
            <ul className="achievement-list">
              {achievements.map((a) => {
                const pct = Math.min(100, Math.round((a.progress / a.goal) * 100));
                return (
                  <li key={a.id} className={`achievement ${a.achieved ? "achieved" : ""}`}>
                    <div className="achievement-top">
                      <div>
                        <div className="achievement-name">{a.name}</div>
                        <div className="achievement-desc">{a.description}</div>
                      </div>
                      <div className="achievement-metric">
                        {a.progress}/{a.goal}
                      </div>
                    </div>
                    <div className="achievement-bar">
                      <div className="achievement-bar-fill" style={{ width: `${pct}%` }} />
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        {milestones && (
          <div className="milestones">
            <div className="stat-label">Milestones</div>
            <div className="milestone-grid">
              {(
                [
                  milestones.streakDays,
                  milestones.tasksCompleted,
                  milestones.xpGained,
                  milestones.levelsUp,
                  milestones.badgesEarned
                ] as MilestoneBlock[]
              ).map((m) => {
                const pct = Math.min(100, Math.round((m.progressToNext ?? 0) * 100));
                return (
                  <div key={m.id} className="milestone-card">
                    <div className="milestone-top">
                      <div>
                        <div className="milestone-name">{m.name}</div>
                        <div className="milestone-sub">
                          {m.current.toLocaleString()} {m.unit}
                        </div>
                      </div>
                      <div className="milestone-next">
                        {m.next ? `Next: ${m.next.toLocaleString()}` : "Maxed"}
                      </div>
                    </div>
                    <div className="milestone-bar" aria-label={`${m.name} progress`}>
                      <div className="milestone-bar-fill" style={{ width: `${pct}%` }} />
                    </div>
                    <div className="milestone-foot">
                      <div className="milestone-pct">{pct}%</div>
                      <div className="milestone-unlocked">
                        <span className="milestone-unlocked-summary" aria-label="Unlocked milestones">
                          Unlocked: {m.achievedCount ?? m.recentUnlocked.length}
                        </span>
                        <span className="milestone-unlocked-hint">Hover to view</span>
                        <div className="milestone-popover" role="tooltip" aria-label="Unlocked milestones list">
                          <div className="milestone-popover-title">Unlocked</div>
                          <div className="milestone-popover-chips">
                            {m.recentUnlocked.slice().reverse().map((v) => (
                              <span key={v} className="milestone-chip">
                                {v}
                              </span>
                            ))}
                          </div>
                          <div className="milestone-popover-note">
                            Showing recent milestones. Next target shown on the card.
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {badgesOpen
        ? createPortal(
            <div
              data-badges-fullscreen-root=""
              className="pa-fs-overlay pa-pro-shell badge-fs-pa-layer"
              role="dialog"
              aria-modal="true"
              aria-label="Badges"
              onClick={(e) => {
                if (e.target !== e.currentTarget) return;
                closeBadgesModal();
              }}
            >
              <div className="pa-fs-chrome" onClick={(e) => e.stopPropagation()}>
                <BadgesModalDialogBody
                  panelRef={badgePanelRef}
                  closeBadgesModal={closeBadgesModal}
                  activeProfileName={activeProfileNameOnly ?? "All profiles"}
                  activeProfileHeader={activeProfileLabel ?? "All profiles"}
                  badgeSections={badgeSections}
                  expandedBadgeSections={expandedBadgeSections}
                  setExpandedBadgeSections={setExpandedBadgeSections}
                  hoveredBadge={hoveredBadge}
                  setHoveredBadge={setHoveredBadge}
                  hovercardRef={hovercardRef}
                  hovercardPos={hovercardPos}
                  formatHoverDate={formatHoverDate}
                  relativeDays={relativeDays}
                  priorityLabel={priorityLabel}
                />
              </div>
            </div>,
            document.body
          )
        : null}

      <ProductivityAnalysisModal
        open={analysisOpen}
        onClose={() => setAnalysisOpen(false)}
        activeProfileId={activeProfileId}
        activeProfileName={activeProfileLabel}
      />

      {weeklyBarHover
        ? createPortal(
            <div
              ref={weeklyTooltipRef}
              className="weekly-bar-tooltip"
              style={{
                position: "fixed",
                left: weeklyTooltipPos?.left ?? weeklyBarHover.mouseX + 10,
                top: weeklyTooltipPos?.top ?? weeklyBarHover.mouseY + 10,
                zIndex: 10050,
                pointerEvents: "none"
              }}
              role="tooltip"
            >
              <div className="weekly-bar-tooltip-title">
                {new Date(weeklyBarHover.date + "T12:00:00").toLocaleDateString(undefined, {
                  weekday: "long",
                  month: "short",
                  day: "numeric",
                  year: "numeric"
                })}
              </div>
              {weeklyBarHover.completed <= 0 ? (
                <div className="weekly-bar-tooltip-empty">No tasks completed this day.</div>
              ) : (
                <>
                  <div className="weekly-bar-tooltip-line">
                    <span className="weekly-bar-tooltip-k">Tasks completed</span>
                    <span className="weekly-bar-tooltip-v">{weeklyBarHover.completed}</span>
                  </div>
                  <div className="weekly-bar-tooltip-line">
                    <span className="weekly-bar-tooltip-k">Total XP</span>
                    <span className="weekly-bar-tooltip-v">{weeklyBarHover.points}</span>
                  </div>
                  {weeklyBarHover.taskXpMin != null &&
                  weeklyBarHover.taskXpMax != null &&
                  weeklyBarHover.taskXpAvg != null ? (
                    <div className="weekly-bar-tooltip-xp">
                      <div className="weekly-bar-tooltip-xp-label">Per-task XP (priority)</div>
                      <div className="weekly-bar-tooltip-xp-row">
                        <span>Min {weeklyBarHover.taskXpMin}</span>
                        <span>Max {weeklyBarHover.taskXpMax}</span>
                        <span>Avg {formatStatAvg(weeklyBarHover.taskXpAvg)}</span>
                      </div>
                    </div>
                  ) : null}
                  <div className="weekly-bar-tooltip-xp">
                    <div className="weekly-bar-tooltip-xp-label">
                      This weekday (filtered history)
                    </div>
                    <div className="weekly-bar-tooltip-xp-row">
                      <span>Min {weeklyBarHover.weekdayTaskMin}</span>
                      <span>Max {weeklyBarHover.weekdayTaskMax}</span>
                      <span>Avg {formatStatAvg(weeklyBarHover.weekdayTaskAvg)}</span>
                    </div>
                    <div className="weekly-bar-tooltip-footnote">
                      Computed from this weekday across the filtered timeline, including zero days.
                    </div>
                  </div>
                </>
              )}
            </div>,
            document.body
          )
        : null}
    </section>
  );
}

