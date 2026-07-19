import { describe, expect, it } from "vitest";
import {
  buildTaskSearchHaystack,
  matchesTaskSearchQuery,
  type SearchableTask
} from "./taskSearch";

const base = (overrides: Partial<SearchableTask> = {}): SearchableTask => ({
  id: "task-1",
  title: "Ship release notes",
  description: "Draft changelog for Q3",
  priority: "high",
  labels: ["docs", "release"],
  projectId: "proj-1",
  completed: false,
  ...overrides
});

describe("buildTaskSearchHaystack", () => {
  it("indexes core text fields", () => {
    const hay = buildTaskSearchHaystack(base());
    expect(hay).toContain("ship release notes");
    expect(hay).toContain("draft changelog");
    expect(hay).toContain("docs");
    expect(hay).toContain("high");
  });

  it("indexes project and profile names from context", () => {
    const hay = buildTaskSearchHaystack(base({ profileId: "prof-1" }), {
      projectNameById: { "proj-1": "Apollo" },
      profileNameById: { "prof-1": "Personal" }
    });
    expect(hay).toContain("apollo");
    expect(hay).toContain("personal");
    expect(hay).toContain("has-project");
  });

  it("indexes schedule, duration, reminder, and repeat", () => {
    const hay = buildTaskSearchHaystack(
      base({
        dueDate: "2026-07-19",
        dueTime: "14:30",
        deadlineDate: "2026-07-20",
        deadlineTime: "18:00",
        durationMinutes: 90,
        reminderMinutesBefore: 15,
        repeat: "weekly"
      })
    );
    expect(hay).toContain("2026-07-19");
    expect(hay).toContain("14:30");
    expect(hay).toContain("2026-07-20");
    expect(hay).toContain("90m");
    expect(hay).toContain("15m");
    expect(hay).toContain("reminder");
    expect(hay).toContain("weekly");
    expect(hay).toContain("recurring");
  });

  it("indexes custom repeat and status", () => {
    const active = buildTaskSearchHaystack(
      base({ repeat: "custom", repeatEvery: 2, repeatUnit: "week" })
    );
    expect(active).toContain("every 2 week");
    expect(active).toContain("active");

    const done = buildTaskSearchHaystack(base({ completed: true, completedAt: "2026-07-01T10:00:00Z" }));
    expect(done).toContain("completed");
    expect(done).toContain("done");

    const cancelled = buildTaskSearchHaystack(base({ cancelled: true }));
    expect(cancelled).toContain("cancelled");
  });

  it("indexes location and link aliases", () => {
    const hay = buildTaskSearchHaystack(
      base({
        location: "Office=>Berlin HQ",
        link: ["Spec=>https://example.com/spec"]
      })
    );
    expect(hay).toContain("office");
    expect(hay).toContain("berlin hq");
    expect(hay).toContain("spec");
    expect(hay).toContain("example.com/spec");
  });
});

describe("matchesTaskSearchQuery", () => {
  it("requires every token (AND)", () => {
    const task = base({ title: "Write API docs", labels: ["backend"] });
    expect(matchesTaskSearchQuery(task, "api docs")).toBe(true);
    expect(matchesTaskSearchQuery(task, "api frontend")).toBe(false);
  });

  it("matches priority, dates, and project name", () => {
    const task = base({
      priority: "urgent",
      dueDate: "2026-08-01",
      projectId: "p2"
    });
    const ctx = { projectNameById: { p2: "Mobile App" } };
    expect(matchesTaskSearchQuery(task, "urgent", ctx)).toBe(true);
    expect(matchesTaskSearchQuery(task, "2026-08-01", ctx)).toBe(true);
    expect(matchesTaskSearchQuery(task, "mobile", ctx)).toBe(true);
  });

  it("matches empty query as always true", () => {
    expect(matchesTaskSearchQuery(base(), "   ")).toBe(true);
  });
});
