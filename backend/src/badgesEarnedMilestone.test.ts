import { describe, expect, it } from "vitest";
import { buildBadgesEarnedMilestoneBlock } from "./badgesEarnedMilestone";

describe("buildBadgesEarnedMilestoneBlock", () => {
  it("creates 5-step milestones up to 750", () => {
    const b = buildBadgesEarnedMilestoneBlock(0);
    expect(b.milestones[0]).toBe(5);
    expect(b.milestones[1]).toBe(10);
    expect(b.milestones[b.milestones.length - 1]).toBe(750);
    expect(b.milestones.length).toBe(150);
  });

  it("computes next and achieved milestones", () => {
    const b = buildBadgesEarnedMilestoneBlock(17);
    expect(b.achieved).toEqual([5, 10, 15]);
    expect(b.next).toBe(20);
    expect(b.achievedCount).toBe(3);
  });
});

