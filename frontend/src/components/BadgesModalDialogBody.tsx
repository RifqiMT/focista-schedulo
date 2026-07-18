import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type RefObject,
  type SetStateAction
} from "react";
import { exportBadgeCardPng } from "./badgePngExport";

interface BadgesModalSection {
  key: string;
  title: string;
  icon: "streak" | "tasks" | "xp" | "levels" | "badges";
  current: number;
  unit: string;
  milestones: number[];
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
  unlockedCount: number;
  percentUnlocked: number;
}

type HoveredBadgeState = {
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
};

type CategoryFilter = "all" | string;
type StatusFilter = "all" | "unlocked" | "locked";

function Icon({
  name
}: {
  name: "streak" | "tasks" | "xp" | "levels" | "badges" | "lock";
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
          <path d="M8.5 14.5c0-1.8 1-3.2 2.2-4.4 1.2-1.2 1.8-2.6 1.8-4.1 2.2 1.4 4 3.8 4 7.2 0 3.6-2.6 6.3-6 6.3s-6-2.6-6-5.5Z" />
          <path d="M12 20c1.7 0 3-1.2 3-2.9 0-1.1-.6-1.9-1.2-2.6-.6-.6-.9-1.4-.9-2.2-1.4.9-2.5 2.3-2.5 4.1 0 2 1.1 3.6 1.6 3.6Z" />
        </svg>
      );
    case "tasks":
      return (
        <svg {...common} aria-hidden="true">
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
          <path d="M13 2 3 14h7l-1 8 12-14h-7l-1-6Z" />
        </svg>
      );
    case "levels":
      return (
        <svg {...common} aria-hidden="true">
          <path d="M8 4h8v3a4 4 0 0 1-8 0V4Z" />
          <path d="M6 5H4v2a4 4 0 0 0 4 4" />
          <path d="M18 5h2v2a4 4 0 0 1-4 4" />
          <path d="M12 11v4" />
          <path d="M9 21h6" />
          <path d="M10 15h4l1 2H9l1-2Z" />
        </svg>
      );
    case "badges":
      return (
        <svg {...common} aria-hidden="true">
          <path d="M12 3l3 2 3 1-1 3 1 3-3 1-3 2-3-2-3-1 1-3-1-3 3-1 3-2Z" />
          <path d="M9.5 14.5 8 21l4-2 4 2-1.5-6.5" />
          <path d="M9.5 9.5l1.5 1.5 3.5-3.5" />
        </svg>
      );
    case "lock":
      return (
        <svg {...common} aria-hidden="true">
          <path d="M8 11V8a4 4 0 0 1 8 0v3" />
          <path d="M7 11h10v10H7V11Z" />
          <path d="M12 16v2" />
        </svg>
      );
  }
}

function DownloadIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <path d="M7 10l5 5 5-5" />
      <path d="M12 15V3" />
    </svg>
  );
}

function formatNextLabel(section: BadgesModalSection, milestone: number): string {
  return section.key === "levelsUp"
    ? `Level ${milestone}`
    : `${milestone.toLocaleString()} ${section.unit}`;
}

type BadgesModalDialogBodyProps = {
  panelRef: RefObject<HTMLDivElement | null>;
  closeBadgesModal: () => void;
  activeProfileName: string;
  activeProfileHeader: string;
  badgeSections: BadgesModalSection[];
  expandedBadgeSections: Record<string, boolean>;
  setExpandedBadgeSections: Dispatch<SetStateAction<Record<string, boolean>>>;
  hoveredBadge: HoveredBadgeState | null;
  setHoveredBadge: Dispatch<SetStateAction<HoveredBadgeState | null>>;
  hovercardRef: RefObject<HTMLDivElement | null>;
  hovercardPos: { left: number; top: number } | null;
  formatHoverDate: (dateIso: string) => string;
  relativeDays: (dateIso: string) => string;
  priorityLabel: (p: string | undefined) => string | null;
};

