/**
 * Every open text field's own undo history, watched from the document
 * (#247). A field opts in with an attribute, and nothing else:
 *
 * - `data-undo="document"`: a note field (a block box, the tag input, a
 *   property cell). Once its own history is used up, undo goes on to main's.
 * - `data-undo="field"`: the search box. Its typing writes nothing to the
 *   graph, so undo never reaches past its own history.
 *
 * Watched from the document rather than from each field, because the tag,
 * property and search inputs come and go inside components that stay: a
 * history is kept per element, and goes with it. The browser's own undo is
 * cancelled wherever it comes from, and sent to the dispatcher instead.
 *
 * The DOM's half of `field-history` and `dispatcher`, both pure: this only
 * reads and writes the fields, and is handed the document, the dispatcher
 * and the clock.
 */
import { canRedo, canUndo, EMPTY, redo, typed, undo } from "./field-history/field-history";
import type { Change, FieldHistory, Snapshot } from "./field-history/field-history";
import type { Dispatcher, Field } from "./dispatcher/dispatcher";

type Box = HTMLInputElement | HTMLTextAreaElement;

/** The attribute a field opts in with. */
export const UNDO_ATTRIBUTE = "data-undo";

/** Changes that are a step apart from the typing either side. */
const OWN_STEP = new Set(["insertFromPaste", "insertFromDrop", "insertReplacementText", "deleteByCut"]);

/** `target` as a field that opted in, or undefined. */
function boxOf(target: EventTarget | null): Box | undefined {
  if (!(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement)) return undefined;
  return target.hasAttribute(UNDO_ATTRIBUTE) ? target : undefined;
}

/** The field's text and selection now. */
function snapshot(box: Box): Snapshot {
  const end = box.value.length;
  return { value: box.value, start: box.selectionStart ?? end, end: box.selectionEnd ?? end };
}

/** What the watcher keeps for one field while it is open. */
type Kept = {
  history: FieldHistory;
  /** The field before the change now arriving: `beforeinput` takes it. */
  before?: Snapshot;
  /** The field before an IME started composing. */
  composingFrom?: Snapshot;
  /** The change now arriving is an edit the field made itself. */
  own: boolean;
  /** A snapshot is being put back: its `input` is not typing. */
  restoring: boolean;
};

/**
 * Watches every field in `document` that opted in. `now` is the clock, in
 * milliseconds. Hands back `ownEdit`, for a field that is about to change
 * its own text (the block box's auto-closed bracket, its link completion),
 * and `stop`.
 */
