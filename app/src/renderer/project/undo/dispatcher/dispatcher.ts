/**
 * The one place every way of asking to undo or redo goes through (#247): the
 * menu's Cmd+Z and Cmd+Shift+Z, and the browser's own undo, cancelled and
 * sent here. The open field's history first, then main's.
 *
 * Knows nothing of fields or of main: a field says what it can do, and
 * `take` is handed in, so this runs under `node --test`.
 */

/** Which way: back through what was written, or forward through what was undone. */
export type Way = "undo" | "redo";

/** An open field, as the dispatcher asks it. */
export type Field = {
  canUndo(): boolean;
  canRedo(): boolean;
  undo(): void;
  redo(): void;
  /**
   * Closes the field, before main takes a step back: a field left open
   * would write what it shows over what main puts back. Called only when the
   * field has nothing of its own to undo, so closing it writes nothing.
   */
  close(): void;
  /**
   * Whether undo goes on to main's history once the field's own is used up.
   * False for a field whose typing writes nothing to the graph (the search
   * box): undoing a search must not undo a note.
   */
  readonly reachesDocument: boolean;
};

export function createDispatcher(take: (way: Way) => void) {
  /** The field with focus, the one asked. */
  let focused: Field | undefined;

  return {
    /** `field` has focus. Hands back what to call when it loses it. */
    focus(field: Field): () => void {
      focused = field;
      return () => {
        if (focused === field) focused = undefined;
      };
    },

    /** The open field's last step undone, or, with none, main's. */
    undo(): void {
      const field = focused;
      if (field?.canUndo()) return field.undo();
      if (field && !field.reachesDocument) return;
      field?.close();
      take("undo");
    },

    /**
     * The open field's last undo redone. A field typed in since has no redo
     * left, and nothing is redone: main's redo would bring back a step the
     * field's typing came after. An untouched field, or none, redoes main's.
     */
    redo(): void {
      const field = focused;
      if (field?.canRedo()) return field.redo();
      if (field && (!field.reachesDocument || field.canUndo())) return;
      field?.close();
      take("redo");
    },
  };
}

export type Dispatcher = ReturnType<typeof createDispatcher>;
