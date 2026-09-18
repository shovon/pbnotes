import type { ProjectsApi } from '../shared/projects';

declare global {
  interface Window {
    gnotes: {
      projects: ProjectsApi;
    };
  }
}

export {};
