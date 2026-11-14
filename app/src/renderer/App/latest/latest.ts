import type { Project } from '../../../shared/projects';

/**
 * The project opened most recently, which the window opens at launch (#393):
 * someone who was working in a project on Friday is still working in it on
 * Monday. None for a list where nothing was ever opened, which shows the
 * Manage projects modal instead of guessing.
 */
export function latest<T extends Pick<Project, 'lastOpenedAt'>>(projects: readonly T[]): T | undefined {
  let best: T | undefined;
  for (const project of projects) {
    if (project.lastOpenedAt === null) continue;
    if (!best || project.lastOpenedAt > (best.lastOpenedAt ?? '')) best = project;
  }
  return best;
}
