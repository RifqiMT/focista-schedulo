import { describe, expect, it } from "vitest";
import {
  buildYTicks,
  formatYTickLabel,
  niceYDomain
} from "./chartYAxis";

describe("niceYDomain", () => {
  it("snaps large XP-like ranges onto an even grid", () => {
    const { yMin, yMax } = niceYDomain(13800, 21200, { preferInteger: true });
    expect(yMin).toBeLessThanOrEqual(13800);
    expect(yMax).toBeGreaterThanOrEqual(21200);
    const span = yMax - yMin;
    const ticks = buildYTicks(yMin, yMax, 4);
    // Even spacing in value space
    const steps = ticks.slice(1).map((t, i) => t - ticks[i]!);
    expect(steps.every((s) => Math.abs(s - steps[0]!) < 1e-6)).toBe(true);
    expect(span % steps[0]!).toBeCloseTo(0, 6);
  });

  it("keeps small integer domains tight", () => {
    const { yMin, yMax } = niceYDomain(0, 7, { preferInteger: true, tight: true });
    expect(yMin).toBe(0);
    expect(yMax).toBeLessThanOrEqual(10);
    expect(yMax).toBeGreaterThanOrEqual(7);
  });
});

describe("buildYTicks", () => {
  it("does not emit duplicate compact labels", () => {
    // Simulate the old bug domain: padded extent without nice snap + forced endpoints
    const ticks = buildYTicks(14000, 21000, 4);
    const labels = ticks.map(formatYTickLabel);
    expect(new Set(labels).size).toBe(labels.length);
    expect(ticks[0]).toBe(14000);
    expect(ticks[ticks.length - 1]).toBe(21000);
  });

  it("spaces ticks evenly for a nice domain", () => {
    const { yMin, yMax } = niceYDomain(14000, 21000, { preferInteger: true });
    const ticks = buildYTicks(yMin, yMax, 4);
    const labels = ticks.map(formatYTickLabel);
    expect(new Set(labels).size).toBe(labels.length);
    for (let i = 2; i < ticks.length; i++) {
      expect(ticks[i]! - ticks[i - 1]!).toBeCloseTo(ticks[1]! - ticks[0]!, 6);
    }
  });
});
