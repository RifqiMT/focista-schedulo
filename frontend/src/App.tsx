import { useEffect, useRef, useState } from "react";
import { TaskBoard } from "./components/TaskBoard";
import { ProjectSidebar } from "./components/ProjectSidebar";
import { GamificationPanel } from "./components/GamificationPanel";
import { ProfileManagement } from "./components/ProfileManagement";
import Logo from "./assets/focista-schedulo-logo.png";
import { Toast, Toaster } from "./components/Toaster";
import {
  isAppTrueFullscreenActive,
  PST_TRUE_FULLSCREEN_CONTEXT_EVENT
} from "./fullscreenApi";
import { getFriendlyErrorMessage } from "./utils/friendlyError";

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
  const [syncingFromData, setSyncingFromData] = useState(false);
  const [importingData, setImportingData] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [activeProfileId, setActiveProfileId] = useState<string | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  /** Bumps when native fullscreen or overlay DOM may have changed (re-run {@link isAppTrueFullscreenActive}). */
  const [, setTrueFsContextEpoch] = useState(0);
  const prevTrueFsRef = useRef(false);
  const TOAST_DEDUPE_MS = 2500;

  const enqueueToast = (next: Omit<Toast, "id" | "createdAt">) => {
    const now = Date.now();
    const id = `${now}-${Math.random().toString(16).slice(2, 8)}`;
    setToasts((prev) => {
      const dup = prev.find(
        (t) =>
          t.kind === next.kind &&
          t.title === next.title &&
          (t.message ?? "") === (next.message ?? "") &&
          now - t.createdAt < TOAST_DEDUPE_MS
      );
      if (dup) return prev;
      return [{ ...next, id, createdAt: now }, ...prev].slice(0, 4);
    });
  };

  const pushToast = (t: Omit<Toast, "id" | "createdAt">) => {
    if (isAppTrueFullscreenActive() && !t.bypassTrueFullscreen) return;
    enqueueToast(t);
  };

  const ensureVisibleProfileAfterDataOps = async () => {
    try {
      if (!activeProfileId) return;
      const currentRes = await fetch(
        `/api/tasks?profileId=${encodeURIComponent(activeProfileId)}`
      );
      if (!currentRes.ok) return;
      const currentTasks = (await currentRes.json()) as Array<{ id: string }>;
      if (currentTasks.length > 0) return;

      const [profilesRes, tasksRes] = await Promise.all([
        fetch("/api/profiles"),
        fetch("/api/tasks")
      ]);
      if (!profilesRes.ok || !tasksRes.ok) return;
      const profiles = (await profilesRes.json()) as Array<{ id: string; name: string }>;
      const allTasks = (await tasksRes.json()) as Array<{ profileId?: string | null }>;
      const counts = new Map<string, number>();
      for (const t of allTasks) {
        const pid = t.profileId ?? null;
        if (!pid) continue;
        counts.set(pid, (counts.get(pid) ?? 0) + 1);
      }
      const fallback = profiles
        .map((p) => ({ id: p.id, name: p.name, count: counts.get(p.id) ?? 0 }))
        .sort((a, b) => b.count - a.count)[0];
      if (!fallback || fallback.count <= 0 || fallback.id === activeProfileId) return;
      setActiveProfileId(fallback.id);
      pushToast({
        kind: "info",
        title: "Profile switched",
        message: `Switched to ${fallback.name} because the current profile has no visible tasks.`
      });
    } catch {
      // ignore visibility fallback failures
    }
  };

  useEffect(() => {
    const bumpContext = () => setTrueFsContextEpoch((n) => n + 1);
    const fsEvents = [
      "fullscreenchange",
      "webkitfullscreenchange",
      "mozfullscreenchange",
      "MSFullscreenChange"
    ] as const;
    fsEvents.forEach((ev) => document.addEventListener(ev, bumpContext));
    window.addEventListener(PST_TRUE_FULLSCREEN_CONTEXT_EVENT, bumpContext);
    bumpContext();
    return () => {
      fsEvents.forEach((ev) => document.removeEventListener(ev, bumpContext));
      window.removeEventListener(PST_TRUE_FULLSCREEN_CONTEXT_EVENT, bumpContext);
    };
  }, []);

  const trueFullscreenActive = isAppTrueFullscreenActive();

  useEffect(() => {
    if (trueFullscreenActive && !prevTrueFsRef.current) {
      setToasts([]);
    }
    prevTrueFsRef.current = trueFullscreenActive;
  }, [trueFullscreenActive]);

  useEffect(() => {
    let cancelled = false;
    const bootstrapActiveProfile = async () => {
      try {
        const [profilesRes, countsRes] = await Promise.all([
          fetch("/api/profiles"),
          fetch("/api/profiles/task-counts")
        ]);
        if (!profilesRes.ok || !countsRes.ok) return;
        const profiles = (await profilesRes.json()) as Array<{ id: string; name: string }>;
        const countsPayload = (await countsRes.json()) as {
          countsByProfileId?: Record<string, number>;
        };
        if (!profiles.length) {
          if (!cancelled) setActiveProfileId(null);
          return;
        }
        const counts = countsPayload.countsByProfileId ?? {};
        const stored = window.localStorage.getItem("pst.activeProfileId");
        const storedProfile = stored ? profiles.find((p) => p.id === stored) : null;
        const storedCount = storedProfile ? Number(counts[storedProfile.id] ?? 0) : 0;
        const bestProfile = profiles
          .map((p) => ({ ...p, count: Number(counts[p.id] ?? 0) }))
          .sort((a, b) => b.count - a.count)[0];
        const nextProfileId =
          storedProfile && storedCount > 0
            ? storedProfile.id
            : (bestProfile?.id ?? profiles[0]?.id ?? null);
        if (!cancelled) setActiveProfileId(nextProfileId);
      } catch {
        const stored = window.localStorage.getItem("pst.activeProfileId");
        if (!cancelled && stored) setActiveProfileId(stored);
      }
    };
    void bootstrapActiveProfile();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (activeProfileId) window.localStorage.setItem("pst.activeProfileId", activeProfileId);
    else window.localStorage.removeItem("pst.activeProfileId");
    setSelectedProjectId(null);
    window.dispatchEvent(new Event("pst:projects-changed"));
    window.dispatchEvent(new Event("pst:tasks-changed"));
  }, [activeProfileId]);

  useEffect(() => {
    const onToast = (ev: Event) => {
      if (isAppTrueFullscreenActive()) return;
      const e = ev as CustomEvent<Partial<Omit<Toast, "id" | "createdAt">>>;
      const detail = e.detail ?? {};
      const title = typeof detail.title === "string" ? detail.title : "Activity";
      const kind = detail.kind === "success" || detail.kind === "error" || detail.kind === "info" ? detail.kind : "info";
      enqueueToast({
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
        const base = new URL("/api/projects", window.location.origin);
        if (activeProfileId) base.searchParams.set("profileId", activeProfileId);
        const res = await fetch(base.toString());
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
  }, [activeProfileId, selectedProjectId]);

  const syncDataFromJson = async () => {
    if (syncingData) return;
    setSyncingData(true);
    const started = performance.now();
    try {
      const res = await fetch("/api/admin/save-data", { method: "POST" });
      const elapsed = performance.now() - started;
      if (!res.ok) {
        const message = await getFriendlyErrorMessage(res);
        pushToast({
          kind: "error",
          title: "Save failed",
          message,
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

  const syncAndMergeFromDataFolder = async () => {
    if (syncingFromData) return;
    setSyncingFromData(true);
    const started = performance.now();
    try {
      const res = await fetch("/api/admin/sync-from-data", { method: "POST" });
      const elapsed = performance.now() - started;
      if (!res.ok) {
        const message = await getFriendlyErrorMessage(res);
        pushToast({
          kind: "error",
          title: "Sync failed",
          message,
          durationMs: elapsed
        });
        return;
      }
      const out = await res.json().catch(() => null);
      window.dispatchEvent(new Event("pst:projects-changed"));
      window.dispatchEvent(new Event("pst:tasks-changed"));
      await ensureVisibleProfileAfterDataOps();
      const filesRead = out?.filesRead ?? 0;
      const importedTasks = out?.imported?.tasks ?? 0;
      const importedProjects = out?.imported?.projects ?? 0;
      const importedProfiles = out?.imported?.profiles ?? 0;
      pushToast({
        kind: "success",
        title: "Synced",
        message: `Synced from data folder (${filesRead} file(s)); merged ${importedProfiles} profile(s), ${importedProjects} project(s), ${importedTasks} task(s).`,
        durationMs: elapsed
      });
    } finally {
      setSyncingFromData(false);
    }
  };

  const importFromFile = async (file: File) => {
    if (importingData) return;
    setImportingData(true);
    setImportError(null);
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
        const message = await getFriendlyErrorMessage(res);
        const elapsed = performance.now() - started;
        setImportError(message);
        pushToast({
          kind: "error",
          title: "Import failed",
          message,
          durationMs: elapsed
        });
        return;
      }
      const out = await res.json().catch(() => null);
      const importedProjects = out?.imported?.projects ?? 0;
      const importedTasks = out?.imported?.tasks ?? 0;
      const importedProfiles = out?.imported?.profiles ?? 0;
      const droppedProjects = out?.droppedRows?.projects ?? 0;
      const droppedTasks = out?.droppedRows?.tasks ?? 0;
      const droppedProfiles = out?.droppedRows?.profiles ?? 0;
      const inferredProjectProfiles = out?.inferredProfileIds?.projects ?? 0;
      const inferredTaskProfiles = out?.inferredProfileIds?.tasks ?? 0;
      const backfilledTotal = out?.diagnostics?.profileBackfill?.totalBackfilled ?? 0;
      const importedTasksByProfileId = out?.diagnostics?.importedTasksByProfileId ?? {};
      const importedTopProfile = Object.entries(importedTasksByProfileId)
        .filter(([pid]) => pid !== "__null__")
        .sort((a, b) => Number(b[1]) - Number(a[1]))[0];
      if (importedTopProfile && Number(importedTopProfile[1]) > 0) {
        const topProfileId = importedTopProfile[0];
        if (topProfileId && topProfileId !== activeProfileId) {
          setActiveProfileId(topProfileId);
        }
      }
      window.dispatchEvent(new Event("pst:projects-changed"));
      window.dispatchEvent(new Event("pst:tasks-changed"));
      await ensureVisibleProfileAfterDataOps();
      pushToast({
        kind: "success",
        title: "Imported",
        message:
          `Imported ${importedProfiles} profile(s), ${importedProjects} project(s), and ${importedTasks} task(s). ` +
          `Inferred profile links: projects=${inferredProjectProfiles}, tasks=${inferredTaskProfiles}. ` +
          `Dropped invalid rows: profiles=${droppedProfiles}, projects=${droppedProjects}, tasks=${droppedTasks}. ` +
          `Profile backfill: ${backfilledTotal}.`,
        durationMs: performance.now() - started
      });
      if (activeProfileId) {
        const activeImported = Number(importedTasksByProfileId?.[activeProfileId] ?? 0);
        if (importedTasks > 0 && activeImported === 0) {
          pushToast({
            kind: "info",
            title: "Import scope note",
            message:
              "Imported tasks were mapped to other profile(s), not the currently active profile.",
            durationMs: performance.now() - started
          });
        }
      }
    } finally {
      setImportingData(false);
    }
  };

  const openExport = () => {
    window.dispatchEvent(new Event("pst:open-export"));
  };

  return (
    <div className="app-shell">
      <Toaster
        toasts={
          trueFullscreenActive ? toasts.filter((t) => t.bypassTrueFullscreen) : toasts
        }
        onDismiss={(id) => setToasts((prev) => prev.filter((t) => t.id !== id))}
      />
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
              onClick={syncAndMergeFromDataFolder}
              disabled={syncingFromData}
              title="Sync & merge from backend/data/focista-unified-data.json (legacy JSON fallback only when unified file is missing)."
            >
              {syncingFromData ? "Syncing…" : "Sync"}
            </button>
            <button
              className="ghost-button"
              onClick={syncDataFromJson}
              disabled={syncingData}
              title="Save current data to one unified JSON file in backend/data, dedupe duplicates, and normalize series IDs."
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
          {importError && (
            <div style={{ marginTop: "0.25rem", fontSize: "0.8rem" }}>
              <span style={{ color: "rgba(254, 226, 226, 0.95)" }}>{importError}</span>
            </div>
          )}
        </div>
      </header>
      <main className="app-main">
        <div className="left-rail-stack">
          <ProfileManagement
            activeProfileId={activeProfileId}
            onChooseProfile={setActiveProfileId}
            onToast={({ kind, title, message }) => pushToast({ kind, title, message })}
          />
          <ProjectSidebar
            activeProfileId={activeProfileId}
            selectedProjectId={selectedProjectId}
            onSelectProject={setSelectedProjectId}
          />
        </div>
        <TaskBoard
          activeProfileId={activeProfileId}
          selectedProjectId={selectedProjectId}
          timeScope={timeScope}
          onTimeScopeChange={setTimeScope}
        />
        <GamificationPanel activeProfileId={activeProfileId} />
      </main>
    </div>
  );
}

