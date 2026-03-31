import { useEffect, useState } from "react";

interface Project {
  id: string;
  name: string;
}

interface ProjectSidebarProps {
  selectedProjectId: string | null;
  onSelectProject: (id: string | null) => void;
}

export function ProjectSidebar({
  selectedProjectId,
  onSelectProject
}: ProjectSidebarProps) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [editing, setEditing] = useState<Project | null>(null);
  const [draftName, setDraftName] = useState("");

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
        const res = await fetch("/api/projects", { signal: controller.signal });
        if (!res.ok) return;
        const data: Project[] = await res.json();
        setProjects(data);
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
  }, []);

  useEffect(() => {
    const onProjectsChanged = () => {
      const controller = new AbortController();
      const run = async () => {
        try {
          const res = await fetch("/api/projects", { signal: controller.signal });
          if (!res.ok) return;
          const data: Project[] = await res.json();
          setProjects(data);
        } catch {
          // ignore
        }
      };
      void run();
    };
    window.addEventListener("pst:projects-changed", onProjectsChanged);
    return () =>
      window.removeEventListener("pst:projects-changed", onProjectsChanged);
  }, []);

  const startNew = () => {
    setEditing({ id: "new", name: "" });
    setDraftName("");
  };

  const startEdit = (project: Project) => {
    setEditing(project);
    setDraftName(project.name);
  };

  const saveProject = async () => {
    if (!draftName.trim() || !editing) return;
    if (editing.id === "new") {
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: draftName.trim() })
      });
      if (res.ok) {
        const created: Project = await res.json();
        setProjects((prev) => [...prev, created]);
        setEditing(null);
        notifyProjectsChanged();
      }
    } else {
      const res = await fetch(`/api/projects/${editing.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: draftName.trim() })
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
    const ok = window.confirm(
      `Delete project "${project.name}" and all its tasks?`
    );
    if (!ok) return;
    const res = await fetch(`/api/projects/${project.id}`, {
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
  };

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <h2>Projects</h2>
        <button
          className="ghost-button small"
          onClick={startNew}
          title="Create a new project (group tasks by context)."
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
              >
                ✎
              </button>
              <button
                className="icon-button"
                aria-label="Delete project"
                onClick={() => deleteProject(project)}
                title="Delete this project and all tasks in it."
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
    </aside>
  );
}

