import { useEffect, useState } from "react";
import { TaskBoard } from "./components/TaskBoard";
import { ProjectSidebar } from "./components/ProjectSidebar";
import { GamificationPanel } from "./components/GamificationPanel";
import Logo from "./assets/focista-schedulo-logo.png";

type TimeScope =
  | "all"
  | "today"
  | "tomorrow"
  | "week"
  | "next_week"
  | "sprint"
  | "month"
  | "next_month";

export function App() {
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  // Default timeframe is "today" for a focused daily view.
  const [timeScope, setTimeScope] = useState<TimeScope>("today");
  const [syncingData, setSyncingData] = useState(false);

  useEffect(() => {
    const validateSelection = async () => {
      if (selectedProjectId === null) return;
      try {
        const res = await fetch("/api/projects");
        if (!res.ok) return;
        const projects: { id: string; name: string }[] = await res.json();
        const exists = projects.some((p) => p.id === selectedProjectId);
        if (!exists) {
          setSelectedProjectId(null);
          window.dispatchEvent(new Event("pst:tasks-changed"));
        }
      } catch {
        // ignore
      }
    };

    const onProjectsChanged = () => {
      void validateSelection();
    };

    // Also refresh after tab-focus to keep association seamless.
    const onFocus = () => {
      void validateSelection();
      window.dispatchEvent(new Event("pst:projects-changed"));
      window.dispatchEvent(new Event("pst:tasks-changed"));
    };

    window.addEventListener("pst:projects-changed", onProjectsChanged);
    window.addEventListener("focus", onFocus);
    return () => {
      window.removeEventListener("pst:projects-changed", onProjectsChanged);
      window.removeEventListener("focus", onFocus);
    };
  }, [selectedProjectId]);

  const syncDataFromJson = async () => {
    if (syncingData) return;
    setSyncingData(true);
    try {
      const res = await fetch("/api/admin/reload-data", { method: "POST" });
      if (!res.ok) return;
      window.dispatchEvent(new Event("pst:projects-changed"));
      window.dispatchEvent(new Event("pst:tasks-changed"));
    } finally {
      setSyncingData(false);
    }
  };

  const openExport = () => {
    window.dispatchEvent(new Event("pst:open-export"));
  };

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="header-left">
          <div className="brand">
            <span className="brand-logo-frame" aria-hidden="true">
              <img className="brand-logo" src={Logo} alt="" />
            </span>
            <div className="brand-copy">
              <div className="brand-title">Focista Schedulo</div>
              <div className="brand-subtitle">
                Plan with clarity, focus without noise, and celebrate what you complete
              </div>
            </div>
          </div>
        </div>

        <div className="header-right" aria-label="Data actions">
          <div className="header-group" role="group" aria-label="Data actions">
            <button className="ghost-button" onClick={syncDataFromJson} disabled={syncingData}>
              {syncingData ? "Syncing…" : "Sync data"}
            </button>
            <button className="ghost-button" onClick={openExport}>
              Export
            </button>
          </div>
        </div>
      </header>

      <main className="app-main">
        <ProjectSidebar
          selectedProjectId={selectedProjectId}
          onSelectProject={setSelectedProjectId}
        />
        <TaskBoard
          selectedProjectId={selectedProjectId}
          timeScope={timeScope}
          onTimeScopeChange={setTimeScope}
        />
        <GamificationPanel />
      </main>
    </div>
  );
}

