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
- A thin rule in the left margin marks the line under the cursor, so it is
  always clear which task `⌘Enter` and `⌘D` will act on.

Paste a list of plain lines and they are simply tasks. Pasting a markdown
checklist works too: `- [ ]`, `- [x]` and `☐`/`☑` are all understood. To get
your list out, select it and copy — it is plain text.

## Keys

| Action | Key |
| --- | --- |
| New task | `Enter` |
| Step back out of a nested task | `Enter` again on the empty line |
| Start focus on the task at the cursor | `⌘Enter` |
| Complete task | `⌘D` |
| Unwrap a header or completed task | `Backspace` at the head of the text |
| Make a line a header | type `# `, or "Toggle header" in `⌘K` |
| Move task up / down | `⌘↑` / `⌘↓` (or `⌥↑` / `⌥↓`) |
| Indent / outdent | `Tab` / `⇧Tab` |
| Undo / redo | `⌘Z` / `⇧⌘Z` |
| Search | `⌘F` |
| Command palette | `⌘K` |
| Keyboard shortcuts | `⌘/` |
| Pause / resume / keep working | `⇧⌘Space` |
| Done — complete the focused task | `⇧⌘⏎` |
| Take a break | `⇧⌘B` |
| End session | `⇧⌘.` |

The command palette (`⌘K`, `Esc` to close) holds the four things with no other
route, ordered by how often you reach for them: timer settings, clear completed
tasks, dark mode, turn into header. Anything you can already reach with a key —
or with a button on screen during a session — deliberately stays out of it.

`⌘/` (or the button in the top bar) lists every shortcut.

**Timer settings** is where focus length, break length and count-up live.

Notifications are on by default and are controlled through your browser's own
per-site settings. There is no export or import: the document is plain text,
so select it and copy.

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

## Deploying

Pushing to `main` builds and publishes to GitHub Pages via
`.github/workflows/deploy.yml`. The workflow runs the tests first, so a failing
suite blocks the deploy.

The custom domain lives in `public/CNAME`, which Vite copies into `dist/`.
Changing the domain means changing that file — the Pages setting alone is not
enough, since each deploy overwrites it.

### DNS for sprintpad.app

Managed at Porkbun. Delete the parking records first (the `207.207.210.x` A
records and the `www` record pointing at `pixie.porkbun.com`), then add:

| Type | Host | Value |
| --- | --- | --- |
| A | `@` | `185.199.108.153` |
| A | `@` | `185.199.109.153` |
| A | `@` | `185.199.110.153` |
| A | `@` | `185.199.111.153` |
| AAAA | `@` | `2606:50c0:8000::153` |
| AAAA | `@` | `2606:50c0:8001::153` |
| AAAA | `@` | `2606:50c0:8002::153` |
| AAAA | `@` | `2606:50c0:8003::153` |
| CNAME | `www` | `wabi-charles.github.io.` |

`.app` is on the HSTS preload list, so HTTPS is not optional — browsers refuse
the site outright without a valid certificate, rather than warning. GitHub
issues one automatically once DNS resolves, which can take up to 24 hours.
**Enforce HTTPS** in Settings → Pages stays greyed out until then; it must be
ticked once available.

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
