import { useEffect, useRef, useState } from "react";
import { apiFetch, apiUrl } from "../apiClient";

interface Project {
  id: string;
  name: string;
  profileId?: string | null;
}

interface ProjectSidebarProps {
  activeProfileId: string | null;
  selectedProjectId: string | null;
  onSelectProject: (id: string | null) => void;
}

function projectInitials(name: string): string {
  const parts = name
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length === 0) return "P";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0] ?? ""}${parts[1][0] ?? ""}`.toUpperCase();
}

function projectAccentIndex(seed: string): number {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  }
  return hash % 5;
}

export function ProjectSidebar({
  activeProfileId,
  selectedProjectId,
  onSelectProject
}: ProjectSidebarProps) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [editing, setEditing] = useState<Project | null>(null);
  const [draftName, setDraftName] = useState("");
  const [pendingDeleteProject, setPendingDeleteProject] = useState<Project | null>(null);
  const projectsRefreshDebounceRef = useRef<number | null>(null);
  const [activeProfileName, setActiveProfileName] = useState<string | null>(null);
  const isShowcaseReadOnlyActive = activeProfileName?.trim().toLowerCase() === "test";

  const notifyToast = (title: string, message: string) => {
    if (typeof window !== "undefined" && "dispatchEvent" in window) {
      window.dispatchEvent(
        new CustomEvent("pst:toast", { detail: { kind: "info", title, message } })
      );
    }
  };

  const notifyProjectsChanged = () => {
    if (typeof window !== "undefined" && "dispatchEvent" in window) {
      window.dispatchEvent(new Event("pst:projects-changed"));
    }
  };

  const notifyTasksChanged = () => {
    if (typeof window !== "undefined" && "dispatchEvent" in window) {
      window.dispatchEvent(new Event("pst:tasks-changed"));
    }
  };

  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      try {
        const base = new URL(apiUrl("/api/projects"));
        if (activeProfileId) base.searchParams.set("profileId", activeProfileId);
        const res = await apiFetch(`${base.pathname}${base.search}`, { signal: controller.signal });
        if (!res.ok) return;
        const data: Project[] = await res.json();
        setProjects(
          activeProfileId ? data.filter((p) => (p.profileId ?? null) === activeProfileId) : data
        );
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") {
          // fetch was aborted on unmount; safe to ignore
          return;
        }
        // swallow other errors for now; sidebar will just show no projects
      }
    }
    load();
    return () => controller.abort();
  }, [activeProfileId]);

  useEffect(() => {
    if (!activeProfileId) {
      setActiveProfileName(null);
      return;
    }
    const controller = new AbortController();
    const run = async () => {
      try {
        const res = await apiFetch("/api/profiles", { signal: controller.signal });
        if (!res.ok) return;
        const data = (await res.json()) as Array<{ id: string; name: string }>;
        const active = data.find((p) => p.id === activeProfileId);
        setActiveProfileName(active?.name ?? null);
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
      }
    };
    void run();
    return () => controller.abort();
  }, [activeProfileId]);

  useEffect(() => {
    const onProjectsChanged = () => {
      if (projectsRefreshDebounceRef.current) {
        window.clearTimeout(projectsRefreshDebounceRef.current);
      }
      projectsRefreshDebounceRef.current = window.setTimeout(async () => {
        projectsRefreshDebounceRef.current = null;
        const controller = new AbortController();
        try {
          const base = new URL(apiUrl("/api/projects"));
          if (activeProfileId) base.searchParams.set("profileId", activeProfileId);
          const res = await apiFetch(`${base.pathname}${base.search}`, { signal: controller.signal });
          if (!res.ok) return;
          const data: Project[] = await res.json();
          setProjects(
            activeProfileId ? data.filter((p) => (p.profileId ?? null) === activeProfileId) : data
          );
        } catch {
          // ignore
        }
      }, 180);
    };
    window.addEventListener("pst:projects-changed", onProjectsChanged);
    return () => {
      window.removeEventListener("pst:projects-changed", onProjectsChanged);
      if (projectsRefreshDebounceRef.current) {
        window.clearTimeout(projectsRefreshDebounceRef.current);
        projectsRefreshDebounceRef.current = null;
      }
    };
  }, [activeProfileId]);

  const startNew = () => {
    if (isShowcaseReadOnlyActive) {
      notifyToast(
        "Showcase mode",
        'Profile "Test" is read-only. Project create, edit, and delete are disabled.'
      );
      return;
    }
    setEditing({ id: "new", name: "" });
    setDraftName("");
  };

  const startEdit = (project: Project) => {
    if (isShowcaseReadOnlyActive) {
      notifyToast(
        "Showcase mode",
        'Profile "Test" is read-only. Project create, edit, and delete are disabled.'
      );
      return;
    }
    setEditing(project);
    setDraftName(project.name);
  };

  const saveProject = async () => {
    if (isShowcaseReadOnlyActive) return;
    if (!draftName.trim() || !editing) return;
    if (!activeProfileId) return;
    if (editing.id === "new") {
      const res = await apiFetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: draftName.trim(), profileId: activeProfileId })
      });
      if (res.ok) {
        const created: Project = await res.json();
        setProjects((prev) => [...prev, created]);
        setEditing(null);
        notifyProjectsChanged();
      }
    } else {
      const res = await apiFetch(`/api/projects/${editing.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: draftName.trim(), profileId: activeProfileId })
      });
      if (res.ok) {
        const updated: Project = await res.json();
        setProjects((prev) =>
          prev.map((p) => (p.id === updated.id ? updated : p))
        );
        setEditing(null);
        notifyProjectsChanged();
      }
    }
  };

  const deleteProject = async (project: Project) => {
    if (isShowcaseReadOnlyActive) return;
    const res = await apiFetch(`/api/projects/${project.id}`, {
      method: "DELETE"
    });
    if (res.ok) {
      setProjects((prev) => prev.filter((p) => p.id !== project.id));
      if (selectedProjectId === project.id) {
        onSelectProject(null);
      }
      notifyProjectsChanged();
      // Deleting a project deletes its tasks on the backend too.
      notifyTasksChanged();
    }
    setPendingDeleteProject(null);
  };

  const selectedProject =
    selectedProjectId == null
      ? null
      : projects.find((p) => p.id === selectedProjectId) ?? null;
  const selectedAccent = selectedProject
    ? projectAccentIndex(selectedProject.id || selectedProject.name)
    : 0;

  return (
    <aside className="sidebar projects-sidebar projects-sidebar--dropdown">
      <div className="sidebar-header projects-sidebar-header">
        <div className="projects-header-copy">
          <h2>Projects</h2>
          <p className="projects-header-sub">Choose a board filter</p>
        </div>
        <button
          className="ghost-button small projects-new-btn"
          onClick={startNew}
          title="Create a new project (group tasks by context)."
          disabled={!activeProfileId || isShowcaseReadOnlyActive}
        >
          <span className="projects-new-btn-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" focusable="false">
              <path d="M12 5v14M5 12h14" />
            </svg>
          </span>
          <span>New</span>
        </button>
      </div>

      <div className="projects-picker rail-picker" aria-label="Project filter">
        <label className="projects-picker-trigger rail-picker-trigger" htmlFor="project-filter-select">
          <div className="projects-picker-identity rail-picker-identity" aria-live="polite">
            {selectedProject ? (
              <span
                className={`projects-picker-mark rail-picker-mark accent-${selectedAccent}`}
                aria-hidden="true"
              >
                {projectInitials(selectedProject.name)}
              </span>
            ) : (
              <span
                className="projects-picker-mark projects-picker-mark--all rail-picker-mark"
                aria-hidden="true"
              >
                <svg viewBox="0 0 24 24" focusable="false">
                  <path d="M4.5 6.5h6v6h-6zM13.5 6.5h6v6h-6zM4.5 15.5h6v6h-6zM13.5 15.5h6v6h-6z" />
                </svg>
              </span>
            )}
            <span className="projects-picker-copy rail-picker-copy">
              <strong className="projects-picker-name rail-picker-name">
                {selectedProject?.name ?? "All tasks"}
              </strong>
              <span className="projects-picker-meta rail-picker-meta">
                {selectedProject
                  ? "Filtered to this project"
                  : projects.length === 0
                    ? "No projects yet"
                    : `${projects.length} project${projects.length === 1 ? "" : "s"} available`}
              </span>
            </span>
          </div>
          <div className="projects-picker-shell">
            <select
              id="project-filter-select"
              className="projects-picker-select"
              value={selectedProjectId ?? ""}
              onChange={(e) => {
                const value = e.target.value;
                onSelectProject(value ? value : null);
              }}
              disabled={!activeProfileId && projects.length === 0}
              aria-label="Filter tasks by project"
            >
              <option value="">All tasks</option>
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </select>
            <span className="projects-picker-chevron rail-picker-chevron" aria-hidden="true">
              <svg viewBox="0 0 24 24" focusable="false">
                <path d="M6 9l6 6 6-6" />
              </svg>
            </span>
          </div>
        </label>

        {selectedProject ? (
          <div className="projects-picker-toolbar" role="group" aria-label="Selected project actions">
            <button
              className="ghost-button small projects-toolbar-btn"
              type="button"
              onClick={() => startEdit(selectedProject)}
              title="Rename this project."
              disabled={isShowcaseReadOnlyActive}
            >
              <svg viewBox="0 0 24 24" focusable="false" aria-hidden="true">
                <path d="M4 20l4.2-1 9.8-9.8-3.2-3.2L5 15.8 4 20zM13.8 6.2l3.2 3.2" />
              </svg>
              <span>Rename</span>
            </button>
            <button
              className="ghost-button small projects-toolbar-btn projects-toolbar-btn--danger"
              type="button"
              onClick={() => setPendingDeleteProject(selectedProject)}
              title="Delete this project and all tasks in it."
              disabled={isShowcaseReadOnlyActive}
            >
              <svg viewBox="0 0 24 24" focusable="false" aria-hidden="true">
                <path d="M4 7h16M9 7V5h6v2M8 7l1 12h6l1-12M10 10v7M14 10v7" />
              </svg>
              <span>Delete</span>
            </button>
          </div>
        ) : (
          <p className="projects-picker-hint">
            {projects.length === 0
              ? "Create a project to group related tasks."
              : "Showing every project on the board. Pick one to focus."}
          </p>
        )}
      </div>
      {editing && (
        <div className="project-editor">
          <input
            className="project-editor-input"
            autoFocus
            value={draftName}
            onChange={(e) => setDraftName(e.target.value)}
            placeholder="Project name"
            title="Project name (required)."
          />
          <div className="project-editor-actions">
            <button
              className="ghost-button small"
              onClick={() => setEditing(null)}
              title="Discard changes."
            >
              Cancel
            </button>
            <button
              className="primary-button small"
              onClick={saveProject}
              disabled={!draftName.trim()}
              title="Save the project."
            >
              Save
            </button>
          </div>
        </div>
      )}
      {pendingDeleteProject ? (
        <div className="drawer-backdrop" onClick={() => setPendingDeleteProject(null)}>
          <aside className="drawer" onClick={(e) => e.stopPropagation()}>
            <header className="drawer-header">
              <h2>Delete project</h2>
            </header>
            <div className="drawer-body">
              <p>
                Delete project "<strong>{pendingDeleteProject.name}</strong>"?
              </p>
              <p className="muted" style={{ marginTop: "0.5rem" }}>
                This will permanently remove the project and all tasks inside it.
              </p>
            </div>
            <footer className="drawer-footer">
              <button
                className="ghost-button"
                type="button"
                onClick={() => setPendingDeleteProject(null)}
              >
                Cancel
              </button>
              <button
                className="primary-button"
                type="button"
                onClick={() => void deleteProject(pendingDeleteProject)}
              >
                Delete
              </button>
            </footer>
          </aside>
        </div>
      ) : null}
    </aside>
  );
}