export function watchFields(document: Document, dispatcher: Dispatcher, now: () => number) {
  const kept = new WeakMap<Box, Kept>();
  let release: (() => void) | undefined;

  function keptOf(box: Box): Kept {
    let it = kept.get(box);
    if (!it) kept.set(box, (it = { history: EMPTY, own: false, restoring: false }));
    return it;
  }

  /**
   * Puts `to` back into `box`. Set through the element's own `value` setter
   * and announced with an `input` event, so a field whose text React holds
   * in state hears it as a change, as it would typing.
   */
  function put(box: Box, it: Kept, to: Snapshot): void {
    it.restoring = true;
    try {
      Object.getOwnPropertyDescriptor(Object.getPrototypeOf(box), "value")?.set?.call(box, to.value);
      box.setSelectionRange(to.start, to.end);
      box.dispatchEvent(new Event("input", { bubbles: true }));
      box.setSelectionRange(to.start, to.end);
    } finally {
      it.restoring = false;
    }
  }

  /** `box` as the dispatcher asks it. */
  function fieldOf(box: Box): Field {
    const it = keptOf(box);
    return {
      canUndo: () => canUndo(it.history),
      canRedo: () => canRedo(it.history),
      undo: () => {
        const step = undo(it.history, snapshot(box));
        if (!step) return;
        it.history = step.history;
        put(box, it, step.to);
      },
      redo: () => {
        const step = redo(it.history, snapshot(box));
        if (!step) return;
        it.history = step.history;
        put(box, it, step.to);
      },
      close: () => box.blur(),
      reachesDocument: box.getAttribute(UNDO_ATTRIBUTE) !== "field",
    };
  }

  /** `change` to `box`, from `before` to what it holds now, kept. */
  function record(box: Box, it: Kept, before: Snapshot | undefined, change: Omit<Change, "at">): void {
    if (before) it.history = typed(it.history, before, snapshot(box), { ...change, at: now() });
    it.before = undefined;
    it.own = false;
  }

  const onFocusIn = (event: FocusEvent) => {
    const box = boxOf(event.target);
    if (!box) return;
    release?.();
    release = dispatcher.focus(fieldOf(box));
  };

  const onFocusOut = (event: FocusEvent) => {
    if (!boxOf(event.target)) return;
    // The window losing focus blurs the field too, but it is still the open
    // one: the browser hands focus back to it when the window returns. The
    // block box stays open the same way.
    if (!document.hasFocus()) return;
    release?.();
    release = undefined;
  };

  const onBeforeInput = (event: InputEvent) => {
    const box = boxOf(event.target);
    if (!box) return;
    // The browser's own undo, from wherever it came: cancelled, and sent
    // where every undo goes.
    if (event.inputType === "historyUndo" || event.inputType === "historyRedo") {
      event.preventDefault();
      if (event.inputType === "historyUndo") dispatcher.undo();
      else dispatcher.redo();
      return;
    }
    const it = keptOf(box);
    if (!it.composingFrom && !it.own) it.before = snapshot(box);
  };

  const onInput = (event: Event) => {
    const box = boxOf(event.target);
    if (!box) return;
    const it = keptOf(box);
    const input = event as InputEvent;
    if (it.restoring || it.composingFrom || input.isComposing) return;
    record(box, it, it.before, {
      kind: input.inputType?.startsWith("delete") ? "delete" : "insert",
      data: input.data ?? null,
      own: it.own || OWN_STEP.has(input.inputType),
    });
  };

  // A composition is one change, from before it started to what it ended
  // with, so a step never holds half a character.
  const onCompositionStart = (event: CompositionEvent) => {
    const box = boxOf(event.target);
    if (box) keptOf(box).composingFrom = snapshot(box);
  };

  const onCompositionEnd = (event: CompositionEvent) => {
    const box = boxOf(event.target);
    if (!box) return;
    const it = keptOf(box);
    const from = it.composingFrom;
    it.composingFrom = undefined;
    record(box, it, from, { kind: "insert", data: event.data || null });
  };

  document.addEventListener("focusin", onFocusIn);
  document.addEventListener("focusout", onFocusOut);
  document.addEventListener("beforeinput", onBeforeInput);
  document.addEventListener("input", onInput);
  document.addEventListener("compositionstart", onCompositionStart);
  document.addEventListener("compositionend", onCompositionEnd);
  // A field focused before this started watching (an `autoFocus` box).
  const active = boxOf(document.activeElement);
  if (active) release = dispatcher.focus(fieldOf(active));

  return {
    /**
     * `box` is about to change its own text through `execCommand`, which
     * fires `input` but no `beforeinput`: the field as it is now is what
     * that change is undone back to, and the change is a step of its own.
     */
    ownEdit(box: Box): void {
      if (!boxOf(box)) return;
      const it = keptOf(box);
      it.before = snapshot(box);
      it.own = true;
    },

    stop(): void {
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("focusout", onFocusOut);
      document.removeEventListener("beforeinput", onBeforeInput);
      document.removeEventListener("input", onInput);
      document.removeEventListener("compositionstart", onCompositionStart);
      document.removeEventListener("compositionend", onCompositionEnd);
      release?.();
      release = undefined;
    },
  };
}

export type Fields = ReturnType<typeof watchFields>;
