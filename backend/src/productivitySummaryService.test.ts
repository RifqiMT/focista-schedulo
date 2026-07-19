import { afterEach, describe, expect, it } from "vitest";
import {
  PeriodRangeError,
  assessAiKeyFormat,
  buildLocalAskAnswer,
  buildLocalDigestBrief,
  buildTaskDigest,
  isoDateLocal,
  resolveGroqApiKey,
  resolvePeriodRange,
  resolveTavilyApiKey,
  startOfWeekMonday,
  taskProgressDate,
  type SummaryTask
} from "./productivitySummaryService";

const fixedNow = new Date("2026-07-15T12:00:00"); // Wednesday

describe("resolvePeriodRange", () => {
  it("resolves day to today", () => {
    const r = resolvePeriodRange("day", fixedNow);
    expect(r.startDate).toBe("2026-07-15");
    expect(r.endDate).toBe("2026-07-15");
  });

  it("resolves week Mon–Sun", () => {
    const r = resolvePeriodRange("week", fixedNow);
    expect(r.startDate).toBe("2026-07-13");
    expect(r.endDate).toBe("2026-07-19");
  });

  it("resolves sprint as 14 days from Monday", () => {
    const r = resolvePeriodRange("sprint", fixedNow);
    expect(r.startDate).toBe("2026-07-13");
    expect(r.endDate).toBe("2026-07-26");
  });

  it("resolves month", () => {
    const r = resolvePeriodRange("month", fixedNow);
    expect(r.startDate).toBe("2026-07-01");
    expect(r.endDate).toBe("2026-07-31");
  });

  it("resolves bimonth as previous + current month", () => {
    const r = resolvePeriodRange("bimonth", fixedNow);
    expect(r.startDate).toBe("2026-06-01");
    expect(r.endDate).toBe("2026-07-31");
  });

  it("resolves quarter", () => {
    const r = resolvePeriodRange("quarter", fixedNow);
    expect(r.startDate).toBe("2026-07-01");
    expect(r.endDate).toBe("2026-09-30");
  });

  it("resolves semester H2 for July", () => {
    const r = resolvePeriodRange("semester", fixedNow);
    expect(r.startDate).toBe("2026-07-01");
    expect(r.endDate).toBe("2026-12-31");
  });

  it("resolves year", () => {
    const r = resolvePeriodRange("year", fixedNow);
    expect(r.startDate).toBe("2026-01-01");
    expect(r.endDate).toBe("2026-12-31");
  });

  it("resolves next_day as tomorrow", () => {
    const r = resolvePeriodRange("next_day", fixedNow);
    expect(r.startDate).toBe("2026-07-16");
    expect(r.endDate).toBe("2026-07-16");
  });

  it("resolves next_week as following Mon–Sun", () => {
    const r = resolvePeriodRange("next_week", fixedNow);
    expect(r.startDate).toBe("2026-07-20");
    expect(r.endDate).toBe("2026-07-26");
  });

  it("resolves next_sprint as the following 14 days", () => {
    const r = resolvePeriodRange("next_sprint", fixedNow);
    expect(r.startDate).toBe("2026-07-27");
    expect(r.endDate).toBe("2026-08-09");
  });

  it("resolves next_month", () => {
    const r = resolvePeriodRange("next_month", fixedNow);
    expect(r.startDate).toBe("2026-08-01");
    expect(r.endDate).toBe("2026-08-31");
  });

  it("resolves next_quarter", () => {
    const r = resolvePeriodRange("next_quarter", fixedNow);
    expect(r.startDate).toBe("2026-10-01");
    expect(r.endDate).toBe("2026-12-31");
  });

  it("resolves next_semester after H2 as next H1", () => {
    const r = resolvePeriodRange("next_semester", fixedNow);
    expect(r.startDate).toBe("2027-01-01");
    expect(r.endDate).toBe("2027-06-30");
  });

  it("resolves next_year", () => {
    const r = resolvePeriodRange("next_year", fixedNow);
    expect(r.startDate).toBe("2027-01-01");
    expect(r.endDate).toBe("2027-12-31");
  });

  it("resolves custom range", () => {
    const r = resolvePeriodRange("custom", fixedNow, "2026-01-10", "2026-01-20");
    expect(r.startDate).toBe("2026-01-10");
    expect(r.endDate).toBe("2026-01-20");
  });

  it("rejects inverted custom range", () => {
    expect(() => resolvePeriodRange("custom", fixedNow, "2026-02-01", "2026-01-01")).toThrow(
      PeriodRangeError
    );
  });

  it("rejects custom without dates", () => {
    expect(() => resolvePeriodRange("custom", fixedNow)).toThrow(PeriodRangeError);
  });
});

describe("startOfWeekMonday", () => {
  it("returns Monday for a Wednesday", () => {
    expect(isoDateLocal(startOfWeekMonday(fixedNow))).toBe("2026-07-13");
  });
});

describe("taskProgressDate", () => {
  it("uses due date for completed tasks", () => {
    const t: SummaryTask = {
      id: "1",
      title: "A",
      priority: "medium",
      completed: true,
      dueDate: "2026-07-10",
      completedAt: "2026-07-12T10:00:00.000Z"
    };
    expect(taskProgressDate(t)).toBe("2026-07-10");
  });

  it("falls back to completedAt when undated", () => {
    const t: SummaryTask = {
      id: "2",
      title: "B",
      priority: "low",
      completed: true,
      completedAt: "2026-07-12T15:00:00.000Z"
    };
    expect(taskProgressDate(t)).toBe(isoDateLocal(new Date("2026-07-12T15:00:00.000Z")));
  });
});

