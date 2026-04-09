export type DailyQualifyMap = Map<string, boolean>;

function toIsoLocal(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function addDaysLocalIso(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T12:00:00`);
  if (Number.isNaN(d.getTime())) return isoDate;
  d.setDate(d.getDate() + days);
  return toIsoLocal(d);
}

function monthStartIso(now: Date): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}-01`;
}

function monthEndIso(now: Date): string {
  const y = now.getFullYear();
  const m0 = now.getMonth();
  // Day 0 of next month => last day of current month.
  const d = new Date(y, m0 + 1, 0, 12, 0, 0);
  return toIsoLocal(d);
}

function startOfWeekMondayIso(isoDate: string): string {
  const d = new Date(`${isoDate}T12:00:00`);
  if (Number.isNaN(d.getTime())) return isoDate;
  // JS: 0=Sun..6=Sat. Convert so Monday=0..Sunday=6.
  const dow = d.getDay();
  const mondayBased = (dow + 6) % 7;
  d.setDate(d.getDate() - mondayBased);
  return toIsoLocal(d);
}

function firstMondayOnOrAfterIso(isoDate: string): string {
  const d = new Date(`${isoDate}T12:00:00`);
  if (Number.isNaN(d.getTime())) return isoDate;
  // JS: 0=Sun..6=Sat
  const dow = d.getDay();
  // Days to add until Monday (1). If Monday, add 0.
  const delta = (1 - dow + 7) % 7;
  d.setDate(d.getDate() + delta);
  return toIsoLocal(d);
}

function monthKeyForIso(isoDate: string): string {
  // yyyy-mm-dd
  return isoDate.slice(0, 7);
}

export type MonthlyGrindingResult = {
  monthKey: string;
  weeksCompleted: number;
  evidenceWeekStarts: string[];
};

/**
 * Monthly Grinding:
 * Count how many Monday-start weeks (Mon..Sun) whose Monday falls within the
 * current calendar month have all 7 days satisfying the "Consistency Builder day"
 * criteria.
 *
 * This makes the month have a predictable number of “weeks” (Mondays in month),
 * and allows the last week of the month to extend into the next month.
 */
export function computeMonthlyGrinding(
  now: Date,
  dailyQualifies: DailyQualifyMap
): MonthlyGrindingResult {
  const startIso = monthStartIso(now);
  const endIso = monthEndIso(now);
  const monthKey = monthKeyForIso(startIso);

  const firstWeekStart = firstMondayOnOrAfterIso(startIso);
  const evidenceWeekStarts: string[] = [];

  // Iterate Monday-start weeks where the Monday is within the month.
  for (let weekStart = firstWeekStart; weekStart <= endIso; weekStart = addDaysLocalIso(weekStart, 7)) {
    // Guard: only count weekStarts that belong to this month.
    if (monthKeyForIso(weekStart) !== monthKey) continue;

    const days: string[] = [];
    for (let i = 0; i < 7; i += 1) days.push(addDaysLocalIso(weekStart, i));

    const ok = days.every((d) => dailyQualifies.get(d) === true);
    if (ok) evidenceWeekStarts.push(weekStart);
  }

  return {
    monthKey,
    weeksCompleted: evidenceWeekStarts.length,
    evidenceWeekStarts
  };
}

