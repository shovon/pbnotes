/**
 * `block.edited`: a block's text is now this. Everything about the event,
 * from reading its payload to undoing it (#238).
 */
import { namespaced } from "../../event/event.ts";
import type { Named } from "../../event/event.ts";
import type { Written } from "../../event/over.ts";
import { read } from "../../reading/reading.ts";
import { spell } from "../../titles/titles.ts";
import { same } from "../../undo/undo.ts";
import * as forest from "../../forest/forest.ts";
import * as map from "../../immutable/immutable.ts";
import { BLOCK, stringField, textOf, withId } from "../blocks.ts";
import type { BlockEdited } from "../blocks.ts";

export const BLOCK_EDITED = BLOCK.define({
  type: namespaced("block.edited"),
  // 2 since the page came off the payload: an older build handed one would
  // look up a page of `undefined` and drop the text without a word. At `v: 2`
  // its own gate refuses the event instead.
  v: 2,
  parse: (raw): BlockEdited | undefined => {
    const it = withId(raw);
    const text = it && stringField(it.payload, "text");
    return it && text !== undefined ? { id: it.id, text } : undefined;
  },
  apply: (state, { id, text }) => {
    // An edit to a block the ledger lacks names nothing either, and one to
    // the text a block already has is a repeat, and changes nothing.
    if (!forest.has(state.forest, id)) return state;
    const texts = map.put(state.texts, id, text);
    const titles = spell(state.titles, read(text).links);
    return texts === state.texts && titles === state.titles ? state : { ...state, texts, titles };
  },
  undo: {
    inverse: (state, { id, text }) => {
      const was = textOf(state, id);
      return was === undefined || was === text ? [] : [blockEdited(id, was)];
    },
    // Its text only: a block moved since still holds.
    touched: (_, { id }) => [same((now) => textOf(now, id))],
  },
});

/** The `block.edited` event: `id`'s text is now `text`. */
export function blockEdited(id: string, text: string): Written<Named<"block.edited">, BlockEdited> {
  return BLOCK_EDITED.build({ id, text });
}
