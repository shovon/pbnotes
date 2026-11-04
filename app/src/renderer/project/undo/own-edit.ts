/**
 * How a field tells the undo watcher it is about to change its own text
 * (#247): the block box's auto-closed bracket and its link completion, which
 * go through `execCommand` and fire no `beforeinput`. `ProjectView` provides
 * it from `watchFields`; with none (a story, a test), it does nothing.
 */
import { createContext } from 'react';

export const OwnEdit = createContext<(box: HTMLInputElement | HTMLTextAreaElement) => void>(
  () => undefined,
);