describe("buildTaskDigest", () => {
  const projects = [{ id: "p1", name: "Alpha" }];

  it("returns empty digest when no tasks in range", () => {
    const range = resolvePeriodRange("day", fixedNow);
    const digest = buildTaskDigest([], projects, range, "2026-07-15");
    expect(digest.empty).toBe(true);
    expect(digest.stats.totalInRange).toBe(0);
  });

  it("counts completed and overdue correctly", () => {
    const range = resolvePeriodRange("week", fixedNow);
    const tasks: SummaryTask[] = [
      {
        id: "1",
        title: "Done",
        priority: "high",
        completed: true,
        dueDate: "2026-07-14",
        projectId: "p1"
      },
      {
        id: "2",
        title: "Late",
        priority: "urgent",
        completed: false,
        dueDate: "2026-07-14",
        projectId: "p1"
      },
      {
        id: "3",
        title: "Outside",
        priority: "low",
        completed: true,
        dueDate: "2026-06-01"
      }
    ];
    const digest = buildTaskDigest(tasks, projects, range, "2026-07-15");
    expect(digest.stats.completed).toBe(1);
    expect(digest.stats.active).toBeGreaterThanOrEqual(1);
    expect(digest.stats.overdue).toBeGreaterThanOrEqual(1);
    expect(digest.highlights.some((h) => h.includes("Late") && h.includes("id=2"))).toBe(true);
    expect(digest.openTasks.some((t) => t.id === "2" && t.title === "Late")).toBe(true);
    expect(digest.overdueTasks.some((t) => t.id === "2" && t.title === "Late")).toBe(true);
  });

  it("lists open and overdue tasks with id and title", () => {
    const range = resolvePeriodRange("week", fixedNow);
    const tasks: SummaryTask[] = [
      {
        id: "open-1",
        title: "Plan review",
        priority: "medium",
        completed: false,
        dueDate: "2026-07-18",
        projectId: "p1"
      },
      {
        id: "late-1",
        title: "Send invoice",
        priority: "high",
        completed: false,
        dueDate: "2026-07-14",
        projectId: "p1"
      },
      {
        id: "done-1",
        title: "Finished item",
        priority: "low",
        completed: true,
        dueDate: "2026-07-14",
        projectId: "p1"
      }
    ];
    const digest = buildTaskDigest(tasks, projects, range, "2026-07-15");
    expect(digest.openTasks).toHaveLength(2);
    expect(digest.overdueTasks).toEqual([
      expect.objectContaining({ id: "late-1", title: "Send invoice" })
    ]);
    expect(digest.openTasks.map((t) => t.id).sort()).toEqual(["late-1", "open-1"]);
  });
});

describe("buildLocalDigestBrief / buildLocalAskAnswer", () => {
  const projects = [{ id: "p1", name: "Alpha" }];

  it("builds a local brief with open and overdue sections", () => {
    const range = resolvePeriodRange("week", fixedNow);
    const digest = buildTaskDigest(
      [
        {
          id: "late-1",
          title: "Send invoice",
          priority: "high",
          completed: false,
          dueDate: "2026-07-14",
          projectId: "p1"
        },
        {
          id: "done-1",
          title: "Finished item",
          priority: "low",
          completed: true,
          dueDate: "2026-07-14",
          projectId: "p1"
        }
      ],
      projects,
      range,
      "2026-07-15"
    );
    const brief = buildLocalDigestBrief(digest);
    expect(brief).toContain("Open tasks:");
    expect(brief).toContain("ID: late-1");
    expect(brief).toContain("Overdue tasks:");
    expect(brief).toContain("Local timeline brief");

    const ask = buildLocalAskAnswer(digest, "What is overdue?");
    expect(ask).toContain("Overdue tasks:");
    expect(ask).toContain("Send invoice");
    expect(ask).toContain("Local answer");
  });
});

describe("resolveGroqApiKey / resolveTavilyApiKey", () => {
  const prevGroq = process.env.GROQ_API_KEY;
  const prevTavily = process.env.TAVILY_API_KEY;

  afterEach(() => {
    if (prevGroq === undefined) delete process.env.GROQ_API_KEY;
    else process.env.GROQ_API_KEY = prevGroq;
    if (prevTavily === undefined) delete process.env.TAVILY_API_KEY;
    else process.env.TAVILY_API_KEY = prevTavily;
  });

  it("prefers client override over env", () => {
    process.env.GROQ_API_KEY = "env-groq";
    process.env.TAVILY_API_KEY = "env-tavily";
    expect(resolveGroqApiKey(" client-groq ")).toBe("client-groq");
    expect(resolveTavilyApiKey("client-tavily")).toBe("client-tavily");
  });

  it("falls back to env when override empty", () => {
    process.env.GROQ_API_KEY = "env-groq";
    expect(resolveGroqApiKey("")).toBe("env-groq");
    expect(resolveGroqApiKey(null)).toBe("env-groq");
  });
});

describe("assessAiKeyFormat", () => {
  it("accepts typical Groq and Tavily formats", () => {
    expect(assessAiKeyFormat("groq", "gsk_" + "a".repeat(24)).ok).toBe(true);
    expect(assessAiKeyFormat("tavily", "tvly-" + "b".repeat(12)).ok).toBe(true);
    expect(assessAiKeyFormat("groq", "bad").ok).toBe(false);
    expect(assessAiKeyFormat("tavily", "tvly").ok).toBe(false);
  });
});
