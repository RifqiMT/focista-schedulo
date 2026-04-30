import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { getFriendlyErrorMessage } from "../utils/friendlyError";

type Profile = {
  id: string;
  name: string;
  title: string;
  isPasswordProtected: boolean;
  createdAt: string;
  updatedAt: string;
};

type Props = {
  activeProfileId: string | null;
  onChooseProfile: (profileId: string | null) => void;
  onToast: (payload: { kind: "success" | "error" | "info"; title: string; message?: string }) => void;
};

export function ProfileManagement({ activeProfileId, onChooseProfile, onToast }: Props) {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [createName, setCreateName] = useState("");
  const [createTitle, setCreateTitle] = useState("");
  const [createPassword, setCreatePassword] = useState("");
  const [createRequirePassword, setCreateRequirePassword] = useState(false);
  const [showCreatePassword, setShowCreatePassword] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editTitle, setEditTitle] = useState("");
  const [editInitialRequirePassword, setEditInitialRequirePassword] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmNewPassword, setConfirmNewPassword] = useState("");
  const [editRequirePassword, setEditRequirePassword] = useState(false);
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmNewPassword, setShowConfirmNewPassword] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [pendingDeleteProfile, setPendingDeleteProfile] = useState<Profile | null>(null);
  const [deletePassword, setDeletePassword] = useState("");
  const [showDeletePassword, setShowDeletePassword] = useState(false);
  const [pendingUnlockProfile, setPendingUnlockProfile] = useState<Profile | null>(null);
  const [unlockPassword, setUnlockPassword] = useState("");
  const [showUnlockPassword, setShowUnlockPassword] = useState(false);
  const [unlocking, setUnlocking] = useState(false);
  const [unlockedProfileIds, setUnlockedProfileIds] = useState<string[]>([]);
  const [autoFallbackDone, setAutoFallbackDone] = useState(false);
  const autoFallbackRunningRef = useRef(false);
  const currentProfile = profiles.find((p) => p.id === activeProfileId) ?? null;
  const isShowcaseReadOnlyActive = currentProfile?.name.trim().toLowerCase() === "test";

  const loadProfiles = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/profiles");
      if (!res.ok) throw new Error(await getFriendlyErrorMessage(res));
      const data = (await res.json()) as Profile[];
      setProfiles(data);
    } catch (error) {
      onToast({
        kind: "error",
        title: "Profiles failed to load",
        message: error instanceof Error ? error.message : String(error)
      });
    } finally {
      setLoading(false);
    }
  }, [onToast]);

  useEffect(() => {
    void loadProfiles();
  }, [loadProfiles]);

  useEffect(() => {
    if (profiles.length === 0) return;
    const exists = activeProfileId ? profiles.some((p) => p.id === activeProfileId) : false;
    if (exists) return;
    const preferred = profiles.find((p) => !p.isPasswordProtected) ?? profiles[0]!;
    onChooseProfile(preferred.id);
  }, [profiles, activeProfileId, onChooseProfile]);

  useEffect(() => {
    if (profiles.length === 0) return;
    if (!activeProfileId) return;
    if (autoFallbackDone) return;
    if (autoFallbackRunningRef.current) return;
    const active = profiles.find((p) => p.id === activeProfileId);
    if (!active || !active.isPasswordProtected) {
      setAutoFallbackDone(true);
      return;
    }
    if (unlockedProfileIds.includes(active.id)) {
      setAutoFallbackDone(true);
      return;
    }

    const run = async () => {
      autoFallbackRunningRef.current = true;
      try {
        const res = await fetch("/api/profiles/task-counts");
        if (!res.ok) throw new Error(await getFriendlyErrorMessage(res));
        const countsPayload = (await res.json()) as {
          countsByProfileId?: Record<string, number>;
        };
        const countsByProfile = countsPayload.countsByProfileId ?? {};

        const unlockedProfiles = profiles.filter((p) => !p.isPasswordProtected);
        const withTasks = unlockedProfiles
          .filter((p) => Number(countsByProfile[p.id] ?? 0) > 0)
          .sort(
            (a, b) => Number(countsByProfile[b.id] ?? 0) - Number(countsByProfile[a.id] ?? 0)
          );
        const fallback = withTasks[0] ?? unlockedProfiles[0] ?? null;
        if (fallback && fallback.id !== activeProfileId) {
          onChooseProfile(fallback.id);
          onToast({
            kind: "info",
            title: "Profile switched",
            message: `Locked profile requires unlock. Switched to "${fallback.name}" by default.`
          });
        }
      } catch {
        // Ignore fallback errors and keep current selection unchanged.
      } finally {
        autoFallbackRunningRef.current = false;
        setAutoFallbackDone(true);
      }
    };
    void run();
  }, [profiles, activeProfileId, unlockedProfileIds, autoFallbackDone, onChooseProfile, onToast]);

  useEffect(() => {
    setUnlockedProfileIds((prev) => prev.filter((id) => profiles.some((p) => p.id === id)));
  }, [profiles]);

  const handleCreate = async (e: FormEvent) => {
    e.preventDefault();
    if (isShowcaseReadOnlyActive) {
      onToast({
        kind: "info",
        title: "Showcase mode",
        message: 'Profile "Test" is read-only. Create, edit, and delete actions are disabled.'
      });
      return;
    }
    if (!createName.trim() || !createTitle.trim()) {
      onToast({
        kind: "error",
        title: "Create failed",
        message: "Name and title are required."
      });
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/profiles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: createName.trim(),
          title: createTitle.trim(),
          requirePassword: createRequirePassword,
          password: createPassword || undefined
        })
      });
      if (!res.ok) {
        throw new Error(await getFriendlyErrorMessage(res));
      }
      const created = (await res.json()) as Profile;
      setCreateName("");
      setCreateTitle("");
      setCreatePassword("");
      setCreateRequirePassword(false);
      setShowCreatePassword(false);
      setShowCreate(false);
      onChooseProfile(created.id);
      onToast({ kind: "success", title: "Profile created" });
      await loadProfiles();
    } catch (error) {
      onToast({
        kind: "error",
        title: "Create failed",
        message: error instanceof Error ? error.message : String(error)
      });
    } finally {
      setSubmitting(false);
    }
  };

  const startEdit = (profile: Profile) => {
    setShowCreate(false);
    setPendingDeleteProfile(null);
    setEditingId(profile.id);
    setEditName(profile.name);
    setEditTitle(profile.title);
    setEditRequirePassword(profile.isPasswordProtected);
    setEditInitialRequirePassword(profile.isPasswordProtected);
    setCurrentPassword("");
    setNewPassword("");
    setConfirmNewPassword("");
    setShowCurrentPassword(false);
    setShowNewPassword(false);
    setShowConfirmNewPassword(false);
  };

  const handleUpdate = async (e: FormEvent) => {
    e.preventDefault();
    if (!editingId) return;
    if (isShowcaseReadOnlyActive) {
      onToast({
        kind: "info",
        title: "Showcase mode",
        message: 'Profile "Test" is read-only. Create, edit, and delete actions are disabled.'
      });
      return;
    }
    setSubmitting(true);
    try {
      const body: Record<string, string> = {
        name: editName.trim(),
        title: editTitle.trim()
      };
      const bodyExt = body as Record<string, string | boolean>;
      if (editRequirePassword !== editInitialRequirePassword) {
        bodyExt.requirePassword = editRequirePassword;
      }
      if (currentPassword || newPassword || confirmNewPassword) {
        body.currentPassword = currentPassword;
        body.newPassword = newPassword;
        body.confirmNewPassword = confirmNewPassword;
      }
      const res = await fetch(`/api/profiles/${editingId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
      if (!res.ok) {
        throw new Error(await getFriendlyErrorMessage(res));
      }
      onToast({ kind: "success", title: "Profile updated" });
      setEditingId(null);
      await loadProfiles();
    } catch (error) {
      onToast({
        kind: "error",
        title: "Update failed",
        message: error instanceof Error ? error.message : String(error)
      });
    } finally {
      setSubmitting(false);
    }
  };

  const profileHasPassword = (id: string | null): boolean => {
    if (!id) return false;
    return profiles.find((p) => p.id === id)?.isPasswordProtected ?? false;
  };

  const handleChooseProfile = (profileId: string) => {
    const target = profiles.find((p) => p.id === profileId);
    if (!target) return;
    if (!target.isPasswordProtected || unlockedProfileIds.includes(target.id)) {
      onChooseProfile(target.id);
      return;
    }
    setUnlockPassword("");
    setShowUnlockPassword(false);
    setPendingUnlockProfile(target);
  };

  const handleUnlockProfile = async () => {
    if (!pendingUnlockProfile) return;
    setUnlocking(true);
    try {
      const res = await fetch(`/api/profiles/${pendingUnlockProfile.id}/unlock`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: unlockPassword })
      });
      if (!res.ok) {
        throw new Error(await getFriendlyErrorMessage(res));
      }
      setUnlockedProfileIds((prev) =>
        prev.includes(pendingUnlockProfile.id) ? prev : [...prev, pendingUnlockProfile.id]
      );
      onChooseProfile(pendingUnlockProfile.id);
      setPendingUnlockProfile(null);
      setUnlockPassword("");
      onToast({ kind: "success", title: "Profile unlocked" });
    } catch (error) {
      onToast({
        kind: "error",
        title: "Unlock failed",
        message: error instanceof Error ? error.message : String(error)
      });
    } finally {
      setUnlocking(false);
    }
  };

  const handleDelete = async (profile: Profile) => {
    if (isShowcaseReadOnlyActive) {
      onToast({
        kind: "info",
        title: "Showcase mode",
        message: 'Profile "Test" is read-only. Create, edit, and delete actions are disabled.'
      });
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch(`/api/profiles/${profile.id}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          password: profile.isPasswordProtected ? deletePassword : undefined
        })
      });
      if (!res.ok) {
        const apiMessage = await getFriendlyErrorMessage(res);
        if (res.status === 401) {
          throw new Error(
            profile.isPasswordProtected
              ? "Incorrect password. Please re-enter the profile password to delete this profile."
              : apiMessage
          );
        }
        if (res.status === 400) {
          throw new Error("Please enter the profile password before deleting.");
        }
        throw new Error(apiMessage);
      }
      onToast({ kind: "success", title: "Profile deleted" });
      const nextProfiles = profiles.filter((p) => p.id !== profile.id);
      if (activeProfileId === profile.id) onChooseProfile(nextProfiles[0]?.id ?? null);
      if (editingId === profile.id) setEditingId(null);
      await loadProfiles();
    } catch (error) {
      onToast({
        kind: "error",
        title: "Delete failed",
        message: error instanceof Error ? error.message : String(error)
      });
    } finally {
      setSubmitting(false);
      setPendingDeleteProfile(null);
      setDeletePassword("");
      setShowDeletePassword(false);
    }
  };

  return (
    <section className="profile-manager sidebar" aria-label="Profile management">
      <div className="sidebar-header">
        <div className="profile-header-title-row">
          <h3>Profile Hub</h3>
        </div>
        <div className="profile-header-actions" role="group" aria-label="Profile actions">
          <button
            className="ghost-button small profile-icon-btn"
            type="button"
            onClick={() => {
              setPendingDeleteProfile(null);
              setEditingId(null);
              setShowCreate((v) => !v);
            }}
            title={
              isShowcaseReadOnlyActive
                ? 'Showcase mode: actions are disabled for profile "Test"'
                : showCreate
                  ? "Close create form"
                  : "Add profile"
            }
            aria-label={showCreate ? "Close create form" : "Add profile"}
            disabled={isShowcaseReadOnlyActive}
          >
            <span className="profile-icon-glyph" aria-hidden="true">
              {showCreate ? (
                <svg viewBox="0 0 24 24" focusable="false">
                  <path d="M6 6l12 12M18 6L6 18" />
                </svg>
              ) : (
                <svg viewBox="0 0 24 24" focusable="false">
                  <path d="M12 5v14M5 12h14" />
                </svg>
              )}
            </span>
          </button>
          <button
            className="ghost-button small profile-icon-btn"
            type="button"
            onClick={() => {
              const current = profiles.find((p) => p.id === activeProfileId);
              if (current) startEdit(current);
            }}
            title="Edit selected profile"
            aria-label="Edit selected profile"
            disabled={profiles.length === 0 || isShowcaseReadOnlyActive}
          >
            <span className="profile-icon-glyph" aria-hidden="true">
              <svg viewBox="0 0 24 24" focusable="false">
                <path d="M4 20l4.2-1 9.8-9.8-3.2-3.2L5 15.8 4 20zM13.8 6.2l3.2 3.2" />
              </svg>
            </span>
          </button>
          <button
            className="ghost-button small profile-icon-btn profile-icon-btn-danger"
            type="button"
            onClick={() => {
              const current = profiles.find((p) => p.id === activeProfileId);
              if (current) {
                setPendingDeleteProfile(current);
                setDeletePassword("");
                setShowDeletePassword(false);
              }
            }}
            title="Delete selected profile"
            aria-label="Delete selected profile"
            disabled={profiles.length === 0 || isShowcaseReadOnlyActive}
          >
            <span className="profile-icon-glyph" aria-hidden="true">
              <svg viewBox="0 0 24 24" focusable="false">
                <path d="M4 7h16M9 7V5h6v2M8 7l1 12h6l1-12M10 10v7M14 10v7" />
              </svg>
            </span>
          </button>
        </div>
      </div>

      <div className="profile-active-strip profile-scope-card">
        <label className="profile-select-wrap">
          <span className="muted profile-field-label">Current workspace profile</span>
          <div className="profile-select-row">
            <select
              className="profile-select"
              value={activeProfileId ?? ""}
              onChange={(e) => handleChooseProfile(e.target.value)}
              disabled={profiles.length === 0}
            >
              <option value="" disabled>
                Select profile
              </option>
              {profiles.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
          <span className="muted profile-helper-text">
            Projects and tasks are filtered to the selected profile.
          </span>
          {currentProfile ? (
            <div className="profile-selected-summary" aria-live="polite">
              <strong>
                {currentProfile.name}
                {currentProfile.title ? ` — ${currentProfile.title}` : ""}
              </strong>
            </div>
          ) : null}
        </label>
      </div>

      {loading ? <p>Loading profiles...</p> : null}
      {!loading && profiles.length === 0 ? (
        <div className="profile-empty muted">No profiles yet. Create one to start scoped planning.</div>
      ) : null}

      {showCreate ? (
        <div className="drawer-backdrop" onClick={() => setShowCreate(false)}>
          <aside className="drawer" onClick={(e) => e.stopPropagation()}>
            <form onSubmit={handleCreate}>
              <header className="drawer-header">
                <h2>Create profile</h2>
              </header>
              <div className="drawer-body">
                <label className="field">
                  <span>Name</span>
                  <input
                    value={createName}
                    onChange={(e) => setCreateName(e.target.value)}
                    placeholder="Profile name"
                    autoFocus
                  />
                </label>
                <label className="field">
                  <span>Title</span>
                  <input
                    value={createTitle}
                    onChange={(e) => setCreateTitle(e.target.value)}
                    placeholder="Role or title"
                  />
                </label>
                <label className="field">
                  <span>Access lock</span>
                  <label className="profile-lock-toggle">
                    <input
                      type="checkbox"
                      checked={createRequirePassword}
                      onChange={(e) => {
                        setCreateRequirePassword(e.target.checked);
                        if (!e.target.checked) setCreatePassword("");
                      }}
                    />
                    <span>Require password to access this profile</span>
                  </label>
                </label>
                {createRequirePassword ? (
                  <label className="field">
                  <span>Password</span>
                  <div className="password-input-row">
                    <input
                      type={showCreatePassword ? "text" : "password"}
                      value={createPassword}
                      onChange={(e) => setCreatePassword(e.target.value)}
                      placeholder="Set only if needed (min 4 chars)"
                    />
                    <button
                      className="ghost-button small"
                      type="button"
                      onClick={() => setShowCreatePassword((v) => !v)}
                    >
                      {showCreatePassword ? "Hide" : "Show"}
                    </button>
                  </div>
                  </label>
                ) : null}
              </div>
              <footer className="drawer-footer">
                <button className="ghost-button" type="button" onClick={() => setShowCreate(false)}>
                  Cancel
                </button>
                <button className="primary-button" disabled={submitting}>
                  {submitting ? "Saving..." : "Create"}
                </button>
              </footer>
            </form>
          </aside>
        </div>
      ) : null}

      {editingId ? (
        <div className="drawer-backdrop" onClick={() => setEditingId(null)}>
          <aside className="drawer" onClick={(e) => e.stopPropagation()}>
            <form onSubmit={handleUpdate}>
              <header className="drawer-header">
                <h2>Edit profile</h2>
              </header>
              <div className="drawer-body">
                <label className="field">
                  <span>Name</span>
                  <input
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    placeholder="Profile name"
                    autoFocus
                  />
                </label>
                <label className="field">
                  <span>Title</span>
                  <input
                    value={editTitle}
                    onChange={(e) => setEditTitle(e.target.value)}
                    placeholder="Role or title"
                  />
                </label>
                <label className="field">
                  <span>Access lock</span>
                  <label className="profile-lock-toggle">
                    <input
                      type="checkbox"
                      checked={editRequirePassword}
                      onChange={(e) => {
                        setEditRequirePassword(e.target.checked);
                        if (!e.target.checked) {
                          setNewPassword("");
                          setConfirmNewPassword("");
                        }
                      }}
                    />
                    <span>Require password to access this profile</span>
                  </label>
                </label>
                {editRequirePassword ? (
                  <>
                {profileHasPassword(editingId) ? (
                  <label className="field">
                    <span>Current password</span>
                    <div className="password-input-row">
                      <input
                        type={showCurrentPassword ? "text" : "password"}
                        value={currentPassword}
                        onChange={(e) => setCurrentPassword(e.target.value)}
                        placeholder="Required to change lock or password"
                      />
                      <button
                        className="ghost-button small"
                        type="button"
                        onClick={() => setShowCurrentPassword((v) => !v)}
                      >
                        {showCurrentPassword ? "Hide" : "Show"}
                      </button>
                    </div>
                  </label>
                ) : null}
                <label className="field">
                  <span>{profileHasPassword(editingId) ? "New password" : "Set password"}</span>
                  <div className="password-input-row">
                    <input
                      type={showNewPassword ? "text" : "password"}
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      placeholder="Leave empty to keep current password"
                    />
                    <button
                      className="ghost-button small"
                      type="button"
                      onClick={() => setShowNewPassword((v) => !v)}
                    >
                      {showNewPassword ? "Hide" : "Show"}
                    </button>
                  </div>
                </label>
                <label className="field">
                  <span>Confirm new password</span>
                  <div className="password-input-row">
                    <input
                      type={showConfirmNewPassword ? "text" : "password"}
                      value={confirmNewPassword}
                      onChange={(e) => setConfirmNewPassword(e.target.value)}
                      placeholder="Repeat new password"
                    />
                    <button
                      className="ghost-button small"
                      type="button"
                      onClick={() => setShowConfirmNewPassword((v) => !v)}
                    >
                      {showConfirmNewPassword ? "Hide" : "Show"}
                    </button>
                  </div>
                </label>
                  </>
                ) : null}
              </div>
              <footer className="drawer-footer">
                <button className="ghost-button" type="button" onClick={() => setEditingId(null)}>
                  Cancel
                </button>
                <button className="primary-button" disabled={submitting}>
                  {submitting ? "Updating..." : "Save"}
                </button>
              </footer>
            </form>
          </aside>
        </div>
      ) : null}

      {pendingDeleteProfile ? (
        <div className="drawer-backdrop" onClick={() => setPendingDeleteProfile(null)}>
          <aside className="drawer" onClick={(e) => e.stopPropagation()}>
            <header className="drawer-header">
              <h2>Delete profile</h2>
            </header>
            <div className="drawer-body">
              <p>
                Delete profile "<strong>{pendingDeleteProfile.name}</strong>"?
              </p>
              <p className="muted" style={{ marginTop: "0.5rem" }}>
                This will remove the profile from your workspace.
              </p>
              {pendingDeleteProfile.isPasswordProtected ? (
                <label className="field" style={{ marginTop: "0.7rem" }}>
                  <span>Confirm password</span>
                  <div className="password-input-row">
                    <input
                      type={showDeletePassword ? "text" : "password"}
                      value={deletePassword}
                      onChange={(e) => setDeletePassword(e.target.value)}
                      placeholder="Enter profile password"
                      autoFocus
                    />
                    <button
                      className="ghost-button small"
                      type="button"
                      onClick={() => setShowDeletePassword((v) => !v)}
                    >
                      {showDeletePassword ? "Hide" : "Show"}
                    </button>
                  </div>
                </label>
              ) : null}
            </div>
            <footer className="drawer-footer">
              <button
                className="ghost-button"
                type="button"
                onClick={() => {
                  setPendingDeleteProfile(null);
                  setDeletePassword("");
                  setShowDeletePassword(false);
                }}
                disabled={submitting}
              >
                Cancel
              </button>
              <button
                className="primary-button"
                type="button"
                onClick={() => void handleDelete(pendingDeleteProfile)}
                disabled={
                  submitting ||
                  (pendingDeleteProfile.isPasswordProtected && !deletePassword.trim())
                }
              >
                {submitting ? "Deleting..." : "Delete"}
              </button>
            </footer>
          </aside>
        </div>
      ) : null}

      {pendingUnlockProfile ? (
        <div className="drawer-backdrop" onClick={() => setPendingUnlockProfile(null)}>
          <aside className="drawer" onClick={(e) => e.stopPropagation()}>
            <header className="drawer-header">
              <h2>Unlock profile</h2>
            </header>
            <div className="drawer-body">
              <p>
                Enter password to access "<strong>{pendingUnlockProfile.name}</strong>".
              </p>
              <label className="field" style={{ marginTop: "0.6rem" }}>
                <span>Password</span>
                <div className="password-input-row">
                  <input
                    type={showUnlockPassword ? "text" : "password"}
                    value={unlockPassword}
                    onChange={(e) => setUnlockPassword(e.target.value)}
                    placeholder="Profile password"
                    autoFocus
                  />
                  <button
                    className="ghost-button small"
                    type="button"
                    onClick={() => setShowUnlockPassword((v) => !v)}
                  >
                    {showUnlockPassword ? "Hide" : "Show"}
                  </button>
                </div>
              </label>
            </div>
            <footer className="drawer-footer">
              <button
                className="ghost-button"
                type="button"
                onClick={() => setPendingUnlockProfile(null)}
                disabled={unlocking}
              >
                Cancel
              </button>
              <button
                className="primary-button"
                type="button"
                onClick={() => void handleUnlockProfile()}
                disabled={unlocking}
              >
                {unlocking ? "Unlocking..." : "Unlock"}
              </button>
            </footer>
          </aside>
        </div>
      ) : null}
    </section>
  );
}
