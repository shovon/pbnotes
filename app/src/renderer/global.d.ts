import type { ProjectsApi } from '../shared/projects';
import type { GraphApi } from '../shared/graph';

declare global {
  interface Window {
    pbnotes: {
      projects: ProjectsApi;
      graph: GraphApi;
    };
  }
}

export {};
