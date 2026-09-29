import type { ProjectsApi } from '../shared/projects';
import type { PagesApi } from '../shared/pages';

declare global {
  interface Window {
    gnotes: {
      projects: ProjectsApi;
      pages: PagesApi;
    };
  }
}

export {};
