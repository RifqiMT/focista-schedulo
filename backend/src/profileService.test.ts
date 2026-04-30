import { describe, expect, it } from "vitest";
import {
  createProfile,
  deleteProfile,
  updateProfile,
  verifyProfileUnlock,
  type Profile
} from "./profileService";

async function hashPassword(p: string): Promise<string> {
  return `hash:${p}`;
}

async function verifyPassword(p: string, stored: string): Promise<boolean> {
  return stored === `hash:${p}`;
}

describe("profileService", () => {
  it("creates profile with hashed password", async () => {
    const out = await createProfile({
      profiles: [],
      name: "Alice",
      title: "Manager",
      password: "Password#123",
      nowIso: "2026-04-29T00:00:00.000Z",
      makeId: () => "P1",
      hashPassword
    });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.value.profiles[0]?.passwordHash).toBe("hash:Password#123");
    expect(out.value.profile.id).toBe("P1");
    expect(out.value.profile.isPasswordProtected).toBe(true);
  });

  it("creates profile without password when omitted", async () => {
    const out = await createProfile({
      profiles: [],
      name: "No Pass",
      title: "Viewer",
      nowIso: "2026-04-29T00:00:00.000Z",
      makeId: () => "P2",
      hashPassword
    });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.value.profiles[0]?.passwordHash).toBeUndefined();
    expect(out.value.profile.isPasswordProtected).toBe(false);
  });

  it("requires password when creating locked profile", async () => {
    const out = await createProfile({
      profiles: [],
      name: "Locked",
      title: "Admin",
      requirePassword: true,
      nowIso: "2026-04-29T00:00:00.000Z",
      makeId: () => "P3",
      hashPassword
    });
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.error).toContain("Password is required");
  });

  it("updates profile and changes password with current/new/confirm", async () => {
    const profiles: Profile[] = [
      {
        id: "P1",
        name: "Alice",
        title: "Manager",
        passwordHash: "hash:Password#123",
        createdAt: "2026-04-29T00:00:00.000Z",
        updatedAt: "2026-04-29T00:00:00.000Z"
      }
    ];
    const out = await updateProfile({
      profiles,
      id: "P1",
      name: "Alice B",
      title: "Senior Manager",
      currentPassword: "Password#123",
      newPassword: "Password#456",
      confirmNewPassword: "Password#456",
      nowIso: "2026-04-29T00:10:00.000Z",
      hashPassword,
      verifyPassword
    });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.value.profiles[0]?.passwordHash).toBe("hash:Password#456");
    expect(out.value.profile.name).toBe("Alice B");
  });

  it("rejects invalid current password and confirm mismatch", async () => {
    const profiles: Profile[] = [
      {
        id: "P1",
        name: "Alice",
        title: "Manager",
        passwordHash: "hash:Password#123",
        createdAt: "2026-04-29T00:00:00.000Z",
        updatedAt: "2026-04-29T00:00:00.000Z"
      }
    ];

    const wrongCurrent = await updateProfile({
      profiles,
      id: "P1",
      name: "Alice",
      title: "Manager",
      currentPassword: "Wrong",
      newPassword: "Password#456",
      confirmNewPassword: "Password#456",
      nowIso: "2026-04-29T00:10:00.000Z",
      hashPassword,
      verifyPassword
    });
    expect(wrongCurrent.ok).toBe(false);
    if (wrongCurrent.ok) return;
    expect(wrongCurrent.error).toContain("incorrect");

    const mismatch = await updateProfile({
      profiles,
      id: "P1",
      name: "Alice",
      title: "Manager",
      currentPassword: "Password#123",
      newPassword: "Password#456",
      confirmNewPassword: "Password#789",
      nowIso: "2026-04-29T00:10:00.000Z",
      hashPassword,
      verifyPassword
    });
    expect(mismatch.ok).toBe(false);
    if (mismatch.ok) return;
    expect(mismatch.error).toContain("do not match");
  });

  it("allows setting a new password without current when none exists", async () => {
    const profiles: Profile[] = [
      {
        id: "P1",
        name: "Alice",
        title: "Manager",
        createdAt: "2026-04-29T00:00:00.000Z",
        updatedAt: "2026-04-29T00:00:00.000Z"
      }
    ];
    const out = await updateProfile({
      profiles,
      id: "P1",
      name: "Alice",
      title: "Manager",
      newPassword: "Password#999",
      confirmNewPassword: "Password#999",
      nowIso: "2026-04-29T00:10:00.000Z",
      hashPassword,
      verifyPassword
    });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.value.profiles[0]?.passwordHash).toBe("hash:Password#999");
  });

  it("disables lock with current password", async () => {
    const profiles: Profile[] = [
      {
        id: "P1",
        name: "Alice",
        title: "Manager",
        passwordHash: "hash:Password#123",
        createdAt: "2026-04-29T00:00:00.000Z",
        updatedAt: "2026-04-29T00:00:00.000Z"
      }
    ];
    const out = await updateProfile({
      profiles,
      id: "P1",
      name: "Alice",
      title: "Manager",
      requirePassword: false,
      currentPassword: "Password#123",
      nowIso: "2026-04-29T00:10:00.000Z",
      hashPassword,
      verifyPassword
    });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.value.profiles[0]?.passwordHash).toBeUndefined();
    expect(out.value.profile.isPasswordProtected).toBe(false);
  });

  it("verifies profile unlock for locked profile", async () => {
    const profiles: Profile[] = [
      {
        id: "P1",
        name: "Alice",
        title: "Manager",
        passwordHash: "hash:Password#123",
        createdAt: "2026-04-29T00:00:00.000Z",
        updatedAt: "2026-04-29T00:00:00.000Z"
      }
    ];
    const bad = await verifyProfileUnlock({
      profiles,
      id: "P1",
      password: "wrong",
      verifyPassword
    });
    expect(bad.ok).toBe(false);
    const good = await verifyProfileUnlock({
      profiles,
      id: "P1",
      password: "Password#123",
      verifyPassword
    });
    expect(good.ok).toBe(true);
  });

  it("deletes profile and returns not found for unknown id", () => {
    const profiles: Profile[] = [
      {
        id: "P1",
        name: "Alice",
        title: "Manager",
        passwordHash: "hash:Password#123",
        createdAt: "2026-04-29T00:00:00.000Z",
        updatedAt: "2026-04-29T00:00:00.000Z"
      }
    ];
    const ok = deleteProfile({ profiles, id: "P1" });
    expect(ok.ok).toBe(true);
    if (!ok.ok) return;
    expect(ok.value.profiles).toHaveLength(0);

    const notFound = deleteProfile({ profiles, id: "P2" });
    expect(notFound.ok).toBe(false);
  });
});
