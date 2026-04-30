import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "./profileSecurity";

describe("profileSecurity", () => {
  it("hashes and verifies valid passwords", async () => {
    const hash = await hashPassword("TestPassword#123");
    await expect(verifyPassword("TestPassword#123", hash)).resolves.toBe(true);
  });

  it("rejects invalid passwords and malformed hashes", async () => {
    const hash = await hashPassword("Another#Pass123");
    await expect(verifyPassword("wrong", hash)).resolves.toBe(false);
    await expect(verifyPassword("anything", "badformat")).resolves.toBe(false);
  });
});
