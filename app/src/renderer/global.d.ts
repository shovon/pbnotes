import type { ProjectsApi } from '../shared/projects';
import type { GraphApi } from '../shared/graph';
import type { BenchApi } from '../shared/bench';
import type { SidebarApi } from '../shared/sidebar';
import type { WindowApi } from '../shared/window';

declare global {
  interface Window {
    pbnotes: {
      projects: ProjectsApi;
      graph: GraphApi;
      bench: BenchApi;
      sidebar: SidebarApi;
      window: WindowApi;
    };
  }
}

export {};
