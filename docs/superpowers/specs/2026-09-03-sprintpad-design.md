# Sprintpad — Implementation Plan

## Context

`/Users/charlesju/Work/sprint_pad` is empty. We're building Sprintpad from the v0.1 spec: a keyboard-first focus notepad that combines text-editor-speed task planning with a focus timer attached to the current task.

The product bet, and the thing this plan protects: **it is a text editor first and a productivity app second.** The acceptance criterion from spec §24 — reordering `A B C D E` into `D B <new> E A C` as fast as in a plain-text editor — is the design constraint that drives every technical choice below. Whenever a choice trades "better task manager" against "faster manipulation of today's work," we take speed.

Decisions confirmed with the user:
- **Delivery:** local web app in this repo (Vite + TypeScript, `npm run dev`, vitest, localStorage).
- **Editor:** CodeMirror 6 — a real text editor, so multi-line selection, editor-semantics cut/copy/paste, undo/redo, ⌘F, and line-move commands are inherited rather than reimplemented.
- **Shortcut conflict in §9 resolved:** `⌘Enter` = start focus (always), `⌘D` = toggle done.
- **Scope:** all of §19 — the 12 must-haves plus notifications, session history, dark mode, command palette, export/import.

Explicitly out of scope: everything in §20.

---

## Architecture

### The document is the source of truth

The whole workpad is **one plain-text string**. There is no task database rendered to look like text — the text *is* the model. Structure is derived by parsing lines; visual richness (checkboxes, strikethrough, headers, focus highlight) comes from CodeMirror **decorations painted over that text**.

This is what makes export/import trivial (the doc is already the file), persistence trivial (save a string), and undo/redo free (CM6 history over text changes).

### Line grammar

```
TODAY                          → header   (any non-empty line with no [] marker)
[] Highrise - Claude setup     → task, open
[x] Pay taxes                  → task, done
  [] Review FTUE               → task, indent 1 (2 spaces per level)
(blank)                        → blank
```

The header rule — *any non-empty non-task line is a header* — is deliberately dumb so `HIGHRISE` and `# Highrise` both just work with zero ceremony (§8).

That rule collides with §16 (paste 5 bare lines → 5 tasks, not 5 headers). Resolved by intent, not by grammar: **typing** a bare line leaves a header; **pasting** multi-line text with no `[]` markers runs a transform that prefixes each non-blank line with `[] `. Distinct actions, distinct results.

Enter behavior keeps typing natural and makes the header case rare in practice:
- Enter at end of a task line → new line pre-seeded with `[] ` at the same indent.
- Enter on an empty `[] ` line → strips the marker (escape the list).
- Enter on a header line → plain empty line.

### Tracking the focused task through edits

A running session must survive the user editing and reordering the list underneath it. CM6 already solves this: store the focused line's position in a `StateField` that maps through every transaction's changes. Edits above it shift it; edits to its own text follow it; deleting it collapses the anchor, and we fall back to the title snapshot captured at session start.

So `FocusSession` = `{ taskText, anchor: number | null, durationSec, elapsedSec, state }`. No task IDs, no metadata sidecar in the document.

### Timer is wall-clock, not tick-counted

Store `startedAt` epoch plus accumulated pause time; compute remaining as a function of `Date.now()`. A 250ms interval only repaints. This survives background-tab throttling and a page reload (a running session is persisted and restored).

### Focus history without per-task metadata

An append-only log in localStorage: `{ id, taskText, startedAt, seconds, completed }`. §17's "today" table is a group-by over task text. No need for stable task identity in the document — which is exactly why we can keep the document as pure text.

---

## Module layout

Each file has one job and a small interface. Pure logic is separated from CodeMirror and DOM so it can be tested directly.

```
src/
  main.ts              bootstrap + wiring
  doc/
    grammar.ts         parseLine, line kinds, indent, markdown normalize  [pure]
    paste.ts           multi-line plain text → task lines                  [pure]
    edits.ts           toggleDone, newTaskLine, moveLine, indent as
                       (state) → TransactionSpec | null                    [pure-ish]
    commands.ts        thin CM6 Command adapters over edits.ts
    decorations.ts     ViewPlugin: checkbox widgets, done, header, focus
    focusField.ts      StateField + StateEffects for the focus anchor
    editor.ts          createEditor(): assembles extensions, small API
  focus/
    timer.ts           wall-clock timer                                    [pure]
    session.ts         session state machine + subscribers
    panel.ts           focus area DOM
    notifications.ts   permission + fire on complete
    tabTitle.ts        "48:12 — task" in document.title
  data/
    storage.ts         localStorage load/save, schema version, debounce
    history.ts         append session, aggregate today                     [pure]
  ui/
    palette.ts         ⌘K command palette
    historyView.ts     today's focus table
    theme.ts           light/dark tokens + CM6 theme
    settings.ts        duration presets, break length, count-up
  styles.css
index.html
```

Writing `edits.ts` as pure `(state) → TransactionSpec` functions with separate `Command` adapters is the key testability move: the interesting logic is exercised against a bare `EditorState` with no DOM.

