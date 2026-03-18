import { useEffect, useState } from "react";
import { TaskBoard } from "./components/TaskBoard";
import { ProjectSidebar } from "./components/ProjectSidebar";
import { GamificationPanel } from "./components/GamificationPanel";
import Logo from "./assets/focista-schedulo-logo.png";

type TimeScope = "all" | "today" | "week";

export function App() {
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [timeScope, setTimeScope] = useState<TimeScope>("all");

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

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="brand">
          <span className="brand-logo-frame" aria-hidden="true">
            <img className="brand-logo" src={Logo} alt="" />
          </span>
          <div>
            <div className="brand-title">Focista Schedulo</div>
            <div className="brand-subtitle">
              Plan with clarity, focus without noise, and celebrate what you complete
            </div>
          </div>
        </div>
        <div className="header-actions">
          <button
            className={`ghost-button ${
              timeScope === "today" ? "sidebar-item-active" : ""
            }`}
            onClick={() => setTimeScope("today")}
          >
            Today
          </button>
          <button
            className={`ghost-button ${
              timeScope === "week" ? "sidebar-item-active" : ""
            }`}
            onClick={() => setTimeScope("week")}
          >
            This week
          </button>
          <button
            className={`ghost-button ${
              timeScope === "all" ? "sidebar-item-active" : ""
            }`}
            onClick={() => setTimeScope("all")}
          >
            All
          </button>
        </div>
      </header>

      <main className="app-main">
        <ProjectSidebar
          selectedProjectId={selectedProjectId}
          onSelectProject={setSelectedProjectId}
        />
        <TaskBoard selectedProjectId={selectedProjectId} timeScope={timeScope} />
        <GamificationPanel />
      </main>
    </div>
  );
}

