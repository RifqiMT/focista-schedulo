import { useEffect, useMemo, useRef, useState } from "react";
import { ProductivityAnalysisModal } from "./ProductivityAnalysisModal";

interface Stats {
  completedToday: number;
  streakDays: number;
  level: number;
  xpToNext: number;
  pointsToday: number;
  totalPoints: number;
  last7Days?: { date: string; completed: number; points: number }[];
  pointsByPriority?: { low: number; medium: number; high: number; urgent: number };
  achievements?: {
    id: string;
    name: string;
    description: string;
    progress: number;
    goal: number;
    achieved: boolean;
  }[];
  milestoneAchievements?: {
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
}

function Icon({
  name
}: {
  name: "streak" | "tasks" | "xp" | "levels" | "lock";
}) {
  const common = {
    width: 18,
    height: 18,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.9,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const
  };
  switch (name) {
    case "streak":
      return (
        <svg {...common} aria-hidden="true">
          {/* Modern flame (lucide-like) */}
          <path d="M8.5 14.5c0-1.8 1-3.2 2.2-4.4 1.2-1.2 1.8-2.6 1.8-4.1 2.2 1.4 4 3.8 4 7.2 0 3.6-2.6 6.3-6 6.3s-6-2.6-6-5.5Z" />
          <path d="M12 20c1.7 0 3-1.2 3-2.9 0-1.1-.6-1.9-1.2-2.6-.6-.6-.9-1.4-.9-2.2-1.4.9-2.5 2.3-2.5 4.1 0 2 1.1 3.6 1.6 3.6Z" />
        </svg>
      );
    case "tasks":
      return (
        <svg {...common} aria-hidden="true">
          {/* Clipboard check (cleaner) */}
          <path d="M9 3h6" />
          <path d="M9 3a2 2 0 0 0-2 2v0" />
          <path d="M15 3a2 2 0 0 1 2 2v0" />
          <path d="M8 7h10a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2Z" />
          <path d="M9 12l2 2 4-4" />
          <path d="M9 16h6" />
        </svg>
      );
    case "xp":
      return (
        <svg {...common} aria-hidden="true">
          {/* Bolt (sharp + modern) */}
          <path d="M13 2 3 14h7l-1 8 12-14h-7l-1-6Z" />
        </svg>
      );
    case "levels":
      return (
        <svg {...common} aria-hidden="true">
          {/* Trophy (modern) */}
          <path d="M8 4h8v3a4 4 0 0 1-8 0V4Z" />
          <path d="M6 5H4v2a4 4 0 0 0 4 4" />
          <path d="M18 5h2v2a4 4 0 0 1-4 4" />
          <path d="M12 11v4" />
          <path d="M9 21h6" />
          <path d="M10 15h4l1 2H9l1-2Z" />
        </svg>
      );
    case "lock":
      return (
        <svg {...common} aria-hidden="true">
          {/* Lock */}
          <path d="M8 11V8a4 4 0 0 1 8 0v3" />
          <path d="M7 11h10v10H7V11Z" />
          <path d="M12 16v2" />
        </svg>
      );
  }
}

export function GamificationPanel() {
  const [stats, setStats] = useState<Stats | null>(null);
  const latestFetchIdRef = useRef(0);
  const refreshInFlightRef = useRef(false);
  const refreshQueuedRef = useRef(false);
  const [badgesOpen, setBadgesOpen] = useState(false);
  const [analysisOpen, setAnalysisOpen] = useState(false);
  const [hoveredBadge, setHoveredBadge] = useState<{
    title: string;
    subtitle: string;
    status: "Unlocked" | "Locked";
    progressLine: string;
    x: number;
    y: number;
  } | null>(null);
  const [expandedBadgeSections, setExpandedBadgeSections] = useState<Record<string, boolean>>({});

  useEffect(() => {
    const fetchStats = async () => {
      if (refreshInFlightRef.current) {
        refreshQueuedRef.current = true;
        return;
      }
      refreshInFlightRef.current = true;
      const fetchId = ++latestFetchIdRef.current;
      try {
        const res = await fetch("/api/stats");
        if (!res.ok) return;
        const data: Stats = await res.json();
        // Ignore late responses from older requests.
        if (fetchId !== latestFetchIdRef.current) return;
        setStats(data);
      } catch {
        // ignore transient network errors
      } finally {
        refreshInFlightRef.current = false;
        if (refreshQueuedRef.current) {
          refreshQueuedRef.current = false;
          void fetchStats();
        }
      }
    };

    // Initial load
    void fetchStats();

    const onDataChanged = () => {
      // Queue-safe immediate refresh after any task/project mutation.
      void fetchStats();
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

    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener("pst:tasks-changed", onDataChanged);
      window.removeEventListener("pst:projects-changed", onDataChanged);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("focus", onFocus);
    };
  }, []);

  const completedToday = stats?.completedToday ?? 0;
  const streakDays = stats?.streakDays ?? 0;
  const level = stats?.level ?? 1;
  const xpToNext = stats?.xpToNext ?? 50;
  const pointsToday = stats?.pointsToday ?? 0;
  const totalPoints = stats?.totalPoints ?? 0;

  const pointsIntoLevel = totalPoints % 50;
  const xpBarPercent = Math.min(100, (pointsIntoLevel / 50) * 100);
  const last7 = stats?.last7Days ?? [];
  const maxDaily = Math.max(1, ...last7.map((d) => d.completed));
  const achievements = stats?.achievements ?? [];
  const milestones = stats?.milestoneAchievements ?? null;

  useEffect(() => {
    if (!badgesOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setBadgesOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [badgesOpen]);

  useEffect(() => {
    if (badgesOpen) return;
    // Always reset to defaults when closing.
    setExpandedBadgeSections({});
    setHoveredBadge(null);
  }, [badgesOpen]);

  const badgeSections = useMemo(() => {
    if (!milestones) return [];
    const sections: {
      key: string;
      title: string;
      icon: "streak" | "tasks" | "xp" | "levels";
      current: number;
      unit: string;
      milestones: number[];
      unlockedCount: number;
      percentUnlocked: number;
    }[] = [
      {
        key: "streakDays",
        title: "Day streaks",
        icon: "streak",
        current: milestones.streakDays.current,
        unit: "days",
        milestones: milestones.streakDays.milestones ?? milestones.streakDays.recentUnlocked,
        unlockedCount: milestones.streakDays.achieved?.length ?? milestones.streakDays.recentUnlocked.length,
        percentUnlocked:
          (100 *
            (milestones.streakDays.achieved?.length ?? milestones.streakDays.recentUnlocked.length)) /
          Math.max(1, (milestones.streakDays.milestones ?? milestones.streakDays.recentUnlocked).length)
      },
      {
        key: "tasksCompleted",
        title: "Tasks completed",
        icon: "tasks",
        current: milestones.tasksCompleted.current,
        unit: "tasks",
        milestones: milestones.tasksCompleted.milestones ?? milestones.tasksCompleted.recentUnlocked,
        unlockedCount:
          milestones.tasksCompleted.achieved?.length ?? milestones.tasksCompleted.recentUnlocked.length,
        percentUnlocked:
          (100 *
            (milestones.tasksCompleted.achieved?.length ??
              milestones.tasksCompleted.recentUnlocked.length)) /
          Math.max(1, (milestones.tasksCompleted.milestones ?? milestones.tasksCompleted.recentUnlocked).length)
      },
      {
        key: "xpGained",
        title: "Experience gained",
        icon: "xp",
        current: milestones.xpGained.current,
        unit: "XP",
        milestones: milestones.xpGained.milestones ?? milestones.xpGained.recentUnlocked,
        unlockedCount: milestones.xpGained.achieved?.length ?? milestones.xpGained.recentUnlocked.length,
        percentUnlocked:
          (100 *
            (milestones.xpGained.achieved?.length ?? milestones.xpGained.recentUnlocked.length)) /
          Math.max(1, (milestones.xpGained.milestones ?? milestones.xpGained.recentUnlocked).length)
      },
      {
        key: "levelsUp",
        title: "Levels up",
        icon: "levels",
        current: milestones.levelsUp.current,
        unit: "levels",
        milestones: milestones.levelsUp.milestones ?? milestones.levelsUp.recentUnlocked,
        unlockedCount: milestones.levelsUp.achieved?.length ?? milestones.levelsUp.recentUnlocked.length,
        percentUnlocked:
          (100 *
            (milestones.levelsUp.achieved?.length ?? milestones.levelsUp.recentUnlocked.length)) /
          Math.max(1, (milestones.levelsUp.milestones ?? milestones.levelsUp.recentUnlocked).length)
      }
    ];
    return sections;
  }, [milestones]);

  useEffect(() => {
    if (!hoveredBadge) return;
    const onScroll = () => setHoveredBadge(null);
    window.addEventListener("scroll", onScroll, { passive: true, capture: true });
    return () => window.removeEventListener("scroll", onScroll, { capture: true } as any);
  }, [hoveredBadge]);

  return (
    <section className="gamification-panel">
      <div className="panel-head">
        <h2>Progress</h2>
        <div className="panel-head-actions">
          <button
            className="ghost-button small"
            type="button"
            onClick={() => setAnalysisOpen(true)}
          >
            Productivity analysis
          </button>
          <button
            className="ghost-button small"
            type="button"
            onClick={() => setBadgesOpen(true)}
          >
            Badges
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
              <div className="stat-label">Last 7 days</div>
              <div className="muted">{last7.reduce((s, d) => s + d.completed, 0)} completed</div>
            </div>
            <div className="weekly-bars" aria-label="Weekly completion chart">
              {last7.map((d) => {
                const height = Math.max(8, Math.round((d.completed / maxDaily) * 42));
                const label = new Date(d.date + "T12:00:00").toLocaleDateString(undefined, {
                  weekday: "short"
                });
                return (
                  <div key={d.date} className="weekly-bar-col">
                    <div className="weekly-bar" style={{ height }} title={`${d.date}: ${d.completed} completed`} />
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
                  milestones.levelsUp
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

      {badgesOpen && (
        <div
          className="badge-modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-label="Badges"
          onClick={(e) => {
            if (e.target === e.currentTarget) setBadgesOpen(false);
          }}
        >
          <div className="badge-modal">
            <div className="badge-modal-head">
              <div>
                <div className="badge-modal-title">Badges</div>
                <div className="badge-modal-sub">
                  Unlock badges by hitting milestone targets across streaks, tasks, XP, and levels.
                </div>
              </div>
              <button className="ghost-button small" onClick={() => setBadgesOpen(false)}>
                Close
              </button>
            </div>

            {badgeSections.map((s) => (
              <div key={s.key} className={`badge-section badge-section-${s.key}`}>
                <div className="badge-section-head">
                  <div className="badge-section-title">
                    <span className="badge-section-icon" aria-hidden="true">
                      <Icon name={s.icon} />
                    </span>
                    {s.title}
                  </div>
                  <div className="badge-section-actions">
                    <div className="badge-section-meta">
                      <span>
                        Current: {s.current.toLocaleString()} {s.unit}
                      </span>
                      <span>
                        · Badges: {s.unlockedCount}/{s.milestones.length} (
                        {Math.round(s.percentUnlocked)}%)
                      </span>
                    </div>
                    <button
                      className="ghost-button small"
                      onClick={() =>
                        setExpandedBadgeSections((prev) => ({
                          ...prev,
                          [s.key]: !prev[s.key]
                        }))
                      }
                    >
                      {expandedBadgeSections[s.key] ? "Show less" : "Show more"}
                    </button>
                  </div>
                </div>

                <div className="badge-grid">
                  {s.milestones
                    .slice(0, expandedBadgeSections[s.key] ? 150 : 10)
                    .map((m) => {
                    const unlocked = s.current >= m;
                    const label =
                      s.key === "levelsUp"
                        ? `Level ${m}`
                        : `${m.toLocaleString()} ${s.unit}`;
                    const title = unlocked ? "Unlocked" : "Locked";
                    const idx = s.milestones.indexOf(m);
                    const tier =
                      idx < 1 ? 1 : idx < 3 ? 2 : idx < 6 ? 3 : idx < 10 ? 4 : 5;
                    const stars = "★".repeat(tier);
                    const remaining = Math.max(0, m - s.current);
                    const progressLine = unlocked
                      ? `You’ve reached ${label}.`
                      : `Current: ${s.current.toLocaleString()} • Need: +${remaining.toLocaleString()}`;
                    return (
                      <div
                        key={`${s.key}-${m}`}
                        className={`badge-card badge-cat-${s.key} ${unlocked ? "unlocked" : "locked"} tier-${tier}`}
                        title={`${title} • ${label}`}
                        onMouseEnter={(ev) => {
                          const vw = window.innerWidth;
                          const vh = window.innerHeight;
                          const cardW = 320;
                          const cardH = 120;
                          const pad = 12;
                          const x = Math.max(pad, Math.min(vw - cardW - pad, ev.clientX + 14));
                          const y = Math.max(pad, Math.min(vh - cardH - pad, ev.clientY + 14));
                          setHoveredBadge({
                            title: label,
                            subtitle: s.title,
                            status: unlocked ? "Unlocked" : "Locked",
                            progressLine,
                            x,
                            y
                          });
                        }}
                        onMouseMove={(ev) => {
                          if (!hoveredBadge) return;
                          const vw = window.innerWidth;
                          const vh = window.innerHeight;
                          const cardW = 320;
                          const cardH = 120;
                          const pad = 12;
                          const x = Math.max(pad, Math.min(vw - cardW - pad, ev.clientX + 14));
                          const y = Math.max(pad, Math.min(vh - cardH - pad, ev.clientY + 14));
                          setHoveredBadge((prev) => (prev ? { ...prev, x, y } : prev));
                        }}
                        onMouseLeave={() => setHoveredBadge(null)}
                      >
                        <div className="badge-medal" aria-hidden="true">
                          <div className="badge-topper" />
                          <div className="badge-ribbon badge-ribbon-left" />
                          <div className="badge-ribbon badge-ribbon-right" />
                          <div className="badge-medal-inner">
                            {unlocked ? <Icon name={s.icon} /> : <Icon name="lock" />}
                          </div>
                        </div>
                        <div className="badge-content">
                          <div className="badge-label">{label}</div>
                          <div className="badge-stars" aria-hidden="true">
                            {stars}
                          </div>
                          <div className="badge-state">{unlocked ? "Unlocked" : "Locked"}</div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>

          {hoveredBadge && (
            <div
              className="badge-hovercard"
              style={{ left: hoveredBadge.x, top: hoveredBadge.y }}
              role="tooltip"
            >
              <div className="badge-hovercard-top">
                <div className="badge-hovercard-title">{hoveredBadge.title}</div>
                <div className={`badge-hovercard-pill ${hoveredBadge.status === "Unlocked" ? "ok" : "muted"}`}>
                  {hoveredBadge.status}
                </div>
              </div>
              <div className="badge-hovercard-sub">{hoveredBadge.subtitle}</div>
              <div className="badge-hovercard-body">{hoveredBadge.progressLine}</div>
            </div>
          )}
        </div>
      )}

      <ProductivityAnalysisModal open={analysisOpen} onClose={() => setAnalysisOpen(false)} />
    </section>
  );
}

