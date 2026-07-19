import { describe, expect, it } from "vitest";
import { filterExportEntities } from "./exportEntities";

describe("filterExportEntities", () => {
  const profiles = [
    { id: "PR1", name: "Alpha" },
    { id: "PR2", name: "Beta", passwordHash: "x" },
    { id: "PR3", name: "Empty" }
  ];
  const projects = [
    { id: "P1", name: "Work", profileId: "PR1" },
    { id: "P2", name: "Home", profileId: "PR2" },
    { id: "P3", name: "Orphan", profileId: "MISSING" }
  ];
  const tasks = [
    { id: "T1", profileId: "PR1", projectId: "P1", cancelled: false },
    { id: "T2", profileId: "PR1", projectId: "P1", cancelled: true },
    { id: "T3", profileId: "PR2", projectId: "P2", cancelled: false },
    { id: "T4", profileId: "MISSING", projectId: "P1", cancelled: false }
  ];

  it("exports all profiles and cancelled tasks when nothing is denied", () => {
    const out = filterExportEntities({
      profiles,
      projects,
      tasks,
      deniedProfileIds: new Set()
    });
    expect(out.exportProfiles.map((p) => p.id).sort()).toEqual(["PR1", "PR2", "PR3"]);
    expect(out.exportProjects.map((p) => p.id).sort()).toEqual(["P1", "P2"]);
    expect(out.exportTasks.map((t) => t.id).sort()).toEqual(["T1", "T2", "T3"]);
  });

  it("excludes denied locked profiles and their projects/tasks", () => {
    const out = filterExportEntities({
      profiles,
      projects,
      tasks,
      deniedProfileIds: new Set(["PR2"])
    });
    expect(out.exportProfiles.map((p) => p.id).sort()).toEqual(["PR1", "PR3"]);
    expect(out.exportProjects.map((p) => p.id)).toEqual(["P1"]);
    expect(out.exportTasks.map((t) => t.id).sort()).toEqual(["T1", "T2"]);
  });
});
