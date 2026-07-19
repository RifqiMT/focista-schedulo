/**
 * Build the export snapshot entity sets: one combined payload for all allowed profiles
 * (JSON and/or CSV are produced by the client from this single snapshot).
 */

export type ExportProfileLike = {
  id: string;
  name: string;
  passwordHash?: string;
};

export type ExportProjectLike = {
  id: string;
  name: string;
  profileId?: string | null;
};

export type ExportTaskLike = {
  id: string;
  profileId?: string | null;
  projectId: string | null;
  cancelled?: boolean;
};

export function filterExportEntities<
  P extends ExportProfileLike,
  J extends ExportProjectLike,
  T extends ExportTaskLike
>(args: {
  profiles: P[];
  projects: J[];
  tasks: T[];
  deniedProfileIds: ReadonlySet<string>;
}): {
  exportProfiles: P[];
  exportProjects: J[];
  exportTasks: T[];
} {
  const { profiles, projects, tasks, deniedProfileIds } = args;
  const profileIdSet = new Set(profiles.map((p) => p.id));

  // Include every profile except password-denied ones (even if empty).
  const exportProfiles = profiles.filter((p) => !deniedProfileIds.has(p.id));
  const exportProfileIdSet = new Set(exportProfiles.map((p) => p.id));

  const exportProjects = projects.filter((p) => {
    if (p.profileId) {
      if (!profileIdSet.has(p.profileId)) return false;
      if (deniedProfileIds.has(p.profileId)) return false;
      return exportProfileIdSet.has(p.profileId);
    }
    return true;
  });
  const allowedProjectIds = new Set(exportProjects.map((p) => p.id));

  // All task rows for allowed profiles/projects — including cancelled.
  const exportTasks = tasks.filter((t) => {
    if (t.profileId) {
      if (!profileIdSet.has(t.profileId)) return false;
      if (deniedProfileIds.has(t.profileId)) return false;
      if (!exportProfileIdSet.has(t.profileId)) return false;
    }
    if (t.projectId && !allowedProjectIds.has(t.projectId)) return false;
    return true;
  });

  return { exportProfiles, exportProjects, exportTasks };
}