export function BadgesModalDialogBody({
  panelRef,
  closeBadgesModal,
  activeProfileName,
  activeProfileHeader,
  badgeSections,
  expandedBadgeSections,
  setExpandedBadgeSections,
  hoveredBadge,
  setHoveredBadge,
  hovercardRef,
  hovercardPos,
  formatHoverDate,
  relativeDays,
  priorityLabel
}: BadgesModalDialogBodyProps) {
  const [category, setCategory] = useState<CategoryFilter>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const catNavRef = useRef<HTMLNavElement | null>(null);

  const totalUnlocked = badgeSections.reduce((acc, s) => acc + s.unlockedCount, 0);
  const totalBadges = badgeSections.reduce((acc, s) => acc + s.milestones.length, 0);
  const overallPct = totalBadges > 0 ? Math.round((100 * totalUnlocked) / totalBadges) : 0;
  const filtersActive = category !== "all" || statusFilter !== "all";

  const visibleSections = useMemo(() => {
    if (category === "all") return badgeSections;
    return badgeSections.filter((s) => s.key === category);
  }, [badgeSections, category]);

  useEffect(() => {
    const root = catNavRef.current;
    if (!root) return;
    const active = root.querySelector<HTMLElement>(".badge-cat-tab.is-on");
    active?.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
  }, [category]);

  const clearFilters = () => {
    setCategory("all");
    setStatusFilter("all");
  };

  return (
    <div className="badges-dialog-root">
      <div
        ref={panelRef}
        data-badges-panel=""
        className="badge-modal pa-pro-shell badge-modal--viewport-expanded badge-modal--pro"
      >
        <div className="badge-modal-chrome">
          <header className="badge-modal-head badge-modal-head--pro">
            <div
              className="badge-modal-head-line"
              title="Unlock badges by hitting milestone targets across streaks, tasks, XP, and levels."
            >
              <h2 className="badge-modal-title">Badges</h2>
              <span className="badge-modal-head-sep" aria-hidden="true">
                ·
              </span>
              <span className="badge-modal-profile">{activeProfileHeader}</span>
              <span className="badge-modal-head-sep badge-modal-head-sep--meta" aria-hidden="true">
                ·
              </span>
              <span className="badge-modal-totals" aria-label="Overall unlock progress">
                {totalUnlocked}/{totalBadges}
                <span className="badge-modal-totals-pct"> · {overallPct}%</span>
              </span>
              <div
                className="badge-modal-progress"
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={overallPct}
                aria-label="Collection progress"
              >
                <span className="badge-modal-progress-fill" style={{ width: `${overallPct}%` }} />
              </div>
            </div>

            <div className="badge-modal-head-actions">
              <div className="badge-status-track" role="group" aria-label="Status filter">
                {(
                  [
                    { id: "all", label: "All" },
                    { id: "unlocked", label: "Unlocked" },
                    { id: "locked", label: "Locked" }
                  ] as const
                ).map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    className={`badge-status-chip${statusFilter === opt.id ? " is-on" : ""}`}
                    aria-pressed={statusFilter === opt.id}
                    onClick={() => setStatusFilter(opt.id)}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
              {filtersActive ? (
                <button
                  type="button"
                  className="badge-filter-reset"
                  onClick={clearFilters}
                  title="Clear filters"
                >
                  Reset
                </button>
              ) : null}
              <button
                type="button"
                className="pa-close-round"
                onClick={closeBadgesModal}
                aria-label="Close badges"
                title="Close"
              >
                <span aria-hidden="true">×</span>
              </button>
            </div>
          </header>

          <nav className="badge-cat-nav" aria-label="Badge categories" ref={catNavRef}>
            <div className="badge-cat-track">
              <button
                type="button"
                className={`badge-cat-tab${category === "all" ? " is-on" : ""}`}
                aria-pressed={category === "all"}
                onClick={() => setCategory("all")}
              >
                <span className="badge-cat-tab-label">All</span>
                <span className="badge-cat-tab-count">{totalBadges}</span>
              </button>
              {badgeSections.map((s) => (
                <button
                  key={s.key}
                  type="button"
                  className={`badge-cat-tab badge-cat-tab--${s.key}${category === s.key ? " is-on" : ""}`}
                  aria-pressed={category === s.key}
                  onClick={() => setCategory(s.key)}
                  title={`${s.title}: ${s.unlockedCount}/${s.milestones.length} unlocked`}
                >
                  <span className="badge-cat-tab-icon" aria-hidden="true">
                    <Icon name={s.icon} />
                  </span>
                  <span className="badge-cat-tab-label">{s.title}</span>
                  <span className="badge-cat-tab-count">
                    {s.unlockedCount}/{s.milestones.length}
                  </span>
                </button>
              ))}
            </div>
          </nav>
        </div>

        <div className="badge-modal-body badge-modal-body--pro">
          {visibleSections.map((s, sectionIdx) => {
            const milestones = s.milestones.filter((m) => {
              const unlocked = s.current >= m;
              if (statusFilter === "unlocked") return unlocked;
              if (statusFilter === "locked") return !unlocked;
              return true;
            });
            const expanded = Boolean(expandedBadgeSections[s.key]) || category !== "all";
            const shown = milestones.slice(0, expanded ? 150 : 12);
            const hiddenCount = Math.max(0, milestones.length - shown.length);
            const nextMilestone = s.milestones.find((m) => s.current < m);
            const nextNeed = nextMilestone != null ? Math.max(0, nextMilestone - s.current) : 0;
            const focused = category !== "all";

            return (
              <section
                key={s.key}
                className={`badge-section badge-section--pro badge-section-${s.key}${
                  focused ? " badge-section--focus" : ""
                }`}
                style={{ animationDelay: `${Math.min(sectionIdx, 4) * 40}ms` }}
              >
                <div className="badge-section-head badge-section-head--pro">
                  <div className="badge-section-title">
                    <span className="badge-section-icon" aria-hidden="true">
                      <Icon name={s.icon} />
                    </span>
                    <span className="badge-section-name">{s.title}</span>
                    <span className="badge-section-meter" aria-hidden="true">
                      <span
                        className="badge-section-meter-fill"
                        style={{ width: `${Math.round(s.percentUnlocked)}%` }}
                      />
                    </span>
                  </div>
                  <div className="badge-section-meta" aria-label={`${s.title} progress`}>
                    <span className="badge-section-stat">
                      <span className="badge-section-stat-k">Current</span>
                      <span className="badge-section-stat-v">
                        {s.current.toLocaleString()}
                        <span className="badge-section-stat-unit"> {s.unit}</span>
                      </span>
                    </span>
                    <span className="badge-section-stat">
                      <span className="badge-section-stat-k">Unlocked</span>
                      <span className="badge-section-stat-v">
                        {s.unlockedCount}/{s.milestones.length}
                        <span className="badge-section-stat-unit">
                          {" "}
                          ({Math.round(s.percentUnlocked)}%)
                        </span>
                      </span>
                    </span>
                    {nextMilestone != null ? (
                      <span className="badge-section-stat badge-section-stat--next">
                        <span className="badge-section-stat-k">Next</span>
                        <span className="badge-section-stat-v">
                          {formatNextLabel(s, nextMilestone)}
                          <span className="badge-section-stat-unit">
                            {" "}
                            (+{nextNeed.toLocaleString()})
                          </span>
                        </span>
                      </span>
                    ) : (
                      <span className="badge-section-stat badge-section-stat--done">
                        <span className="badge-section-stat-v">Complete</span>
                      </span>
                    )}
                  </div>
                  {category === "all" && milestones.length > 12 ? (
                    <button
                      type="button"
                      className="badge-section-toggle"
                      onClick={() =>
                        setExpandedBadgeSections((prev) => ({
                          ...prev,
                          [s.key]: !prev[s.key]
                        }))
                      }
                    >
                      {expanded ? "Less" : `More${hiddenCount > 0 ? ` +${hiddenCount}` : ""}`}
                    </button>
                  ) : null}
                </div>

                {shown.length === 0 ? (
                  <div className="badge-empty">
                    <p className="badge-empty-title">No badges match</p>
                    <p className="badge-empty-copy">Try another category or status filter.</p>
                    {filtersActive ? (
                      <button type="button" className="badge-empty-reset" onClick={clearFilters}>
                        Clear filters
                      </button>
                    ) : null}
                  </div>
                ) : (
                  <div className="badge-grid">
                    {shown.map((m, cardIdx) => {
                      const unlocked = s.current >= m;
                      const label = formatNextLabel(s, m);
                      const idx = s.milestones.indexOf(m);
                      const tier = idx < 1 ? 1 : idx < 3 ? 2 : idx < 6 ? 3 : idx < 10 ? 4 : 5;
                      const badgeNumber = Math.max(1, idx + 1);
                      const remaining = Math.max(0, m - s.current);
                      const prevMilestone = idx > 0 ? s.milestones[idx - 1]! : 0;
                      const pctWithinTier = unlocked
                        ? 1
                        : Math.max(
                            0,
                            Math.min(1, (s.current - prevMilestone) / Math.max(1, m - prevMilestone))
                          );
                      const isNext = nextMilestone === m;
                      const progressLine = unlocked
                        ? `You’ve reached ${label}.`
                        : isNext
                          ? `Next up · need +${remaining.toLocaleString()} ${s.unit}`
                          : `Need +${remaining.toLocaleString()} ${s.unit}`;
                      const unlockMeta = unlocked ? s.unlockDetails?.[String(m)] : undefined;
                      const whenLine =
                        unlocked && unlockMeta?.dateIso
                          ? `${formatHoverDate(unlockMeta.dateIso)} · ${relativeDays(
                              unlockMeta.dateIso
                            )}`
                          : undefined;
                      const prio = priorityLabel(unlockMeta?.task?.priority);
                      const taskLine =
                        unlocked && unlockMeta?.task?.title ? unlockMeta.task.title : undefined;
                      const chips = (() => {
                        const out: { label: string; value: string }[] = [];
                        if (unlocked && unlockMeta?.source) {
                          out.push({ label: "By", value: unlockMeta.source });
                        }
                        if (unlocked && unlockMeta?.task?.projectName) {
                          out.push({ label: "Project", value: unlockMeta.task.projectName });
                        }
                        if (unlocked && prio) out.push({ label: "Priority", value: prio });
                        return out.length ? out : undefined;
                      })();
                      const metaLines = !unlocked
                        ? [
                            `${s.current.toLocaleString()} → ${m.toLocaleString()} ${s.unit}`,
                            `${Math.round(pctWithinTier * 100)}% of this tier`
                          ]
                        : undefined;

                      return (
                        <div
                          key={`${s.key}-${m}`}
                          className={`badge-card badge-cat-${s.key} ${unlocked ? "unlocked" : "locked"}${
                            isNext ? " is-next" : ""
                          } tier-${tier}`}
                          style={{ animationDelay: `${Math.min(cardIdx, 11) * 18}ms` }}
                          onMouseEnter={(ev) => {
                            setHoveredBadge({
                              title: label,
                              subtitle: s.title,
                              status: unlocked ? "Unlocked" : "Locked",
                              progressLine,
                              whenLine,
                              taskLine,
                              metaLines,
                              progressPct: unlocked ? undefined : pctWithinTier,
                              chips,
                              mouseX: ev.clientX,
                              mouseY: ev.clientY
                            });
                          }}
                          onMouseMove={(ev) => {
                            if (!hoveredBadge) return;
                            setHoveredBadge((prev) =>
                              prev ? { ...prev, mouseX: ev.clientX, mouseY: ev.clientY } : prev
                            );
                          }}
                          onMouseLeave={() => setHoveredBadge(null)}
                        >
                          {isNext && !unlocked ? (
                            <span className="badge-next-flag">Next</span>
                          ) : null}
                          {unlocked && (
                            <button
                              type="button"
                              className="badge-export-btn"
                              title="Export badge as PNG"
                              aria-label="Export badge as PNG"
                              onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                const card = (e.currentTarget as HTMLElement).closest(
                                  ".badge-card"
                                ) as HTMLElement | null;
                                if (!card) return;
                                void exportBadgeCardPng({
                                  node: card,
                                  filenameBase: `${s.title}_${label}_star_${badgeNumber}`,
                                  profileName: activeProfileName,
                                  sizePx: 1600
                                });
                              }}
                            >
                              <DownloadIcon />
                            </button>
                          )}
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
                            <div className="badge-profile-name">{activeProfileName}</div>
                            <div className="badge-card-foot">
                              <div className="badge-stars" aria-label={`Badge ${badgeNumber}`}>
                                <span className="badge-stars-icon" aria-hidden="true">
                                  ★
                                </span>
                                <span className="badge-stars-num">{badgeNumber}</span>
                              </div>
                              <div
                                className={`badge-state${unlocked ? " is-ok" : ""}${
                                  isNext && !unlocked ? " is-next" : ""
                                }`}
                              >
                                {unlocked ? "Unlocked" : isNext ? "Next" : "Locked"}
                              </div>
                            </div>
                            {!unlocked && (
                              <div
                                className="badge-card-meter"
                                aria-hidden="true"
                                title={`${Math.round(pctWithinTier * 100)}% to unlock`}
                              >
                                <span
                                  className="badge-card-meter-fill"
                                  style={{ width: `${Math.round(pctWithinTier * 100)}%` }}
                                />
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </section>
            );
          })}
        </div>
      </div>

      {hoveredBadge && (
        <div
          className="badge-hovercard badge-hovercard--pro"
          ref={hovercardRef}
          style={
            hovercardPos
              ? { left: hovercardPos.left, top: hovercardPos.top }
              : { left: hoveredBadge.mouseX + 10, top: hoveredBadge.mouseY + 10 }
          }
          role="tooltip"
        >
          <header className="badge-hovercard-head">
            <div className="badge-hovercard-head-left">
              <div className="badge-hovercard-title">{hoveredBadge.title}</div>
              <div className="badge-hovercard-sub">{hoveredBadge.subtitle}</div>
            </div>
            <div
              className={`badge-hovercard-pill ${hoveredBadge.status === "Unlocked" ? "ok" : "muted"}`}
            >
              {hoveredBadge.status}
            </div>
          </header>

          <div className="badge-hovercard-body">
            {hoveredBadge.whenLine && (
              <div className="badge-tip-row">
                <span className="badge-tip-k">When</span>
                <span className="badge-tip-v">{hoveredBadge.whenLine}</span>
              </div>
            )}
            {hoveredBadge.taskLine && (
              <div className="badge-tip-row">
                <span className="badge-tip-k">Task</span>
                <span className="badge-tip-v">{hoveredBadge.taskLine}</span>
              </div>
            )}
            {hoveredBadge.chips?.map((c) => (
              <div key={`${c.label}:${c.value}`} className="badge-tip-row">
                <span className="badge-tip-k">{c.label}</span>
                <span className="badge-tip-v">{c.value}</span>
              </div>
            ))}
            {typeof hoveredBadge.progressPct === "number" && (
              <div className="badge-hovercard-meter" aria-label="Progress to this badge">
                <div
                  className="badge-hovercard-meter-fill"
                  style={{ width: `${Math.round(hoveredBadge.progressPct * 100)}%` }}
                />
              </div>
            )}
            {hoveredBadge.metaLines?.map((ln) => (
              <div key={ln} className="badge-hovercard-meta">
                {ln}
              </div>
            ))}
            <div className="badge-hovercard-progress">{hoveredBadge.progressLine}</div>
          </div>
        </div>
      )}
    </div>
  );
}
