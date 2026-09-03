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
# TODAY
Highrise - Claude data setup
[x] Pay taxes
  A subtask, indented two spaces

# BACKLOG
Anything else
```

- **Every line is a task.** Just type. There are no markers to remember. If you
  type `[]` out of habit at the head of an empty task, it is absorbed rather
  than left sitting next to the checkbox. Press `[` twice for a real bracket.
- `Enter` opens the next task and shows you an empty checkbox, like a bullet
  list. Press it again on that empty line to step back out one indent level at
  a time; at the left margin the checkbox goes away and you have plain blank
  space. Nothing is written to the file until you type, so an abandoned line
  leaves no stray marker behind.
- A line starting with `#` is a header.
- `[x] ` marks a task complete, but you never type it — `⌘D` and the checkbox
  write it for you.
- Indentation is two spaces per level.
- **Position is priority.** There are no priority fields — move the important
  thing to the top.

Paste a list of plain lines and they are simply tasks. Pasting a markdown
checklist works too: `- [ ]`, `- [x]` and `☐`/`☑` are all understood.

## Keys

| Action | Key |
| --- | --- |
| New task | `Enter` |
| Step back out of a nested task | `Enter` again on the empty line |
| Start focus on the task at the cursor | `⌘Enter` |
| Complete task | `⌘D` |
| Make a line a header | type `# `, or "Toggle header" in `⌘K` |
| Move task up / down | `⌘↑` / `⌘↓` (or `⌥↑` / `⌥↓`) |
| Indent / outdent | `Tab` / `⇧Tab` |
| Undo / redo | `⌘Z` / `⇧⌘Z` |
| Search | `⌘F` |
| Command palette | `⌘K` |
| Pause / resume | `Space` while the timer has focus, or `⇧⌘Space` anywhere |
| End session | `Esc` while the timer has focus |

The command palette (`⌘K`, `Esc` to close) holds the nine things with no other
route: toggle header, clear completed tasks, today's focus, focus duration,
count up, break length, dark mode, export and import. Anything you can already
reach with a key — or with a button on screen during a session — deliberately
stays out of it.

Notifications are on by default and are controlled through your browser's own
per-site settings.

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
