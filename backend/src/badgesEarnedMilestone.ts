export type BadgesEarnedMilestoneBlock = {
  id: string;
  name: string;
  unit: string;
  current: number;
  next: number | null;
  progressToNext: number;
  achievedCount: number;
  recentUnlocked: number[];
  milestones: number[];
  achieved: number[];
};

function clamp01(n: number) {
  return Math.max(0, Math.min(1, n));
}

export function buildBadgesEarnedMilestoneBlock(currentBadgesEarned: number): BadgesEarnedMilestoneBlock {
  const milestones: number[] = [];
  for (let v = 5; v <= 750; v += 5) milestones.push(v);

  const achieved = milestones.filter((m) => m <= currentBadgesEarned);
  const next = milestones.find((m) => m > currentBadgesEarned) ?? null;
  const prev = achieved.length ? achieved[achieved.length - 1]! : 0;
  const progressToNext =
    next === null ? 1 : clamp01((currentBadgesEarned - prev) / Math.max(1, next - prev));

  const recentUnlocked = achieved.length <= 6 ? achieved : achieved.slice(-6);

  return {
    id: "badges_earned",
    name: "Badges earned",
    unit: "badges",
    current: currentBadgesEarned,
    next,
    progressToNext,
    achievedCount: achieved.length,
    recentUnlocked,
    milestones,
    achieved
  };
}