---

## Keymap

| Action | Key | Source |
|---|---|---|
| New task | `Enter` | custom (edits.ts) |
| Start focus on cursor's task | `⌘Enter` | custom |
| Toggle done | `⌘D` | custom |
| Move line up / down | `⌘↑` / `⌘↓` | `@codemirror/commands` |
| Indent / outdent | `Tab` / `⇧Tab` | `indentMore` / `indentLess` |
| Undo / redo | `⌘Z` / `⌘⇧Z` | `history()` |
| Search | `⌘F` | `@codemirror/search` |
| Command palette | `⌘K` | custom |
| Pause/resume | `Space` when timer focused, `⌘⇧Space` globally | custom |
| End session | `Esc` when timer focused | custom |

Implementation note: on macOS CM6's default keymap binds `⌘↑`/`⌘↓` to doc start/end, and `⌘D` to `selectNextOccurrence` in some presets. Our keymap must be wrapped in `Prec.highest()` so it wins.

---

## Build steps

Each step ends green. Tests first for the pure modules (grammar, paste, edits, timer, history, storage) — they're where the real logic lives and they're cheap to test.

0. **Spec doc.** Write the validated design to `docs/superpowers/specs/2026-09-03-sprintpad-design.md`, `git init`, commit. (Deferred from brainstorming because plan mode blocks writes.)
1. **Scaffold.** Vite + TypeScript + vitest, `index.html`, npm scripts (`dev`, `build`, `test`, `typecheck`). Verify: `npm run dev` serves a blank shell, `npm test` runs.
2. **Grammar + paste.** `doc/grammar.ts`, `doc/paste.ts` with unit tests: task/header/blank/indent parsing, `[x]` vs `[]`, `- [ ]` markdown normalization, paste transform, idempotency.
3. **Editor shell.** `doc/editor.ts` with history, search, defaultKeymap, indent unit of 2 spaces. Plain text editing works, ⌘Z/⌘F work.
4. **Decorations.** Checkbox widgets replacing `[]`/`[x]` (clickable), strikethrough+dim on done lines, header styling. The workpad now *looks* like §7.
5. **Edits + keymap.** `edits.ts` + `commands.ts` + `Prec.highest` keymap: Enter continuation, ⌘D toggle, ⌘↑/⌘↓ move, Tab/⇧Tab indent. **Verify §24 by hand:** reorder A–E into D B new E A C without touching the mouse.
6. **Persistence.** `data/storage.ts`, debounced save, versioned schema, restore on load.
7. **Focus core.** `focus/timer.ts` + `focus/session.ts` + `doc/focusField.ts` with tests for the state machine and wall-clock math. Anchor survives edits and reordering.
8. **Focus UI.** `focus/panel.ts`: idle state ("Ready to focus / Select a task and press ⌘Enter"), running state (title, `MM:SS`, PAUSE / DONE), completion state (Done / Keep Working / Take Break, §12), and the early-complete path (§13: "✓ task — 17 minutes focused", cursor to next open task). Focus line highlighted in the workpad. Session survives reload.
9. **Tab title + notifications.** §11.
10. **Settings.** Duration presets 25/50/60/90/custom/count-up + break length, persisted.
11. **Dark mode.** Token-based theme, follows system by default, manual override persists.
12. **History view.** §17 today's table with total.
13. **Command palette.** ⌘K over the actions above plus export/import and theme.
14. **Export/import.** Download the doc as `.md`; import a file, normalizing `- [ ]` → `[]`.

---

## Verification

- `npm test` — unit suites for grammar, paste, edits, timer, session, history, storage.
- `npm run typecheck` and `npm run build` clean.
- Manual end-to-end via `npm run dev`, driven with the browser tools:
  - **§24 benchmark** — the reorder drill above, keyboard only. This is the acceptance criterion; if it feels slow, the editor layer is wrong.
  - **§26 north star** — open app → decide → timer running in under 30 seconds.
  - Paste 5 bare lines → 5 tasks (§16).
  - Start focus, edit and reorder lines above and below it, confirm the highlight and title stay on the right task.
  - Reload mid-session → timer resumes at the correct remaining time.
  - Complete early → history logs the partial minutes; complete via expiry → all three §12 buttons behave.
  - Export → reimport → identical document.

## Risks

- **CM6 keymap precedence** on macOS (⌘↑/⌘↓/⌘D). Addressed with `Prec.highest`; verified in step 5.
- **Checkbox widget vs. cursor movement** — replacing `[]` with a widget can make arrow-key navigation feel off. Mitigation: widgets are non-atomic so the cursor traverses the underlying text normally.
- **Header-vs-task ambiguity** — mitigated by the Enter continuation behavior and paste transform; if it still surprises in use, the fallback is requiring `#` for headers.

---

## Addendum: what changed during implementation

Two refinements to the focus-anchor design, both found by writing tests against
real `moveLine` transactions rather than assuming how they were built.

