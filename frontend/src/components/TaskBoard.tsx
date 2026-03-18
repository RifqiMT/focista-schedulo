import { useEffect, useRef, useState } from "react";
import { TaskEditorDrawer } from "./TaskEditorDrawer";

export interface Task {
  id: string;
  title: string;
  description?: string;
  priority: "low" | "medium" | "high" | "urgent";
  dueDate?: string;
  dueTime?: string;
  durationMinutes?: number;
  deadlineDate?: string;
  deadlineTime?: string;
  repeat?:
    | "none"
    | "daily"
    | "weekly"
    | "weekdays"
    | "weekends"
    | "monthly"
    | "quarterly"
    | "yearly"
    | "custom";
  repeatEvery?: number;
  repeatUnit?: "day" | "week" | "month" | "quarter" | "year";
  labels: string[];
  location?: string;
  reminderMinutesBefore?: number;
  projectId: string | null;
  completed: boolean;
  cancelled?: boolean;
  virtual?: boolean;
  parentId?: string;
  childId?: string;
}

type TimeScope = "all" | "today" | "week";

interface TaskBoardProps {
  selectedProjectId: string | null;
  timeScope: TimeScope;
}

function formatWithWeekday(dateStr: string | undefined): string {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return dateStr;
  const weekday = d.toLocaleDateString(undefined, { weekday: "short" });
  return `${weekday}, ${dateStr}`;
}

function getParentId(task: Task): string {
  return task.parentId ?? task.id;
}

function shortId(id: string): string {
  if (!id) return "";
  return id.length > 10 ? `${id.slice(0, 6)}…${id.slice(-3)}` : id;
}

