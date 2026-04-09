import { describe, expect, it } from "vitest";
import { computeMonthlyGrinding } from "./monthlyGrinding";

function iso(d: string) {
  return d;
}

describe("computeMonthlyGrinding", () => {
  it("counts Monday-start weeks whose Monday is within the month", () => {
    // April 2026 has Mondays on 6, 13, 20, 27.
    const now = new Date("2026-04-15T12:00:00");

    const qualifies = new Map<string, boolean>();
    const markWeek = (mondayIso: string) => {
      for (let i = 0; i < 7; i += 1) {
        const d = new Date(`${mondayIso}T12:00:00`);
        d.setDate(d.getDate() + i);
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, "0");
        const day = String(d.getDate()).padStart(2, "0");
        qualifies.set(`${y}-${m}-${day}`, true);
      }
    };

    // Mark 4 Monday-start weeks: Apr 6..12, Apr 13..19, Apr 20..26, Apr 27..May 3.
    markWeek(iso("2026-04-06"));
    markWeek(iso("2026-04-13"));
    markWeek(iso("2026-04-20"));
    markWeek(iso("2026-04-27"));

    const res = computeMonthlyGrinding(now, qualifies);
    expect(res.monthKey).toBe("2026-04");
    expect(res.weeksCompleted).toBe(4);
    expect(res.evidenceWeekStarts).toEqual(["2026-04-06", "2026-04-13", "2026-04-20", "2026-04-27"]);
  });

  it("returns 0 when no qualifying days exist", () => {
    const now = new Date("2026-04-20T12:00:00");
    const res = computeMonthlyGrinding(now, new Map());
    expect(res.weeksCompleted).toBe(0);
    expect(res.evidenceWeekStarts).toEqual([]);
  });
});

