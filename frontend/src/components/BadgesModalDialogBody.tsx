import type { Dispatch, RefObject, SetStateAction } from "react";

interface BadgesModalSection {
  key: string;
  title: string;
  icon: "streak" | "tasks" | "xp" | "levels";
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

type BadgesModalDialogBodyProps = {
  panelRef: RefObject<HTMLDivElement | null>;
  closeBadgesModal: () => void;
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
  return (
    <div className="badges-dialog-root">
      <div
        ref={panelRef}
        data-badges-panel=""
        className="badge-modal pa-pro-shell badge-modal--viewport-expanded"
      >
        <div className="badge-modal-head">
          <div>
            <div className="badge-modal-title">Badges</div>
            <div className="badge-modal-sub">
              Unlock badges by hitting milestone targets across streaks, tasks, XP, and levels.
            </div>
          </div>
          <div className="badge-modal-head-actions">
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
        </div>

        <div className="badge-modal-body">
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
                {s.milestones.slice(0, expandedBadgeSections[s.key] ? 150 : 12).map((m) => {
                  const unlocked = s.current >= m;
                  const label =
                    s.key === "levelsUp" ? `Level ${m}` : `${m.toLocaleString()} ${s.unit}`;
                  const idx = s.milestones.indexOf(m);
                  const tier =
                    idx < 1 ? 1 : idx < 3 ? 2 : idx < 6 ? 3 : idx < 10 ? 4 : 5;
                  const badgeNumber = Math.max(1, idx + 1);
                  const remaining = Math.max(0, m - s.current);
                  const prevMilestone = idx > 0 ? s.milestones[idx - 1]! : 0;
                  const pctWithinTier = unlocked
                    ? 1
                    : Math.max(
                        0,
                        Math.min(1, (s.current - prevMilestone) / Math.max(1, m - prevMilestone))
                      );
                  const progressLine = unlocked ? `You’ve reached ${label}.` : `Next target: ${label}`;
                  const unlockMeta = unlocked ? s.unlockDetails?.[String(m)] : undefined;
                  const whenLine =
                    unlocked && unlockMeta?.dateIso
                      ? `Unlocked on ${formatHoverDate(unlockMeta.dateIso)} · ${relativeDays(
                          unlockMeta.dateIso
                        )}`
                      : undefined;
                  const prio = priorityLabel(unlockMeta?.task?.priority);
                  const taskLine = unlocked && unlockMeta?.task?.title ? unlockMeta.task.title : undefined;
                  const chips = (() => {
                    const out: { label: string; value: string }[] = [];
                    if (unlocked && unlockMeta?.task?.dueDate) {
                      out.push({
                        label: "Due",
                        value: `${unlockMeta.task.dueDate}${unlockMeta.task.dueTime ? ` ${unlockMeta.task.dueTime}` : ""}`
                      });
                    }
                    if (unlocked && unlockMeta?.task?.projectName) {
                      out.push({ label: "Project", value: unlockMeta.task.projectName });
                    }
                    if (unlocked && prio) out.push({ label: "Priority", value: prio });
                    return out.length ? out : undefined;
                  })();
                  const metaLines = (() => {
                    const out: string[] = [];
                    if (!unlocked) {
                      out.push(
                        `Current: ${s.current.toLocaleString()} ${s.unit} · Need: +${remaining.toLocaleString()}`
                      );
                      out.push(
                        `Progress: ${Math.round(pctWithinTier * 100)}% (from ${prevMilestone} → ${m})`
                      );
                    }
                    return out.length ? out : undefined;
                  })();
                  return (
                    <div
                      key={`${s.key}-${m}`}
                      className={`badge-card badge-cat-${s.key} ${unlocked ? "unlocked" : "locked"} tier-${tier}`}
                      onMouseEnter={(ev) => {
                        setHoveredBadge({
                          title: label,
                          subtitle: s.title,
                          status: unlocked ? "Unlocked" : "Locked",
                          progressLine,
                          whenLine,
                          taskLine: taskLine ? `Task: ${taskLine}` : undefined,
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
                        <div className="badge-stars" aria-label={`Badge ${badgeNumber}`}>
                          <span className="badge-stars-icon" aria-hidden="true">
                            ★
                          </span>
                          <span className="badge-stars-num">{badgeNumber}</span>
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
      </div>

      {hoveredBadge && (
        <div
          className="badge-hovercard"
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
            <div className={`badge-hovercard-pill ${hoveredBadge.status === "Unlocked" ? "ok" : "muted"}`}>
              {hoveredBadge.status}
            </div>
          </header>

          <div className="badge-hovercard-body">
            {(hoveredBadge.whenLine || hoveredBadge.taskLine) && (
              <section className="badge-hovercard-sec">
                <div className="badge-hovercard-sec-title">
                  {hoveredBadge.status === "Unlocked" ? "Unlocked" : "Status"}
                </div>
                {hoveredBadge.whenLine && (
                  <div className="badge-hovercard-row">
                    <span className="badge-hovercard-k">When</span>
                    <span className="badge-hovercard-v badge-hovercard-when">{hoveredBadge.whenLine}</span>
                  </div>
                )}
                {hoveredBadge.taskLine && (
                  <div className="badge-hovercard-row">
                    <span className="badge-hovercard-k">Task</span>
                    <span className="badge-hovercard-v badge-hovercard-task">{hoveredBadge.taskLine}</span>
                  </div>
                )}
                {hoveredBadge.chips && hoveredBadge.chips.length > 0 && (
                  <div className="badge-hovercard-chips" aria-label="Task details">
                    {hoveredBadge.chips.map((c) => (
                      <div key={`${c.label}:${c.value}`} className="badge-hovercard-chip">
                        <span className="badge-hovercard-chip-k">{c.label}</span>
                        <span className="badge-hovercard-chip-v">{c.value}</span>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            )}

            <section className="badge-hovercard-sec">
              <div className="badge-hovercard-sec-title">Progress</div>
              {hoveredBadge.metaLines?.map((ln) => (
                <div key={ln} className="badge-hovercard-meta">
                  {ln}
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
              <div className="badge-hovercard-progress">{hoveredBadge.progressLine}</div>
            </section>
          </div>
        </div>
      )}
    </div>
  );
}