function toISODateLocal(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function addDays(base: Date, days: number): Date {
  const d = new Date(base.getTime());
  d.setDate(d.getDate() + days);
  return d;
}

function addMonths(base: Date, months: number): Date {
  const d = new Date(base.getTime());
  const day = d.getDate();
  d.setMonth(d.getMonth() + months);
  if (d.getDate() < day) {
    d.setDate(0);
  }
  return d;
}

function nextOccurrenceDate(current: Date, task: Task): Date | null {
  const { repeat, repeatEvery, repeatUnit } = task;
  switch (repeat) {
    case "daily":
      return addDays(current, repeatEvery ?? 1);
    case "weekly":
      return addDays(current, 7 * (repeatEvery ?? 1));
    case "weekdays": {
      const d = new Date(current.getTime());
      do {
        d.setDate(d.getDate() + 1);
      } while (d.getDay() === 0 || d.getDay() === 6);
      return d;
    }
    case "weekends": {
      const d = new Date(current.getTime());
      do {
        d.setDate(d.getDate() + 1);
      } while (d.getDay() !== 0 && d.getDay() !== 6);
      return d;
    }
    case "monthly":
      return addMonths(current, repeatEvery ?? 1);
    case "quarterly":
      return addMonths(current, 3 * (repeatEvery ?? 1));
    case "yearly":
      return addMonths(current, 12 * (repeatEvery ?? 1));
    case "custom": {
      const every = repeatEvery ?? 1;
      const unit = repeatUnit ?? "day";
      switch (unit) {
        case "day":
          return addDays(current, every);
        case "week":
          return addDays(current, every * 7);
        case "month":
          return addMonths(current, every);
        case "quarter":
          return addMonths(current, every * 3);
        case "year":
          return addMonths(current, every * 12);
      }
      return null;
    }
    default:
      return null;
  }
}

function expandRepeatingTasks(base: Task[]): Task[] {
  const result: Task[] = [...base];
  const today = new Date();
  const horizon = addDays(today, 60);

  type SeriesKey = string;
  const seriesMap = new Map<SeriesKey, Task[]>();

  const seriesKeyFor = (t: Task) =>
    [
      t.projectId ?? "",
      t.title,
      t.repeat ?? "none",
      String(t.repeatEvery ?? ""),
      String(t.repeatUnit ?? "")
    ].join("::");

  const matchesSeries = (a: Task, b: Task) =>
    seriesKeyFor(a) === seriesKeyFor(b);

  for (const task of base) {
    if (!task.dueDate || !task.repeat || task.repeat === "none") continue;
    const key = seriesKeyFor(task);
    const arr = seriesMap.get(key) ?? [];
    arr.push(task);
    seriesMap.set(key, arr);
  }

  const yyyymmdd = `${today.getFullYear()}${String(
    today.getMonth() + 1
  ).padStart(2, "0")}${String(today.getDate()).padStart(2, "0")}`;

  const sortedSeriesKeys = Array.from(seriesMap.keys()).sort((a, b) =>
    a.localeCompare(b)
  );

  // Allocate series parent ids only when a series is missing them.
  const usedParentIds = new Set(
    base.map((t) => t.parentId).filter((v): v is string => !!v)
  );
  const seriesToParentId = new Map<SeriesKey, string>();
  let counter = 1;

  for (const key of sortedSeriesKeys) {
    const tasksInSeries = seriesMap.get(key) ?? [];
    const existing = tasksInSeries.find((t) => !!t.parentId)?.parentId;
    if (existing) {
      seriesToParentId.set(key, existing);
      continue;
    }

    let candidate = `${yyyymmdd}-${counter}`;
    while (usedParentIds.has(candidate)) {
      counter += 1;
      candidate = `${yyyymmdd}-${counter}`;
    }
    usedParentIds.add(candidate);
    seriesToParentId.set(key, candidate);
    counter += 1;
  }

  // Normalize ids for existing tasks in each series:
  // - parentId: stable per series (reuse if already present)
  // - childId: stable per occurrence index (only assign if missing)
  for (const [key, tasksInSeries] of seriesMap.entries()) {
    const pid = seriesToParentId.get(key);
    if (!pid) continue;

    const sortedByDue = tasksInSeries
      .slice()
      .sort((a, b) => (a.dueDate ?? "").localeCompare(b.dueDate ?? ""));

    sortedByDue.forEach((t, idx) => {
      const ri = result.findIndex((r) => r.id === t.id);
      if (ri === -1) return;

      const currentTask = result[ri];
      const finalParentId = currentTask.parentId ?? pid;
      const desiredChildId = `${finalParentId}-${idx + 1}`;

      result[ri] = {
        ...currentTask,
        parentId: finalParentId,
        childId: currentTask.childId ?? desiredChildId
      };
    });
  }

  // Generate exactly one upcoming virtual occurrence per series:
  for (const [key, tasksInSeries] of seriesMap.entries()) {
    const completed = tasksInSeries.filter((t) => t.completed && t.dueDate);
    if (completed.length === 0) continue;

    completed.sort((a, b) =>
      (a.dueDate ?? "").localeCompare(b.dueDate ?? "")
    );
    const lastCompleted = completed[completed.length - 1];
    if (!lastCompleted.dueDate) continue;

    // Use local noon to avoid DST boundary shifting the ISO day.
    const current = new Date(lastCompleted.dueDate + "T12:00:00");
    const next = nextOccurrenceDate(current, lastCompleted);
    if (!next || next > horizon) continue;

    const iso = toISODateLocal(next);

    // Do not create if a non-cancelled real task exists on that dueDate for this series.
    const realExistsOnDate = base.some(
      (other) =>
        other.dueDate === iso &&
        other.title === lastCompleted.title &&
        other.repeat === lastCompleted.repeat &&
        other.repeatEvery === lastCompleted.repeatEvery &&
        other.repeatUnit === lastCompleted.repeatUnit &&
        !other.cancelled
    );
    if (realExistsOnDate) continue;

    // Also do not create if there is already an active occurrence at/after this next date.
    const activeAtOrAfterNext = tasksInSeries.some(
      (t) =>
        !t.completed &&
        !t.cancelled &&
        t.dueDate &&
        t.dueDate >= iso &&
        matchesSeries(t, lastCompleted)
    );
    if (activeAtOrAfterNext) continue;

    const pid = seriesToParentId.get(key);
    if (!pid) continue;

    const occurrenceIndex = tasksInSeries
      .slice()
      .filter((t) => t.dueDate)
      .sort((a, b) => (a.dueDate ?? "").localeCompare(b.dueDate ?? "")).length + 1;

    result.push({
      ...lastCompleted,
      id: `${lastCompleted.id}::${iso}`,
      dueDate: iso,
      completed: false,
      virtual: true,
      parentId: pid,
      childId: `${pid}-${occurrenceIndex}`
    });
  }

  return result;
}

export function TaskBoard({ selectedProjectId, timeScope }: TaskBoardProps) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [loading, setLoading] = useState(false);
  const [completionFilter, setCompletionFilter] = useState<"all" | "active" | "completed">("active");
  const [selectedTaskIds, setSelectedTaskIds] = useState<Set<string>>(new Set());
  const [projects, setProjects] = useState<{ id: string; name: string }[]>([]);
  const [moveDialogTasks, setMoveDialogTasks] = useState<Task[] | null>(null);
  const [moveDialogProjectId, setMoveDialogProjectId] = useState<string | null>("same");
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [exportDialogOpen, setExportDialogOpen] = useState(false);
  const [exportFormat, setExportFormat] = useState<"json" | "csv">("json");
  const projectsFetchInFlight = useRef(false);
  const tasksFetchInFlight = useRef(false);
  const [viewMode, setViewMode] = useState<"list" | "calendar">("list");
  const [calendarMonthAnchor, setCalendarMonthAnchor] = useState(() => {
    const d = new Date();
    d.setDate(1);
    d.setHours(12, 0, 0, 0);
    return d;
  });
  const [selectedCalendarDayIso, setSelectedCalendarDayIso] = useState<string | null>(null);

  const notifyTasksChanged = () => {
    if (typeof window !== "undefined" && "dispatchEvent" in window) {
      window.dispatchEvent(new Event("pst:tasks-changed"));
    }
  };

  const refreshTasks = async () => {
    if (tasksFetchInFlight.current) return;
    tasksFetchInFlight.current = true;
    setLoading(true);
    const controller = new AbortController();
    try {
      const params = selectedProjectId
        ? `?projectId=${encodeURIComponent(selectedProjectId)}`
        : "";
      const res = await fetch(`/api/tasks${params}`, { signal: controller.signal });
      if (!res.ok) return;
      const data: Task[] = await res.json();
      setTasks(data);
    } catch {
      // ignore
    } finally {
      tasksFetchInFlight.current = false;
      setLoading(false);
    }
  };

  useEffect(() => {
    void refreshTasks();
  }, [selectedProjectId]);

  useEffect(() => {
    const onTasksChanged = () => void refreshTasks();
    window.addEventListener("pst:tasks-changed", onTasksChanged);
    return () => window.removeEventListener("pst:tasks-changed", onTasksChanged);
  }, [selectedProjectId]);

  useEffect(() => {
    const controller = new AbortController();
    async function loadProjects() {
      try {
        const res = await fetch("/api/projects", { signal: controller.signal });
        if (!res.ok) return;
        const data: { id: string; name: string }[] = await res.json();
        setProjects(data);
      } catch {
        // ignore
      }
    }
    loadProjects();
    return () => controller.abort();
  }, []);

  const refreshProjects = async () => {
    if (projectsFetchInFlight.current) return;
    projectsFetchInFlight.current = true;
    const controller = new AbortController();
    try {
      const res = await fetch("/api/projects", { signal: controller.signal });
      if (!res.ok) return;
      const data: { id: string; name: string }[] = await res.json();
      setProjects(data);
    } catch {
      // ignore
    } finally {
      projectsFetchInFlight.current = false;
    }
  };

  useEffect(() => {
    const onProjectsChanged = () => {
      void refreshProjects();
      // In case tasks were migrated/affected by a project operation (e.g. delete),
      // refresh tasks too so the UI stays seamless.
      void refreshTasks();
    };
    window.addEventListener("pst:projects-changed", onProjectsChanged);
    return () =>
      window.removeEventListener("pst:projects-changed", onProjectsChanged);
  }, []);

  // Self-heal: if tasks reference a projectId we don't know, refetch projects immediately.
  useEffect(() => {
    const known = new Set(projects.map((p) => p.id));
    const hasUnknown = tasks.some((t) => t.projectId && !known.has(t.projectId));
    if (hasUnknown) {
      void refreshProjects();
    }
  }, [tasks, projects]);

  // Seamless sync: when returning to the tab/window, refresh data.
  useEffect(() => {
    const onFocus = () => {
      void refreshProjects();
      void refreshTasks();
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") onFocus();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [selectedProjectId]);

  const downloadBlob = (filename: string, blob: Blob) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const csvCell = (value: unknown) => {
    const s =
      value === null || value === undefined
        ? ""
        : typeof value === "string"
          ? value
          : String(value);
    const escaped = s.replaceAll('"', '""');
    return /[",\n\r]/.test(escaped) ? `"${escaped}"` : escaped;
  };

  const exportAllData = async (format: "json" | "csv") => {
    const [tasksRes, projectsRes] = await Promise.all([
      fetch("/api/tasks"),
      fetch("/api/projects")
    ]);
    if (!tasksRes.ok || !projectsRes.ok) return;
    const allTasks: Task[] = await tasksRes.json();
    const allProjects: { id: string; name: string }[] = await projectsRes.json();

    const now = new Date();
    const stamp = [
      now.getFullYear(),
      String(now.getMonth() + 1).padStart(2, "0"),
      String(now.getDate()).padStart(2, "0"),
      "-",
      String(now.getHours()).padStart(2, "0"),
      String(now.getMinutes()).padStart(2, "0")
    ].join("");

    if (format === "json") {
      const payload = {
        app: "focista-schedulo",
        exportedAt: now.toISOString(),
        projects: allProjects,
        tasks: allTasks
      };
      downloadBlob(
        `pst-export-${stamp}.json`,
        new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" })
      );
      return;
    }

    // Single CSV file containing both projects and tasks.
    // Projects use recordType=project; tasks use recordType=task.
    const projectNameById = new Map(allProjects.map((p) => [p.id, p.name]));
    const headers = [
      "recordType",
      // shared-ish
      "id",
      "projectId",
      "projectName",
      // project fields
      "projectNameOnly",
      // task fields
      "title",
      "description",
      "priority",
      "dueDate",
      "dueTime",
      "deadlineDate",
      "deadlineTime",
      "repeat",
      "repeatEvery",
      "repeatUnit",
      "labels",
      "location",
      "reminderMinutesBefore",
      "completed",
      "cancelled",
      "parentId",
      "childId"
    ];

    const rows: string[] = [];
    rows.push(headers.map(csvCell).join(","));

    for (const p of allProjects) {
      const row: Record<string, unknown> = {
        recordType: "project",
        id: p.id,
        projectId: p.id,
        projectName: p.name,
        projectNameOnly: p.name
      };
      rows.push(headers.map((h) => csvCell(row[h])).join(","));
    }

    for (const t of allTasks) {
      const row: Record<string, unknown> = {
        recordType: "task",
        id: t.id,
        projectId: t.projectId ?? "",
        projectName: t.projectId ? projectNameById.get(t.projectId) ?? "" : "",
        title: t.title,
        description: t.description ?? "",
        priority: t.priority,
        dueDate: t.dueDate ?? "",
        dueTime: t.dueTime ?? "",
        deadlineDate: t.deadlineDate ?? "",
        deadlineTime: t.deadlineTime ?? "",
        repeat: t.repeat ?? "none",
        repeatEvery: t.repeatEvery ?? "",
        repeatUnit: t.repeatUnit ?? "",
        labels: (t.labels ?? []).join("|"),
        location: t.location ?? "",
        reminderMinutesBefore:
          t.reminderMinutesBefore !== undefined ? t.reminderMinutesBefore : "",
        completed: t.completed,
        cancelled: t.cancelled ?? false,
        parentId: t.parentId ?? "",
        childId: t.childId ?? ""
      };
      rows.push(headers.map((h) => csvCell(row[h])).join(","));
    }

    downloadBlob(
      `pst-export-${stamp}.csv`,
      new Blob([rows.join("\n")], { type: "text/csv;charset=utf-8" })
    );
  };

  const activeBaseTasks = tasks.filter((t) => !t.cancelled);
  const tasksWithRepeats = expandRepeatingTasks(activeBaseTasks);

  const todayIso = new Date().toISOString().slice(0, 10);
  const oneWeekAheadIso = (() => {
    const d = new Date();
    d.setDate(d.getDate() + 7);
    return d.toISOString().slice(0, 10);
  })();

  const filteredTasks = tasksWithRepeats
    .filter((t) => {
    if (completionFilter === "active" && t.completed) return false;
    if (completionFilter === "completed" && !t.completed) return false;
    if (selectedProjectId && t.projectId !== selectedProjectId) return false;
    if (!t.dueDate || timeScope === "all") return true;
    if (timeScope === "today") {
      return t.dueDate === todayIso;
    }
    if (timeScope === "week") {
      return t.dueDate >= todayIso && t.dueDate <= oneWeekAheadIso;
    }
    return true;
    })
    .slice()
    .sort((a, b) => (a.dueDate ?? "").localeCompare(b.dueDate ?? ""));

  const materializeVirtualTask = async (task: Task): Promise<Task | null> => {
    if (!task.virtual) return task;
    if (!task.dueDate) return null;

    const res = await fetch("/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: task.title,
        description: task.description,
        priority: task.priority,
        dueDate: task.dueDate,
        dueTime: task.dueTime,
        durationMinutes: task.durationMinutes,
        deadlineDate: task.deadlineDate,
        deadlineTime: task.deadlineTime,
        repeat: task.repeat ?? "none",
        repeatEvery: task.repeatEvery,
        repeatUnit: task.repeatUnit,
        labels: task.labels,
        location: task.location,
        reminderMinutesBefore: task.reminderMinutesBefore,
        projectId: task.projectId,
        parentId: task.parentId,
        childId: task.childId
      })
    });
    if (!res.ok) return null;
    const created: Task = await res.json();
    setTasks((prev) => [...prev, created]);
    return created;
  };

  const toggleComplete = (task: Task) => {
    const update = async () => {
      let target = task;
      if (task.virtual) {
        const created = await materializeVirtualTask(task);
        if (!created) return;
        target = created;
      }
      setTasks((prev) =>
        prev.map((t) =>
          t.id === target.id ? { ...t, completed: !t.completed } : t
        )
      );
      await fetch(`/api/tasks/${target.id}/complete`, { method: "PATCH" });
      notifyTasksChanged();
    };
    void update();
  };

  const deleteTask = (task: Task) => {
    const run = async () => {
      let target = task;
      if (task.virtual) {
        const created = await materializeVirtualTask(task);
        if (!created) return;
        target = created;
      }
      if (target.repeat && target.repeat !== "none") {
        const seriesKey = (t: Task) =>
          t.title === target.title &&
          t.repeat === target.repeat &&
          t.projectId === target.projectId;

        const seriesMembers = tasks.filter(seriesKey);

        await Promise.all(
          seriesMembers.map((member) =>
            fetch(`/api/tasks/${member.id}`, {
              method: "DELETE"
            })
          )
        );

        setTasks((prev) => prev.filter((t) => !seriesKey(t)));
      } else {
        const res = await fetch(`/api/tasks/${target.id}`, {
          method: "DELETE"
        });
        if (!res.ok && res.status !== 204) return;
        setTasks((prev) => prev.filter((t) => t.id !== target.id));
      }
      notifyTasksChanged();
    };
    void run();
  };

  const toggleSelect = (taskId: string) => {
    setSelectedTaskIds((prev) => {
      const next = new Set(prev);
      if (next.has(taskId)) {
        next.delete(taskId);
      } else {
        next.add(taskId);
      }
      return next;
    });
  };

  const deleteSelected = () => {
    const run = async () => {
      const ids = Array.from(selectedTaskIds);
      if (!ids.length) return;
      const ok = window.confirm(
        `Delete ${ids.length} selected task${ids.length > 1 ? "s" : ""}?`
      );
      if (!ok) return;
      const tasksToDelete = tasksWithRepeats.filter((t) =>
        selectedTaskIds.has(t.id)
      );
      await Promise.all(tasksToDelete.map((t) => deleteTask(t)));
      setSelectedTaskIds(new Set());
    };
    void run();
  };
  const moveTasks = (tasksToMove: Task[]) => {
    if (!tasksToMove.length) return;
    setMoveDialogTasks(tasksToMove);
    setMoveDialogProjectId("same");
  };

  const confirmMove = () => {
    if (!moveDialogTasks) return;
    const run = async () => {
      let targetProjectId: string | null = null;
      if (moveDialogProjectId === "same") {
        targetProjectId = moveDialogTasks[0]?.projectId ?? null;
      } else {
        targetProjectId = moveDialogProjectId;
      }

      const materialized: Task[] = [];
      for (const task of moveDialogTasks) {
        if (task.virtual) {
          const created = await materializeVirtualTask(task);
          if (created) {
            materialized.push(created);
          }
        } else {
          materialized.push(task);
        }
      }

      const seriesMembers: Task[] = [];
      for (const base of materialized) {
        const originalProjectId = base.projectId;
        const keyMatches = (t: Task) =>
          t.title === base.title &&
          t.repeat === base.repeat &&
          t.projectId === originalProjectId &&
          t.repeatEvery === base.repeatEvery &&
          t.repeatUnit === base.repeatUnit;
        tasks.forEach((t) => {
          if (keyMatches(t)) {
            seriesMembers.push(t);
          }
        });
      }

      const uniqueSeriesMembers = Array.from(
        new Map(seriesMembers.map((t) => [t.id, t])).values()
      );

      await Promise.all(
        uniqueSeriesMembers.map((task) =>
          fetch(`/api/tasks/${task.id}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ...task, projectId: targetProjectId })
          })
        )
      );

      setTasks((prev) =>
        prev.map((t) => {
          const match = uniqueSeriesMembers.find((m) => m.id === t.id);
          if (!match) return t;
          return { ...t, projectId: targetProjectId };
        })
      );
      setSelectedTaskIds(new Set());
      setMoveDialogTasks(null);
      notifyTasksChanged();
    };
    void run();
  };

  const moveSelected = () => {
    const tasksToMove = tasksWithRepeats.filter((t) =>
      selectedTaskIds.has(t.id)
    );
    moveTasks(tasksToMove);
  };

  let groupedCompleted:
    | {
        key: string;
        representative: Task;
        count: number;
        items: Task[];
      }[]
    | null = null;

  if (completionFilter === "completed") {
    const compareDueDateDesc = (a: Task, b: Task) => {
      // Put tasks with missing dueDate at the bottom.
      if (!a.dueDate && !b.dueDate) return 0;
      if (!a.dueDate) return 1;
      if (!b.dueDate) return -1;
      return b.dueDate.localeCompare(a.dueDate);
    };

    const map = new Map<
      string,
      {
        representative: Task;
        count: number;
        items: Task[];
      }
    >();

    for (const task of filteredTasks) {
      const key = getParentId(task);
      const existing = map.get(key);
      if (!existing) {
        map.set(key, { representative: task, count: 1, items: [task] });
      } else {
        existing.count += 1;
        existing.items.push(task);
      }
    }

    groupedCompleted = Array.from(map.entries())
      .map(([key, value]) => ({
        key,
        representative: value.representative,
        count: value.count,
        items: value.items.slice().sort(compareDueDateDesc)
      }))
      .sort((a, b) => a.key.localeCompare(b.key));
  }

  const renderTaskRow = (task: Task, opts?: { showChildId?: boolean }) => {
    const showChildId = opts?.showChildId ?? false;
    const idLabel = showChildId ? "Child ID" : "Parent ID";
    const idValue = showChildId
      ? shortId(task.childId ?? task.id)
      : shortId(getParentId(task));

    return (
    <article
      key={task.id}
      className={`task-card ${task.completed ? "task-card-completed" : ""}`}
      onClick={() => {
        const open = async () => {
          if (!task.virtual) {
            setEditingTask(task);
            return;
          }
          const created = await materializeVirtualTask(task);
          if (created) {
            setEditingTask(created);
            notifyTasksChanged();
          }
        };
        void open();
      }}
    >
      <div className="task-main">
        <label
          className="task-checkbox"
          onClick={(e) => {
            e.stopPropagation();
            toggleSelect(task.id);
          }}
        >
          <input
            type="checkbox"
            checked={selectedTaskIds.has(task.id)}
            onChange={() => toggleSelect(task.id)}
          />
          <span />
        </label>
        <div className="task-main-inner">
          <div>
            <div className="task-title">{task.title}</div>
            {task.description && (
              <div className="task-description">{task.description}</div>
            )}
            <div className="task-meta-row">
              {task.dueDate && (
                <span className="pill subtle">
                  Due {formatWithWeekday(task.dueDate)}{" "}
                  {task.dueTime && `• ${task.dueTime}`}
                </span>
              )}
              {task.durationMinutes !== undefined && (
                <span className="pill subtle">
                  Duration{" "}
                  {(() => {
                    const mins = task.durationMinutes ?? 0;
                    const days = Math.floor(mins / 1440);
                    const remAfterDays = mins % 1440;
                    const hours = Math.floor(remAfterDays / 60);
                    const remMins = remAfterDays % 60;
                    const parts: string[] = [];
                    if (days) parts.push(`${days}d`);
                    if (hours) parts.push(`${hours}h`);
                    if (remMins || parts.length === 0) parts.push(`${remMins}m`);
                    return parts.join(" ");
                  })()}
                </span>
              )}
              {task.deadlineDate && (
                <span className="pill subtle">
                  Deadline {formatWithWeekday(task.deadlineDate)}{" "}
                  {task.deadlineTime && `• ${task.deadlineTime}`}
                </span>
              )}
              {task.priority && (
                <span className={`pill priority-${task.priority}`}>
                  {task.priority.toUpperCase()}
                </span>
              )}
              {task.repeat && task.repeat !== "none" && (
                <span className="pill subtle">
                  {task.repeat === "custom"
                    ? `Every ${task.repeatEvery ?? 1} ${task.repeatUnit ?? "week"}(s)`
                    : `Repeats ${task.repeat}`}
                </span>
              )}
              <span className="pill subtle">
                Project:{" "}
                {task.projectId
                  ? projects.find((p) => p.id === task.projectId)?.name ??
                    "Project"
                  : "All tasks"}
              </span>
              <span className="pill subtle">
                {idLabel}: {idValue}
              </span>
              {task.labels.map((label) => (
                <span key={label} className="pill label-pill">
                  {label}
                </span>
              ))}
                    {task.virtual && (
                      <span className="pill subtle">Upcoming occurrence</span>
                    )}
            </div>
          </div>
          <div className="task-actions">
            <button
              className="task-action-button"
              aria-label="Mark complete / active"
              onClick={(e) => {
                e.stopPropagation();
                toggleComplete(task);
              }}
            >
              {task.completed ? "Mark active" : "Complete"}
            </button>
            <button
              className="task-action-button"
              aria-label="Move to another project"
              onClick={(e) => {
                e.stopPropagation();
                moveTasks([task]);
              }}
            >
              Move
            </button>
            <button
              className="task-action-button"
              aria-label="Delete task"
              onClick={(e) => {
                e.stopPropagation();
                deleteTask(task);
              }}
            >
              Delete
            </button>
          </div>
        </div>
      </div>
    </article>
    );
  };

  const openTask = (task: Task) => {
    const run = async () => {
      if (!task.virtual) {
        setEditingTask(task);
        return;
      }
      const created = await materializeVirtualTask(task);
      if (created) {
        setEditingTask(created);
        notifyTasksChanged();
      }
    };
    void run();
  };

  const monthLabel = (d: Date) =>
    d.toLocaleDateString(undefined, { month: "long", year: "numeric" });

  const startOfCalendarGrid = (anchor: Date) => {
    const first = new Date(anchor.getTime());
    first.setDate(1);
    const day = first.getDay(); // 0=Sun
    const start = new Date(first.getTime());
    start.setDate(first.getDate() - day);
    start.setHours(12, 0, 0, 0);
    return start;
  };

  const addDaysLocal = (d: Date, days: number) => {
    const next = new Date(d.getTime());
    next.setDate(next.getDate() + days);
    return next;
  };

  const tasksForCalendar = tasksWithRepeats.filter((t) => {
    if (completionFilter === "completed") return t.completed;
    if (completionFilter === "active") return !t.completed;
    return true;
  });

  type CalendarEntry = {
    dateIso: string;
    startMin: number; // minutes since midnight on dateIso
    endMin: number; // minutes since midnight on dateIso (can be 1440)
    isAllDay: boolean;
    startsToday: boolean;
    task: Task;
  };

  const tasksByDate = (() => {
    const map = new Map<string, CalendarEntry[]>();

    const minutesSinceMidnight = (d: Date) => d.getHours() * 60 + d.getMinutes();
    const startOfDayLocal = (d: Date) => {
      const x = new Date(d.getTime());
      x.setHours(0, 0, 0, 0);
      return x;
    };
    const clamp = (n: number, min: number, max: number) =>
      Math.max(min, Math.min(max, n));

    for (const t of tasksForCalendar) {
      if (!t.dueDate) continue;
      const hasTime = !!t.dueTime;
      const duration =
        t.durationMinutes !== undefined
          ? t.durationMinutes
          : hasTime
            ? 30
            : 1440;

      const start = new Date(`${t.dueDate}T${t.dueTime ?? "00:00"}:00`);
      const endRaw = new Date(start.getTime() + Math.max(1, duration) * 60_000);
      // If an event ends exactly at midnight, treat it as ending in the previous day
      // to avoid creating a zero-length segment on the next day.
      const end =
        endRaw.getHours() === 0 &&
        endRaw.getMinutes() === 0 &&
        endRaw.getSeconds() === 0 &&
        endRaw.getMilliseconds() === 0
          ? new Date(endRaw.getTime() - 1)
          : endRaw;

      let cursor = startOfDayLocal(start);
      const endDay = startOfDayLocal(end);
      const startDayMs = cursor.getTime();

      while (cursor.getTime() <= endDay.getTime()) {
        const dayStart = new Date(cursor.getTime());
        const dayEnd = new Date(cursor.getTime());
        dayEnd.setDate(dayEnd.getDate() + 1);

        const segStart = start.getTime() > dayStart.getTime() ? start : dayStart;
        const segEnd = end.getTime() < dayEnd.getTime() ? end : dayEnd;

        const startMin = clamp(minutesSinceMidnight(segStart), 0, 1440);
        const endMin =
          segEnd.getTime() === dayEnd.getTime()
            ? 1440
            : clamp(minutesSinceMidnight(segEnd), 0, 1440);

        const dayIso = toISODateLocal(new Date(dayStart.getTime() + 12 * 60 * 60 * 1000));
        const isAllDay = !hasTime && startMin === 0 && endMin === 1440;

        const arr = map.get(dayIso) ?? [];
        arr.push({
          dateIso: dayIso,
          startMin,
          endMin,
          isAllDay,
          startsToday: dayStart.getTime() === startDayMs,
          task: t
        });
        map.set(dayIso, arr);

        cursor = addDaysLocal(cursor, 1);
      }
    }

    for (const [k, arr] of map.entries()) {
      arr.sort((a, b) => {
        if (a.isAllDay !== b.isAllDay) return a.isAllDay ? -1 : 1;
        const byStart = a.startMin - b.startMin;
        if (byStart !== 0) return byStart;
        return a.task.title.localeCompare(b.task.title);
      });
      map.set(k, arr);
    }

    return map;
  })();

  const minutesFromTime = (time: string | undefined): number | null => {
    if (!time) return null;
    const m = time.match(/^(\d{1,2}):(\d{2})$/);
    if (!m) return null;
    const hh = Number(m[1]);
    const mm = Number(m[2]);
    if (!Number.isFinite(hh) || !Number.isFinite(mm)) return null;
    return hh * 60 + mm;
  };

  const renderDayAgenda = (dayIso: string) => {
    const items = (tasksByDate.get(dayIso) ?? []).slice();
    const allDay = items.filter((e) => e.isAllDay);
    const timed = items.filter((e) => !e.isAllDay);

    const startMinutesList = timed.map((e) => e.startMin);
    const endMinutesList = timed.map((e) => e.endMin);

    const minM = startMinutesList.length ? Math.min(...startMinutesList) : 9 * 60;
    const maxM = endMinutesList.length ? Math.max(...endMinutesList) : 17 * 60;
    const startHour = Math.max(0, Math.min(9, Math.floor(minM / 60) - 1));
    const endHour = Math.min(23, Math.max(17, Math.floor(maxM / 60) + 2));
    const startMinutes = startHour * 60;
    const totalMinutes = (endHour - startHour + 1) * 60;
    const pxPerMin = 1.1;

    const dayLabel = (() => {
      const d = new Date(dayIso + "T12:00:00");
      const weekday = d.toLocaleDateString(undefined, { weekday: "long" });
      const month = d.toLocaleDateString(undefined, { month: "long" });
      return `${weekday}, ${d.getDate()} ${month} ${d.getFullYear()}`;
    })();

    const nowLineTop = (() => {
      const todayIso = (() => {
        const d = new Date();
        d.setHours(12, 0, 0, 0);
        return toISODateLocal(d);
      })();
      if (dayIso !== todayIso) return null;
      const now = new Date();
      const nowM = now.getHours() * 60 + now.getMinutes();
      if (nowM < startMinutes || nowM > startMinutes + totalMinutes) return null;
      return (nowM - startMinutes) * pxPerMin;
    })();

    return (
      <div className="day-agenda">
        <div className="day-agenda-header">
          <div>
            <div className="day-agenda-title">{dayLabel}</div>
            <div className="muted">
              {selectedProjectId ? "Project filtered" : "All projects"} •{" "}
              {items.length} task{items.length === 1 ? "" : "s"}
            </div>
          </div>
          <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
            <button
              className="ghost-button"
              onClick={() => {
                setEditingTask({
                  id: "new",
                  title: "",
                  description: "",
                  priority: "medium",
                  labels: [],
                  projectId: selectedProjectId,
                  completed: false,
                  dueDate: dayIso
                } as Task);
              }}
            >
              Add task
            </button>
            <button
              className="ghost-button"
              onClick={() => setSelectedCalendarDayIso(null)}
            >
              Close
            </button>
          </div>
        </div>

        {allDay.length > 0 && (
          <div className="day-agenda-allday">
            <div className="day-agenda-allday-label">All day</div>
            <div className="day-agenda-allday-items">
              {allDay.map((e) => (
                <button
                  key={`${e.task.id}::${e.dateIso}::allday`}
                  className={`day-agenda-chip priority-${e.task.priority}`}
                  onClick={() => openTask(e.task)}
                >
                  {e.task.title}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="day-agenda-grid">
          <div className="day-agenda-times">
            {Array.from({ length: endHour - startHour + 1 }, (_, i) => {
              const h = startHour + i;
              const label = `${String(h).padStart(2, "0")}:00`;
              return (
                <div key={label} className="day-agenda-time">
                  {label}
                </div>
              );
            })}
          </div>

          <div
            className="day-agenda-track"
            style={{ height: `${totalMinutes * pxPerMin}px` }}
            onClick={(e) => {
              const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
              const y = e.clientY - rect.top;
              const mins = Math.max(0, Math.min(totalMinutes - 1, Math.round(y / pxPerMin)));
              const hh = Math.floor((startMinutes + mins) / 60);
              const mm = (startMinutes + mins) % 60;
              const time = `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
              setEditingTask({
                id: "new",
                title: "",
                description: "",
                priority: "medium",
                labels: [],
                projectId: selectedProjectId,
                completed: false,
                dueDate: dayIso,
                dueTime: time
              } as Task);
            }}
            role="button"
            tabIndex={0}
          >
            {Array.from({ length: endHour - startHour + 1 }, (_, i) => (
              <div
                key={i}
                className="day-agenda-hour-line"
                style={{ top: `${i * 60 * pxPerMin}px` }}
              />
            ))}

            {nowLineTop !== null && (
              <div
                className="day-agenda-nowline"
                style={{ top: `${nowLineTop}px` }}
                aria-hidden="true"
              />
            )}

            {timed.map((e) => {
              const startM = e.startMin;
              const endM = e.endMin;
              const top = (startM - startMinutes) * pxPerMin;
              const durMins = Math.max(1, endM - startM);
              const maxHeight = Math.max(28, totalMinutes * pxPerMin - top - 2);
              const height = Math.max(28, Math.min(maxHeight, durMins * pxPerMin));
              const startLabel = `${String(Math.floor(startM / 60)).padStart(2, "0")}:${String(
                startM % 60
              ).padStart(2, "0")}`;
              const endLabel =
                endM === 1440
                  ? "24:00"
                  : `${String(Math.floor(endM / 60)).padStart(2, "0")}:${String(
                      endM % 60
                    ).padStart(2, "0")}`;
              return (
                <button
                  key={`${e.task.id}::${e.dateIso}::${startM}-${endM}`}
                  className={`day-agenda-event priority-${e.task.priority}`}
                  style={{ top: `${top}px`, height: `${height}px` }}
                  onClick={(ev) => {
                    ev.stopPropagation();
                    openTask(e.task);
                  }}
                  title={`${e.task.title} • ${startLabel}–${endLabel}`}
                >
                  <div className="day-agenda-event-title">{e.task.title}</div>
                  <div className="day-agenda-event-sub">
                    {startLabel} – {endLabel}
                    {!e.startsToday ? " (continues)" : ""}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    );
  };

  const renderCalendar = () => {
    const gridStart = startOfCalendarGrid(calendarMonthAnchor);
    const days: Date[] = Array.from({ length: 42 }, (_, i) =>
      addDaysLocal(gridStart, i)
    );
    const anchorMonth = calendarMonthAnchor.getMonth();
    const todayIsoLocal = (() => {
      const d = new Date();
      d.setHours(12, 0, 0, 0);
      return toISODateLocal(d);
    })();

    const weekdayLabels = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

    return (
      <div className="calendar-shell">
        <div className="calendar-header">
          <div className="calendar-month">
            <button
              className="ghost-button small"
              onClick={() => {
                const d = new Date(calendarMonthAnchor.getTime());
                d.setMonth(d.getMonth() - 1);
                setCalendarMonthAnchor(d);
              }}
            >
              ←
            </button>
            <div className="calendar-month-label">{monthLabel(calendarMonthAnchor)}</div>
            <button
              className="ghost-button small"
              onClick={() => {
                const d = new Date(calendarMonthAnchor.getTime());
                d.setMonth(d.getMonth() + 1);
                setCalendarMonthAnchor(d);
              }}
            >
              →
            </button>
          </div>
          <button
            className="ghost-button"
            onClick={() => {
              const d = new Date();
              d.setDate(1);
              d.setHours(12, 0, 0, 0);
              setCalendarMonthAnchor(d);
            }}
          >
            Today
          </button>
        </div>

        <div className="calendar-grid">
          {weekdayLabels.map((w) => (
            <div key={w} className="calendar-weekday">
              {w}
            </div>
          ))}
          {days.map((d) => {
            const iso = toISODateLocal(d);
            const inMonth = d.getMonth() === anchorMonth;
            const isToday = iso === todayIsoLocal;
            const dayTasks = tasksByDate.get(iso) ?? [];
            return (
              <div
                key={iso}
                className={`calendar-cell ${inMonth ? "" : "calendar-cell-out"} ${
                  isToday ? "calendar-cell-today" : ""
                }`}
                onClick={() => {
                  setSelectedCalendarDayIso(iso);
                }}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    setSelectedCalendarDayIso(iso);
                  }
                }}
              >
                <div className="calendar-cell-top">
                  <div className="calendar-day">{d.getDate()}</div>
                  {dayTasks.length > 0 && (
                    <span className="pill subtle">{dayTasks.length}</span>
                  )}
                </div>
                <div className="calendar-items">
                  {dayTasks.slice(0, 4).map((e) => (
                    <button
                      key={`${e.task.id}::${e.dateIso}::${e.startMin}-${e.endMin}`}
                      className={`calendar-item priority-${e.task.priority}`}
                      onClick={(ev) => {
                        ev.stopPropagation();
                        openTask(e.task);
                      }}
                      title={`${e.task.title}${
                        e.isAllDay
                          ? " • All day"
                          : ` • ${String(Math.floor(e.startMin / 60)).padStart(2, "0")}:${String(
                              e.startMin % 60
                            ).padStart(2, "0")}`
                      }`}
                    >
                      <span className="calendar-item-time">
                        {e.isAllDay
                          ? "All day"
                          : `${String(Math.floor(e.startMin / 60)).padStart(2, "0")}:${String(
                              e.startMin % 60
                            ).padStart(2, "0")}`}
                      </span>
                      <span className="calendar-item-title">
                        {e.task.title}
                        {!e.startsToday ? " ↪" : ""}
                      </span>
                    </button>
                  ))}
                  {dayTasks.length > 4 && (
                    <div className="calendar-more muted">
                      +{dayTasks.length - 4} more
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {selectedCalendarDayIso && renderDayAgenda(selectedCalendarDayIso)}
      </div>
    );
  };

  return (
    <section className="task-board">
      <div className="board-header">
        <div>
          <h2>Tasks</h2>
          <p className="muted">
            Capture title, priority, reminders, labels, locations, and more.
          </p>
        </div>
        <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
          <div className="task-filter-group">
            <button
              className={`pill subtle ${
                viewMode === "list" ? "task-filter-active" : ""
              }`}
              onClick={() => setViewMode("list")}
            >
              List
            </button>
            <button
              className={`pill subtle ${
                viewMode === "calendar" ? "task-filter-active" : ""
              }`}
              onClick={() => setViewMode("calendar")}
            >
              Calendar
            </button>
          </div>
          <div className="task-filter-group">
            <button
              className={`pill subtle ${
                completionFilter === "all" ? "task-filter-active" : ""
              }`}
              onClick={() => setCompletionFilter("all")}
            >
              All
            </button>
            <button
              className={`pill subtle ${
                completionFilter === "active" ? "task-filter-active" : ""
              }`}
              onClick={() => setCompletionFilter("active")}
            >
              Active
            </button>
            <button
              className={`pill subtle ${
                completionFilter === "completed" ? "task-filter-active" : ""
              }`}
              onClick={() => setCompletionFilter("completed")}
            >
              Completed
            </button>
          </div>
          {selectedTaskIds.size > 0 && (
            <>
              <button className="ghost-button" onClick={moveSelected}>
                Move selected
              </button>
              <button className="ghost-button" onClick={deleteSelected}>
                Delete selected
              </button>
            </>
          )}
          <button className="ghost-button" onClick={() => setExportDialogOpen(true)}>
            Export
          </button>
          <button
            className="primary-button"
            onClick={() =>
              setEditingTask({
                id: "new",
                title: "",
                description: "",
                priority: "medium",
                labels: [],
                projectId: selectedProjectId,
                completed: false
              } as Task)
            }
          >
            Add task
          </button>
        </div>
      </div>

      <div className="task-list">
        {loading && <p className="muted">Loading tasks…</p>}
        {!loading && viewMode === "calendar" && renderCalendar()}
        {!loading && viewMode === "list" && completionFilter !== "completed" &&
          filteredTasks.map((task) => renderTaskRow(task))}
        {!loading && viewMode === "list" && completionFilter === "completed" && groupedCompleted &&
          groupedCompleted.map(({ key, representative, count, items }) => (
            <div key={key}>
              <article className="task-card task-card-completed">
                <div className="task-main-inner">
                  <div>
                    <div className="task-title">{representative.title}</div>
                    <div className="task-meta-row">
                      {representative.projectId && (
                        <span className="pill subtle">
                          {projects.find((p) => p.id === representative.projectId)?.name ??
                            "Project"}
                        </span>
                      )}
                      <span className="pill subtle">
                        Parent ID: {shortId(getParentId(representative))}
                      </span>
                      {items.some((t) => t.durationMinutes !== undefined) && (
                        <span className="pill subtle">
                          Duration{" "}
                          {(() => {
                            const mins =
                              items.find((t) => t.durationMinutes !== undefined)
                                ?.durationMinutes ?? 0;
                            return mins >= 60
                              ? `${Math.floor(mins / 60)}h${
                                  mins % 60 ? ` ${mins % 60}m` : ""
                                }`
                              : `${mins}m`;
                          })()}
                        </span>
                      )}
                      {representative.repeat && representative.repeat !== "none" && (
                        <span className="pill subtle">
                          Repeats {representative.repeat}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="task-actions">
                    <button
                      className="task-action-button"
                      onClick={() => {
                        setExpandedGroups((prev) => {
                          const next = new Set(prev);
                          if (next.has(key)) {
                            next.delete(key);
                          } else {
                            next.add(key);
                          }
                          return next;
                        });
                      }}
                    >
                      {expandedGroups.has(key) ? "Hide" : "Show"} details
                    </button>
                    <span className="pill subtle">{count} completed</span>
                  </div>
                </div>
              </article>
              {expandedGroups.has(key) && (
                <div className="completed-group-details">
                  {items.map((item) => renderTaskRow(item, { showChildId: true }))}
                </div>
              )}
            </div>
          ))}
        {!loading && filteredTasks.length === 0 && (
          <div className="empty-state">
            <h3>No tasks yet</h3>
            <p className="muted">
              Start by creating a task with a title, priority, and reminder.
            </p>
          </div>
        )}
      </div>

      <TaskEditorDrawer
        task={editingTask}
        onClose={() => setEditingTask(null)}
        onSave={(updated) => {
          const save = async () => {
            if (updated.id === "new") {
              const res = await fetch("/api/tasks", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  title: updated.title,
                  description: updated.description,
                  priority: updated.priority,
                  dueDate: updated.dueDate,
                  dueTime: updated.dueTime,
                  durationMinutes: updated.durationMinutes,
                  deadlineDate: updated.deadlineDate,
                  deadlineTime: updated.deadlineTime,
                  repeat: updated.repeat ?? "none",
                  repeatEvery: updated.repeatEvery,
                  repeatUnit: updated.repeatUnit,
                  labels: updated.labels,
                  location: updated.location,
                  reminderMinutesBefore: updated.reminderMinutesBefore,
                  projectId: updated.projectId,
                  parentId: updated.parentId,
                  childId: updated.childId
                })
              });
              if (res.ok) {
                const created: Task = await res.json();
                setTasks((prev) => [...prev, created]);
                notifyTasksChanged();
              }
            } else {
              const res = await fetch(`/api/tasks/${updated.id}`, {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(updated)
              });
              if (res.ok) {
                const saved: Task = await res.json();
                setTasks((prev) =>
                  prev.map((t) => (t.id === saved.id ? saved : t))
                );
                notifyTasksChanged();
              }
            }
            setEditingTask(null);
          };
          void save();
        }}
      />
      {moveDialogTasks && (
        <div className="drawer-backdrop" onClick={() => setMoveDialogTasks(null)}>
          <aside
            className="drawer"
            onClick={(e) => e.stopPropagation()}
          >
            <header className="drawer-header">
              <h2>Move {moveDialogTasks.length} task{moveDialogTasks.length > 1 ? "s" : ""}</h2>
            </header>
            <div className="drawer-body">
              <label className="field">
                <span>Destination project</span>
                <select
                  value={moveDialogProjectId ?? "none"}
                  onChange={(e) =>
                    setMoveDialogProjectId(
                      e.target.value === "none"
                        ? null
                        : e.target.value === "same"
                          ? "same"
                          : e.target.value
                    )
                  }
                >
                  <option value="same">Keep current project</option>
                  <option value="none">(none) – All tasks</option>
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <footer className="drawer-footer">
              <button
                className="ghost-button"
                onClick={() => setMoveDialogTasks(null)}
              >
                Cancel
              </button>
              <button
                className="primary-button"
                onClick={confirmMove}
              >
                Move
              </button>
            </footer>
          </aside>
        </div>
      )}
      {exportDialogOpen && (
        <div className="drawer-backdrop" onClick={() => setExportDialogOpen(false)}>
          <aside className="drawer" onClick={(e) => e.stopPropagation()}>
            <header className="drawer-header">
              <h2>Export data</h2>
            </header>
            <div className="drawer-body">
              <label className="field">
                <span>Format</span>
                <select
                  value={exportFormat}
                  onChange={(e) =>
                    setExportFormat(e.target.value as "json" | "csv")
                  }
                >
                  <option value="json">JSON (recommended)</option>
                  <option value="csv">CSV</option>
                </select>
              </label>
              <p className="muted" style={{ marginTop: "0.5rem" }}>
                Exports all projects and tasks in a single file.
              </p>
            </div>
            <footer className="drawer-footer">
              <button className="ghost-button" onClick={() => setExportDialogOpen(false)}>
                Cancel
              </button>
              <button
                className="primary-button"
                onClick={() => {
                  const run = async () => {
                    await exportAllData(exportFormat);
                    setExportDialogOpen(false);
                  };
                  void run();
                }}
              >
                Download
              </button>
            </footer>
          </aside>
        </div>
      )}
    </section>
  );
}

