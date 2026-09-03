# Sprintpad

A keyboard-first focus notepad. Plan in seconds, focus on one thing.

Your task list is a plain-text document you edit like a text editor. Any line
can become your current focus session with one keystroke.

```bash
npm install
npm run dev
```

Then open http://localhost:5183.

## The document

The whole workpad is one plain-text string. Checkboxes, strikethrough, headers
and the focus highlight are painted over it, so copy, paste, undo and export
behave exactly like a text editor's.

```text
TODAY
[] Highrise - Claude data setup
[x] Pay taxes
  [] A subtask, indented two spaces

OTHER
[] Anything else
```

- A line starting with `[]` or `[x]` is a task.
- Any other non-empty line is a header. No syntax to learn; `HIGHRISE` and
  `# Highrise` both work.
- Indentation is two spaces per level.
- **Position is priority.** There are no priority fields — move the important
  thing to the top.

Pasting several plain lines at once turns them into tasks. Pasting Sprintpad
content back in leaves it exactly as it was.

## Keys

| Action | Key |
| --- | --- |
| New task | `Enter` |
| Start focus on the task at the cursor | `⌘Enter` |
| Complete task | `⌘D` |
| Move task up / down | `⌘↑` / `⌘↓` (or `⌥↑` / `⌥↓`) |
| Indent / outdent | `Tab` / `⇧Tab` |
| Undo / redo | `⌘Z` / `⇧⌘Z` |
| Search | `⌘F` |
| Command palette | `⌘K` |
| Pause / resume | `Space` while the timer has focus, or `⇧⌘Space` anywhere |
| End session | `Esc` while the timer has focus |

Everything else — focus duration, break length, dark mode, today's focus
history, export and import — lives in the command palette.

## Focus sessions

`⌘Enter` starts a session on the task under the cursor. No modal, no
confirmation. The timer is wall-clock based, so it stays accurate through a
backgrounded tab and survives a page reload mid-session.

Keep editing while it runs: the session stays attached to its task as you
rewrite and reorder the list around it.

When the timer ends you choose — **Done**, **Keep working**, or **Take break**.
Nothing is ever marked complete just because a timer expired. And completing a
task early ends the session and tells you what it cost:

```text
✓ Highrise - Claude data setup
17 minutes focused
```

## Development

```bash
npm test        # unit tests
npm run build   # typecheck + production build
```

Logic lives in modules with no DOM or CodeMirror dependency and is tested
directly: `src/doc/grammar.ts` and `paste.ts` (the line grammar),
`src/doc/edits.ts` (editing as pure `state -> transaction` functions),
`src/focus/timer.ts` and `session.ts` (the clock and the state machine), and
`src/data/` (storage and history). `src/main.ts` is wiring only.

Storage is `localStorage`, per browser. There is no account and no server.
