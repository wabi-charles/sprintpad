import type { EditorState, TransactionSpec } from "@codemirror/state";
import type { Command } from "@codemirror/view";
import { changeIndent, newTaskLine, toggleDone, toggleHeader } from "./edits";

/**
 * Thin adapters that turn the pure edits into CodeMirror commands. Returning
 * false lets the editor's own binding handle the key instead.
 */
function command(produce: (state: EditorState) => TransactionSpec | null): Command {
  return (view) => {
    const spec = produce(view.state);
    if (!spec) return false;
    view.dispatch({ ...spec, userEvent: "input" });
    return true;
  };
}

export const insertTaskLine = command(newTaskLine);
export const toggleTaskDone = command(toggleDone);
export const toggleTaskHeader = command(toggleHeader);
export const indentTasks = command((state) => changeIndent(state, 1));
export const outdentTasks = command((state) => changeIndent(state, -1));
