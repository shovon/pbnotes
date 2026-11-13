import type { Marker } from "@pbnotes/graph";
import type { Condition, Filter } from "../../../../../shared/graph.ts";

const MARKERS: readonly Marker[] = ["TODO", "DOING", "DONE"];

/**
 * A filter as it crossed the bridge (#387), built fresh from what each
 * condition reads. A kind it does not know, a marker that is not one, or a
 * second condition of one kind is refused: a filter misread would show the
 * wrong blocks under a heading that says they are the right ones.
 */
export function requireFilter(value: unknown): Filter {
  if (!Array.isArray(value)) throw new TypeError("Expected a filter");
  const kinds = new Set<string>();
  return value.map((it: unknown): Condition => {
    if (typeof it !== "object" || it === null) throw new TypeError("Expected a condition");
    const { kind, markers } = it as Record<string, unknown>;
    if (kind !== "marker") throw new TypeError("Expected a condition of a known kind");
    if (kinds.has(kind)) throw new TypeError("Expected one condition of each kind");
    kinds.add(kind);
    if (!Array.isArray(markers) || !markers.every((m) => MARKERS.includes(m as Marker))) {
      throw new TypeError("Expected markers to be TODO, DOING or DONE");
    }
    return { kind, markers: [...new Set(markers as Marker[])] };
  });
}

/** The markers a task has to be under to meet `filter`: every one with no marker condition. */
export function markersOf(filter: Filter): Set<Marker> {
  const marker = filter.find((it) => it.kind === "marker");
  return new Set(marker ? marker.markers : MARKERS);
}
