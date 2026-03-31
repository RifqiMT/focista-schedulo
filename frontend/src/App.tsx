import { useEffect, useState } from "react";
import { TaskBoard } from "./components/TaskBoard";
import { ProjectSidebar } from "./components/ProjectSidebar";
import { GamificationPanel } from "./components/GamificationPanel";
import Logo from "./assets/focista-schedulo-logo.png";
import { Toast, Toaster } from "./components/Toaster";

type TimeScope =
  | "all"
  | "yesterday"
  | "today"
  | "tomorrow"
  | "last_week"
  | "week"
  | "next_week"
  | "sprint"
  | "last_month"
  | "month"
  | "next_month"
  | "custom"
  | "last_quarter"
  | "quarter"
  | "next_quarter";

export function App() {
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  // Default timeframe is "today" for a focused daily view.
  const [timeScope, setTimeScope] = useState<TimeScope>("today");
  const [syncingData, setSyncingData] = useState(false);
  const [importingData, setImportingData] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [importOkMsg, setImportOkMsg] = useState<string | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);

  const pushToast = (t: Omit<Toast, "id" | "createdAt">) => {
    const id = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
    setToasts((prev) => [{ ...t, id, createdAt: Date.now() }, ...prev].slice(0, 4));
  };

  useEffect(() => {
    const onToast = (ev: Event) => {
      const e = ev as CustomEvent<Partial<Omit<Toast, "id" | "createdAt">>>;
      const detail = e.detail ?? {};
      const title = typeof detail.title === "string" ? detail.title : "Activity";
      const kind = detail.kind === "success" || detail.kind === "error" || detail.kind === "info" ? detail.kind : "info";
      pushToast({
        kind,
        title,
        message: typeof detail.message === "string" ? detail.message : undefined,
        durationMs: typeof detail.durationMs === "number" ? detail.durationMs : undefined
      });
    };
    window.addEventListener("pst:toast", onToast as any);
    return () => window.removeEventListener("pst:toast", onToast as any);
  }, []);

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
    const started = performance.now();
    try {
      const res = await fetch("/api/admin/save-data", { method: "POST" });
      const elapsed = performance.now() - started;
      if (!res.ok) {
        pushToast({
          kind: "error",
          title: "Save failed",
          message: `Request failed (${res.status})`,
          durationMs: elapsed
        });
        return;
      }
      window.dispatchEvent(new Event("pst:projects-changed"));
      window.dispatchEvent(new Event("pst:tasks-changed"));
      pushToast({ kind: "success", title: "Saved", message: "Data saved and normalized.", durationMs: elapsed });
    } finally {
      setSyncingData(false);
    }
  };

  const importFromFile = async (file: File) => {
    if (importingData) return;
    setImportingData(true);
    setImportError(null);
    setImportOkMsg(null);
    const started = performance.now();
    try {
      const name = file.name.toLowerCase();
      const format = name.endsWith(".csv") ? "csv" : name.endsWith(".json") ? "json" : null;
      if (!format) {
        setImportError("Unsupported file type. Please import a .json or .csv export.");
        pushToast({ kind: "error", title: "Import failed", message: "Unsupported file type." });
        return;
      }
      const content = await file.text();
      const res = await fetch("/api/admin/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ format, content })
      });
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        const elapsed = performance.now() - started;
        setImportError(
          typeof err?.error === "string"
            ? err.error
            : "Import failed. Please verify the file is a valid export."
        );
        pushToast({
          kind: "error",
          title: "Import failed",
          message: typeof err?.error === "string" ? err.error : `Request failed (${res.status})`,
          durationMs: elapsed
        });
        return;
      }
      const out = await res.json().catch(() => null);
      const importedProjects = out?.imported?.projects ?? 0;
      const importedTasks = out?.imported?.tasks ?? 0;
      setImportOkMsg(`Imported ${importedProjects} project(s) and ${importedTasks} task(s).`);
      window.dispatchEvent(new Event("pst:projects-changed"));
      window.dispatchEvent(new Event("pst:tasks-changed"));
      pushToast({
        kind: "success",
        title: "Imported",
        message: `Imported ${importedProjects} project(s) and ${importedTasks} task(s).`,
        durationMs: performance.now() - started
      });
    } finally {
      setImportingData(false);
    }
  };

  const openExport = () => {
    window.dispatchEvent(new Event("pst:open-export"));
  };

  return (
    <div className="app-shell">
      <Toaster toasts={toasts} onDismiss={(id) => setToasts((prev) => prev.filter((t) => t.id !== id))} />
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
            <label className="ghost-button" style={{ display: "inline-flex", alignItems: "center" }}>
              <input
                type="file"
                accept=".json,.csv,application/json,text/csv"
                style={{ display: "none" }}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (!f) return;
                  void importFromFile(f);
                  e.currentTarget.value = "";
                }}
              />
              <span title="Import tasks and projects from an exported JSON/CSV file (merges duplicates and normalizes data).">
                {importingData ? "Importing…" : "Import"}
              </span>
            </label>
            <button
              className="ghost-button"
              onClick={syncDataFromJson}
              disabled={syncingData}
              title="Save current data to backend/data/*.json, dedupe duplicates, and normalize series IDs."
            >
              {syncingData ? "Saving…" : "Save"}
            </button>
            <button
              className="ghost-button"
              onClick={openExport}
              title="Export all tasks and projects as JSON or CSV."
            >
              Export
            </button>
          </div>
          {(importError || importOkMsg) && (
            <div style={{ marginTop: "0.25rem", fontSize: "0.8rem" }}>
              {importError ? (
                <span style={{ color: "rgba(254, 226, 226, 0.95)" }}>{importError}</span>
              ) : (
                <span style={{ color: "rgba(209, 250, 229, 0.95)" }}>{importOkMsg}</span>
              )}
            </div>
          )}
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

