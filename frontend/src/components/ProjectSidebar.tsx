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

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <h2>Projects</h2>
        <button
          className="ghost-button small"
          onClick={startNew}
          title="Create a new project (group tasks by context)."
          disabled={!activeProfileId || isShowcaseReadOnlyActive}
        >
          New
        </button>
      </div>
      <nav className="sidebar-list">
        <button
          className={`sidebar-item ${
            selectedProjectId === null ? "sidebar-item-active" : ""
          }`}
          onClick={() => onSelectProject(null)}
          title="Show tasks from all projects."
        >
          <span>All tasks</span>
        </button>
        {projects.map((project) => (
          <div key={project.id} className="sidebar-item-row">
            <button
              className={`sidebar-item ${
                selectedProjectId === project.id ? "sidebar-item-active" : ""
              }`}
              onClick={() => onSelectProject(project.id)}
              title={`Filter tasks to project: ${project.name}`}
            >
              <span>{project.name}</span>
            </button>
            <div className="sidebar-item-actions">
              <button
                className="icon-button"
                aria-label="Edit project"
                onClick={() => startEdit(project)}
                title="Rename this project."
                disabled={isShowcaseReadOnlyActive}
              >
                ✎
              </button>
              <button
                className="icon-button"
                aria-label="Delete project"
                onClick={() => setPendingDeleteProject(project)}
                title="Delete this project and all tasks in it."
                disabled={isShowcaseReadOnlyActive}
              >
                ×
              </button>
            </div>
          </div>
        ))}
      </nav>
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

