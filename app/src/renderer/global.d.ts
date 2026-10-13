import type { ProjectsApi } from '../shared/projects';
import type { PagesApi } from '../shared/pages';

declare global {
  interface Window {
    pbnotes: {
      projects: ProjectsApi;
      pagesFor(projectId: string): PagesApi;
    };
  }
}

export {};
