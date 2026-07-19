import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  coerceTaskImportRow,
  parseImportArrayPerRow
} from "./importParse";

const TaskSchema = z.object({
  id: z.string(),
  title: z.string().min(1),
  priority: z.enum(["low", "medium", "high", "urgent"]),
  labels: z.array(z.string()),
  projectId: z.string().nullable(),
  completed: z.boolean(),
  durationMinutes: z.number().int().positive().optional(),
  link: z.array(z.string()).optional()
});

describe("parseImportArrayPerRow", () => {
  it("keeps valid rows when one sibling fails strict array parse", () => {
    const rows = [
      {
        id: "t1",
        title: "Good",
        priority: "high",
        labels: ["a"],
        projectId: null,
        completed: false
      },
      {
        id: "t2",
        title: "Bad duration",
        priority: "medium",
        labels: ["b"],
        projectId: null,
        completed: true,
        durationMinutes: 0
      },
      {
        id: "t3",
        title: "Also good",
        priority: "low",
        labels: [],
        projectId: "p1",
        completed: false
      }
    ];

    const withoutCoerce = parseImportArrayPerRow(rows, TaskSchema);
    // durationMinutes: 0 fails Zod; without coerce that one row drops
    expect(withoutCoerce.ok.map((t) => t.id)).toEqual(["t1", "t3"]);
    expect(withoutCoerce.dropped).toBe(1);

    const withCoerce = parseImportArrayPerRow(rows, TaskSchema, coerceTaskImportRow);
    // 0 duration stripped → all three import
    expect(withCoerce.ok.map((t) => t.id)).toEqual(["t1", "t2", "t3"]);
    expect(withCoerce.dropped).toBe(0);
    expect(withCoerce.ok[1]?.durationMinutes).toBeUndefined();
  });

  it("coerces missing labels/projectId/completed and string links", () => {
    const rows = [
      {
        id: "t1",
        title: "Legacy",
        priority: "urgent",
        link: "https://example.com"
        // labels, projectId, completed omitted
      }
    ];
    const { ok, dropped } = parseImportArrayPerRow(rows, TaskSchema, coerceTaskImportRow);
    expect(dropped).toBe(0);
    expect(ok).toHaveLength(1);
    expect(ok[0]).toMatchObject({
      id: "t1",
      labels: [],
      projectId: null,
      completed: false,
      link: ["https://example.com"]
    });
  });

  it("does not wipe the whole array on a single invalid row", () => {
    const rows = [
      {
        id: "bad",
        title: "",
        priority: "low",
        labels: [],
        projectId: null,
        completed: false
      },
      {
        id: "ok",
        title: "Survives",
        priority: "low",
        labels: [],
        projectId: null,
        completed: false
      }
    ];
    const { ok, dropped } = parseImportArrayPerRow(rows, TaskSchema, coerceTaskImportRow);
    expect(dropped).toBe(1);
    expect(ok.map((t) => t.id)).toEqual(["ok"]);
  });
});
