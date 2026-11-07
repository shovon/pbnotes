import type { ProjectsApi } from '../shared/projects';
import type { GraphApi } from '../shared/graph';
import type { BenchApi } from '../shared/bench';
import type { WindowApi } from '../shared/window';

declare global {
  interface Window {
    pbnotes: {
      projects: ProjectsApi;
      graph: GraphApi;
      bench: BenchApi;
      window: WindowApi;
    };
  }
}

export {};
