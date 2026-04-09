import { describe, expect, it } from "vitest";
import { capMilestoneBadges } from "./capMilestoneBadges";

describe("capMilestoneBadges", () => {
  it("caps long lists while preserving the last milestone", () => {
    const values = Array.from({ length: 500 }, (_, i) => i + 1); // 1..500
    const capped = capMilestoneBadges(values, 150);
    expect(capped.length).toBe(150);
    expect(capped[0]).toBe(1);
    expect(capped[capped.length - 1]).toBe(500);
  });
});

