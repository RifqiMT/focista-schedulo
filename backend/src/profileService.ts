export type Profile = {
  id: string;
  name: string;
  title: string;
  passwordHash?: string;
  createdAt: string;
  updatedAt: string;
};

export type ProfilePublic = Omit<Profile, "passwordHash"> & {
  isPasswordProtected: boolean;
};

type Ok<T> = { ok: true; value: T };
type Err = { ok: false; status: number; error: string };
type Result<T> = Ok<T> | Err;

export function toProfilePublic(profile: Profile): ProfilePublic {
  const { passwordHash: _passwordHash, ...safe } = profile;
  return { ...safe, isPasswordProtected: !!profile.passwordHash };
}

export async function createProfile(params: {
  profiles: Profile[];
  name: string;
  title: string;
  password?: string;
  requirePassword?: boolean;
  nowIso: string;
  makeId: () => string;
  hashPassword: (password: string) => Promise<string>;
}): Promise<Result<{ profiles: Profile[]; profile: ProfilePublic }>> {
  const name = params.name.trim();
  const title = params.title.trim();
  if (!name || !title) {
    return { ok: false, status: 400, error: "Name and title are required." };
  }
  const requirePassword = params.requirePassword ?? !!params.password;
  if (requirePassword && !params.password) {
    return { ok: false, status: 400, error: "Password is required when lock is enabled." };
  }
  if (params.password && params.password.length < 4) {
    return { ok: false, status: 400, error: "Password must be at least 4 characters." };
  }
  const profile: Profile = {
    id: params.makeId(),
    name,
    title,
    passwordHash: requirePassword && params.password ? await params.hashPassword(params.password) : undefined,
    createdAt: params.nowIso,
    updatedAt: params.nowIso
  };
  const profiles = [...params.profiles, profile];
  return { ok: true, value: { profiles, profile: toProfilePublic(profile) } };
}

export async function updateProfile(params: {
  profiles: Profile[];
  id: string;
  name: string;
  title: string;
  currentPassword?: string;
  requirePassword?: boolean;
  newPassword?: string;
  confirmNewPassword?: string;
  nowIso: string;
  hashPassword: (password: string) => Promise<string>;
  verifyPassword: (password: string, storedHash: string) => Promise<boolean>;
}): Promise<Result<{ profiles: Profile[]; profile: ProfilePublic }>> {
  const idx = params.profiles.findIndex((p) => p.id === params.id);
  if (idx === -1) return { ok: false, status: 404, error: "Profile not found." };
  const name = params.name.trim();
  const title = params.title.trim();
  if (!name || !title) {
    return { ok: false, status: 400, error: "Name and title are required." };
  }

  const current = params.profiles[idx];
  const nextRequirePassword = params.requirePassword ?? !!current.passwordHash;
  const wantsPasswordChange = !!params.newPassword || !!params.confirmNewPassword;
  const wantsUnlockDisable = !!current.passwordHash && !nextRequirePassword;
  let passwordHash = current.passwordHash;

  if (wantsUnlockDisable) {
    const existingHash = current.passwordHash;
    if (!existingHash) return { ok: false, status: 400, error: "Profile lock is already disabled." };
    if (!params.currentPassword) {
      return {
        ok: false,
        status: 400,
        error: "Current password is required to disable profile lock."
      };
    }
    const validCurrent = await params.verifyPassword(params.currentPassword, existingHash);
    if (!validCurrent) {
      return { ok: false, status: 400, error: "Current password is incorrect." };
    }
    passwordHash = undefined;
  } else if (wantsPasswordChange) {
    if (!params.newPassword || !params.confirmNewPassword) {
      return {
        ok: false,
        status: 400,
        error: "To change password, provide newPassword and confirmNewPassword."
      };
    }
    if (params.newPassword.length < 4) {
      return { ok: false, status: 400, error: "New password must be at least 4 characters." };
    }
    if (params.newPassword !== params.confirmNewPassword) {
      return { ok: false, status: 400, error: "New password and confirmation do not match." };
    }
    if (current.passwordHash) {
      if (!params.currentPassword) {
        return {
          ok: false,
          status: 400,
          error: "Current password is required for profiles that already have a password."
        };
      }
      const validCurrent = await params.verifyPassword(params.currentPassword, current.passwordHash);
      if (!validCurrent) {
        return { ok: false, status: 400, error: "Current password is incorrect." };
      }
    }
    passwordHash = await params.hashPassword(params.newPassword);
  } else if (nextRequirePassword && !current.passwordHash) {
    return {
      ok: false,
      status: 400,
      error: "To enable profile lock, provide newPassword and confirmNewPassword."
    };
  }

  const next: Profile = {
    ...current,
    name,
    title,
    passwordHash,
    updatedAt: params.nowIso
  };
  const profiles = params.profiles.slice();
  profiles[idx] = next;
  return { ok: true, value: { profiles, profile: toProfilePublic(next) } };
}

export async function verifyProfileUnlock(params: {
  profiles: Profile[];
  id: string;
  password?: string;
  verifyPassword: (password: string, storedHash: string) => Promise<boolean>;
}): Promise<Result<{ profile: ProfilePublic }>> {
  const profile = params.profiles.find((p) => p.id === params.id);
  if (!profile) return { ok: false, status: 404, error: "Profile not found." };
  if (!profile.passwordHash) return { ok: true, value: { profile: toProfilePublic(profile) } };
  if (!params.password) {
    return { ok: false, status: 400, error: "Password is required for locked profiles." };
  }
  const valid = await params.verifyPassword(params.password, profile.passwordHash);
  if (!valid) return { ok: false, status: 401, error: "Invalid password." };
  return { ok: true, value: { profile: toProfilePublic(profile) } };
}

export function deleteProfile(params: {
  profiles: Profile[];
  id: string;
}): Result<{ profiles: Profile[] }> {
  const profiles = params.profiles.filter((p) => p.id !== params.id);
  if (profiles.length === params.profiles.length) {
    return { ok: false, status: 404, error: "Profile not found." };
  }
  return { ok: true, value: { profiles } };
}
