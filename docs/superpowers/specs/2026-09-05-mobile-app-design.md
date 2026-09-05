# Sprintpad on a phone — design

## The problem

Sprintpad is a text editor with a timer attached. On a desktop that is the
whole point: `⌘↑` reorders, `Tab` indents, `Enter` continues the list, and the
§24 benchmark — reordering five tasks faster than in a plain-text editor — is
the acceptance criterion the product is built around.

None of those keys exist on a phone.

What shipped for mobile so far is the desktop app made to fit: CodeMirror at
16px so iOS stops zooming, plus a bar of four arrow buttons standing in for
`Tab` and `⌘↑`. That is a workaround, not a design. Tapping a tiny arrow to
nudge a task up the list is worse than every native list app, and the gap is
widest on exactly the actions that matter most.

The bet: **the document stays the model, and the phone gets its own view of
it.** Not a responsive squeeze of the desktop UI — a separate interface built
for thumbs, sharing the text, the storage, the sync and the timer.

## What "separate" means here

Separate **view**, shared **model**. The document is still one plain string;
mobile renders rows over it exactly as CodeMirror renders decorations over it.
Two UIs, one truth.

The alternative — a mobile app with its own task objects — would fork the
grammar, and the two would drift within a month. That is the failure mode this
design exists to avoid.

## Architecture

### The split

`main.ts` becomes a dispatcher that picks a shell and dynamically imports it.
Everything a shell needs but does not draw moves into a view-agnostic core.

```
src/
  main.ts            ~30 lines: choose a shell, import it
  core/
    app.ts           store, settings, snapshots, sync, session, save pipeline
  desktop/
    shell.ts         today's main.ts body, unchanged in behaviour
  mobile/
    shell.ts         the phone app
    rows.ts          document string -> render model            [pure]
    ops.ts           row actions -> new document string         [pure]
    listView.ts      the list screen
    editRow.ts       inline row editing + keyboard accessory bar
    focusSheet.ts    the timer, as a sheet and a minimised bar
    menuSheet.ts     pads, settings, snapshots, text mode
    textView.ts      raw document in a textarea
```

Dynamic import matters: a phone never downloads CodeMirror, and the desktop
never downloads the gesture code.

### Edits go through the code that already works

`src/doc/edits.ts` imports from `@codemirror/state` with `import type` only —
it has **no runtime dependency on CodeMirror**. It is pure logic over an
`EditorState`.

So `mobile/ops.ts` is an adapter, not a reimplementation:

```ts
function apply(doc: string, at: number, edit: (s: EditorState) => TransactionSpec | null): string
// build a headless EditorState, run the existing edit, return the new text
```

`toggleDone`, `changeIndent`, `newTaskLine`, `backspaceAtLineHead` are reused
verbatim. Ticking a task on a phone and ticking it on a desktop run the same
function. `@codemirror/state` is ~13KB gzipped and carries no DOM — a cheap
price for semantics that cannot drift.

A second implementation over `string[]` was considered and rejected: it would
duplicate the grammar's edge cases (marker spans, indent levels, the empty-line
rules) in a place no desktop test covers.

### Rendering

`mobile/rows.ts` turns the document into a render model — pure, and the piece
most worth testing:

```ts
interface Row { line: number; from: number; kind: "task" | "header" | "blank";
                text: string; done: boolean; depth: number; }
```

The list is then a straightforward render of that array. No virtualisation: a
day's tasks is tens of rows, not thousands.

## The interface

### The list — the whole app, most of the time

- **Large pad title** at the top with the sync dot; tap for the menu.
- **Section headers** from `# ` lines, sticky while scrolling.
- **Rows at 44pt minimum.** A 28pt tap circle on the left completes the task —
  the single most common action gets the easiest target.
- **Tap the text to edit it in place.** A `contenteditable` row, caret where
  the finger landed, keyboard up. Not a modal, not a detail screen.
- **Return commits and opens a new task below**, keyboard still up, so a list
  can be typed in one go. Return on an empty row outdents; on an empty
  top-level row it removes the row and dismisses the keyboard.
- **Keyboard accessory bar while editing**: `⇤ ⇥` for indent, `↑ ↓` to move
  the row, and Done. This is where indent lives, and it is the standard
  iOS place for it — attached to the keyboard, not floating in the layout.
- **Swipe left** reveals **Focus** and **Delete**.
- **Long-press and drag** to reorder.
- **`+ New Task`** pinned in the bottom third, inside thumb reach.

### Focus

A bottom sheet, not a panel bolted above the list: big clock, task title,
Pause and Done, and the three expiry choices. Dragging it down minimises it to
a bar showing `MM:SS` and the task, so the list stays usable during a session.
Tapping the bar brings it back.

### Menu sheet

Pads and sync, timer settings, snapshots, theme, and **Edit as text**.

### Edit as text

The raw document in a plain `<textarea>`. This keeps the property that makes
Sprintpad what it is — paste five lines and get five tasks — and gives an
escape hatch when a gesture cannot express what you want. No CodeMirror.

## Which shell loads

`(pointer: coarse)` and viewport width under 900px picks mobile. A `?ui=`
parameter overrides and persists, and the menu offers "Use desktop layout" —
a tablet with a keyboard is a real case and guessing wrong should be one tap
to fix, not a dead end.

The same pad URL works on both. Nothing about sync, storage keys or routing
changes.

## What mobile does not get

The command palette, the shortcuts overlay, and the arrow touch bar. All three
exist to reach keyboard actions; on a phone the gestures are the interface and
the touch bar is replaced by the accessory bar.

## Testing

- `rows.ts` and `ops.ts`: pure unit tests, including the cases the desktop
  suite already pins — marker spans, indent levels, empty-line behaviour.
- **Agreement tests**: the same operation applied through `mobile/ops.ts` and
  through `doc/edits.ts` must produce identical documents. This is the guard
  against the two UIs drifting.
- The existing 321 tests must stay green; the core extraction is a move, not a
  rewrite.
- Browser verification at 375×812: type a list without dismissing the
  keyboard, indent, reorder, complete, run a focus session, and confirm sync
  still round-trips.

## Build order

Each step ends green and shippable.

1. **Core extraction.** `core/app.ts` + `desktop/shell.ts`, `main.ts` becomes
   the dispatcher. Desktop behaviour unchanged, all tests still pass.
2. **`rows.ts` + `ops.ts`** with unit and agreement tests. No UI yet.
3. **The list**, read-only: sections, rows, completion by tap.
4. **Inline editing**: contenteditable rows, Return continuation, accessory
   bar, backspace rules.
5. **Gestures**: swipe to Focus/Delete, long-press reorder.
6. **Focus sheet** and the minimised bar.
7. **Menu sheet**, text mode, layout override.
8. Browser verification, then deploy.

## Risks

- **iOS `contenteditable` caret and keyboard behaviour** is the genuine
  unknown. Mitigation: one row is editable at a time and it is a single-line
  field, which is far simpler than an editor. If it fights back, the fallback
  is a plain `<input>` overlaid on the row.
- **Semantic drift** between the two UIs — addressed by the adapter and the
  agreement tests rather than by discipline.
- **`main.ts` is 475 lines** and the extraction touches all of it. It is a
  move rather than a rewrite, and the existing suite covers the parts that
  matter.
