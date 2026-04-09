import type { DailyQualifyMap, MonthlyGrindingResult } from "./monthlyGrinding";
import { computeMonthlyGrinding } from "./monthlyGrinding";

export type YearlyGrindingResult = {
  year: number;
  monthsCompleted: number;
  evidenceMonths: { month: string; monthly: MonthlyGrindingResult }[];
};

function monthKey(year: number, monthIndex0: number): string {
  const m = String(monthIndex0 + 1).padStart(2, "0");
  return `${year}-${m}`;
}

/**
 * Yearly Grinding:
 * In a calendar year (Jan..Dec), count how many months hit "Monthly Grinding".
 *
 * A month "hits Monthly Grinding" if computeMonthlyGrinding(...) for that month returns
 * weeksCompleted >= 4 (same rules as the Monthly Grinding achievement).
 *
 * Notes:
 * - Uses local-calendar dates (same as stats/progress day bucketing).
 * - Because the source data is day-based, it naturally supports future dueDate-attributed completions.
 */
export function computeYearlyGrinding(
  year: number,
  dailyQualifies: DailyQualifyMap
): YearlyGrindingResult {
  const evidenceMonths: { month: string; monthly: MonthlyGrindingResult }[] = [];
  let monthsCompleted = 0;

  for (let m = 0; m < 12; m += 1) {
    // Any date within the target month works; choose the 15th at noon local.
    const nowForMonth = new Date(year, m, 15, 12, 0, 0);
    const monthly = computeMonthlyGrinding(nowForMonth, dailyQualifies);
    const key = monthKey(year, m);
    if (monthly.weeksCompleted >= 4) {
      monthsCompleted += 1;
      evidenceMonths.push({ month: key, monthly });
    }
  }

  return { year, monthsCompleted, evidenceMonths };
}

