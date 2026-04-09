import { describe, expect, it } from "vitest";
import { computeYearlyGrinding } from "./yearlyGrinding";

function setQualifiesForWeek(qualifies: Map<string, boolean>, mondayIso: string) {
  for (let i = 0; i < 7; i += 1) {
    const d = new Date(`${mondayIso}T12:00:00`);
    d.setDate(d.getDate() + i);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    qualifies.set(`${y}-${m}-${day}`, true);
  }
}

describe("computeYearlyGrinding", () => {
  it("counts months that meet Monthly Grinding (weeksCompleted >= 4)", () => {
    const q = new Map<string, boolean>();

    // For 2026, make January hit monthly grinding by completing 4 Monday-start weeks:
    // Jan 5, 12, 19, 26 (Mondays in Jan 2026 after Jan 1)
    setQualifiesForWeek(q, "2026-01-05");
    setQualifiesForWeek(q, "2026-01-12");
    setQualifiesForWeek(q, "2026-01-19");
    setQualifiesForWeek(q, "2026-01-26");

    // And February only 3 weeks -> should not count.
    setQualifiesForWeek(q, "2026-02-02");
    setQualifiesForWeek(q, "2026-02-09");
    setQualifiesForWeek(q, "2026-02-16");

    const res = computeYearlyGrinding(2026, q);
    expect(res.year).toBe(2026);
    expect(res.monthsCompleted).toBe(1);
    expect(res.evidenceMonths.map((m) => m.month)).toEqual(["2026-01"]);
  });
});