**Edits are minimal-diff.** `toggleDone` and `changeIndent` rewrite only the
marker span or the leading whitespace, never the whole line. Rewriting the line
would delete the anchored character and drop a running session's anchor, so
completing or indenting the task you were focusing on would have lost focus.
Smaller undo steps and preserved selections are a free side benefit.

**The title fallback is not an edge case.** Moving a *neighbouring* line past the
focused one makes CodeMirror delete and reinsert the focused line's text, which
legitimately drops the anchor. `resolveFocusedLine` recovers focus by title, and
`reanchorTo` re-attaches a fresh anchor so position tracking resumes.

One behavioural decision worth recording: completing the focused task by any
route — `⌘D`, the checkbox, the panel's Done button — ends the session. All
three funnel through a single observer on document change rather than each
ending the session themselves.

`⌘D` deliberately does nothing on a header line. "Convert lines to tasks" in the
command palette is the explicit way to turn bare lines into tasks, which keeps
one key from carrying two meanings.


---

## Addendum 2: the grammar was inverted

Originally a task needed `[]` and any bare line was a header. In use, typing
the brackets was the friction the product exists to remove, so the rule is now
the other way round:

- Any non-empty line is an open task.
- `# ` makes a header.
- `[x] ` marks completion — written by ⌘D or the checkbox, never typed.

Consequences worth recording:

**§16 mostly dissolved.** Pasting bare lines needs no conversion at all, so
`transformPastedText` shrank to widening markdown and unicode checkboxes. The
`atLineStart` context it needed is gone.

**Enter got simpler.** With no marker to continue, it only carries indentation
down; on an empty indented line it clears the indent, which is how you step
back out of a nested group.

**The focus anchor had to move.** It sat at the start of the task text, which
for a bare task is the line start -- a boundary position. Moving a neighbouring
line past the focused one then slid the anchor silently onto the wrong task
rather than dropping it. The anchor now sits one character into the text, which
is strictly interior, so deletion is detected and the title fallback runs. A
regression test asserts the anchor drops rather than retargets.

**Stored documents needed a migration.** A v1 document's bare lines meant
"header" and would otherwise have been silently reinterpreted as tasks.
`migrateLegacyDoc` rewrites them to `# `, run exactly once behind a
`sprintpad.docVersion` key -- it cannot be idempotent, so the guard is the
correctness argument, not a convenience.

**`convertToTasks` became `toggleHeader`.** Bare lines are already tasks; the
thing you now need a command for is the header.

Two smaller fixes from the same pass: `Esc` closes the command palette from a
window-level handler, because clicking inside the palette moves focus to the
body and the input's own handler stopped seeing the key; and the top bar keeps
only `⌘K`, with today's focus reachable through it.


---

## Addendum 3: Enter behaves like a bullet list

Enter now opens the next task *visibly* -- an empty checkbox waiting for text --
and pressing it again on that empty line steps back out one indent level at a
time, dropping the checkbox at the left margin.

The design problem: an empty line and a blank spacer between groups are the
same characters. "This empty line is a freshly opened task" cannot live in the
document without writing a marker into it, and a marker would survive the user
walking away -- leaving stray `[] ` lines in the saved text.

So it lives in editor state instead, as `pendingTaskField`: the position of the
one empty line currently showing a waiting checkbox. It is cleared the moment
the line stops being empty, the cursor moves off it, or the line is deleted, so
it cannot outlive the moment it describes. The document text stays clean --
pressing Enter and walking away leaves an ordinary blank line.

This also gives blank lines a real indent level in the grammar, since stepping
out one level at a time requires knowing how deep the empty line sits.


---

## Addendum 4: two fixes around a freshly opened task

**Tab did nothing on a new task.** `changeIndent` skipped blank lines, so the
natural sequence -- Enter to open a task, Tab to nest it -- did nothing at all.
A single empty line now indents; blank lines inside a multi-line selection are
still skipped, so indenting a block does not fill its spacers with whitespace.

Fixing that exposed a second bug underneath. On an empty line the cursor sits
exactly where the indent gets inserted, and CodeMirror left it to the *left* of
the new whitespace -- so the next character typed landed before the indent,
silently producing a top-level task with trailing spaces. `changeIndent` now
places the caret explicitly when it re-indents an empty line.

**A typed `[` sat next to the checkbox.** Muscle memory types `[]` at the head
of a task. `[] foo` already parsed as a task, but the half-typed `[` did not --
it rendered as literal text beside the box. `markerInput.ts` absorbs the old
ceremony (`[] ` and `[ ] `, one keystroke at a time) at the head of an empty
task, with a second `[` typing the real character for tasks that genuinely
start with a bracket.

The absorbing run lives in a StateField and ends on any other input or cursor
move, so it can only ever swallow a contiguous marker at the position it began.

Absorbing silently was a mistake: on a blank line with no waiting checkbox
showing, pressing `[` produced no visible change at all, and the natural
response is to press it again -- which is exactly the escape hatch, so you get
a literal bracket. Absorbing now also marks the line as the pending task, so
the checkbox appears on the first press. One key, one visible task.
