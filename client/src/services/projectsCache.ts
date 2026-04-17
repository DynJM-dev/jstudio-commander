// #218 — Module-level TTL cache for /projects responses. The autocomplete
// in CreateSessionModal opens often and the project list rarely changes,
// so a 60s cache cuts modal-open GETs to one per minute. Mutations
// elsewhere (rescan, project:scanned WS events) call invalidate to
// guarantee a fresh fetch on the next consumer.
import type { Project } from '@commander/shared';

export const PROJECTS_TTL_MS = 60_000;

let projectsCache: { data: Project[]; fetchedAt: number } | null = null;

export const getProjectsCache = (): Project[] | null => {
  if (!projectsCache) return null;
  if (Date.now() - projectsCache.fetchedAt >= PROJECTS_TTL_MS) return null;
  return projectsCache.data;
};

export const setProjectsCache = (data: Project[]): void => {
  projectsCache = { data, fetchedAt: Date.now() };
};

export const invalidateProjectsCache = (): void => {
  projectsCache = null;
};
