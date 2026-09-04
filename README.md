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
| Focus on several tasks at once | select the lines, then `⌘Enter` |
| Start without the keyboard | the **Start** button in the panel |
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

The command palette (`⌘K`, `Esc` to close) holds the five things with no other
route, ordered by how often you reach for them: timer settings, clear completed
tasks, dark mode, turn into header, restore an earlier version. Anything you can already reach with a key —
or with a button on screen during a session — deliberately stays out of it.

`⌘/` (or the button in the top bar) lists every shortcut.

**Timer settings** is where focus length, break length and count-up live.

Notifications are on by default and are controlled through your browser's own
per-site settings. There is no export or import: the document is plain text,
so select it and copy.

## Focus sessions

`⌘Enter` starts a session on the task under the cursor. No modal, no
confirmation. The idle panel names that task and offers a **Start** button, so
there is a pointer route too — which is what makes the app usable on a phone
without a separate mobile design.

Select several lines first and `⌘Enter` covers all of them in **one** session —
still one timer and one stretch of work, it just spans a few tasks. Headers and
blank lines in the selection are skipped, the panel names the first task and
counts the rest, and **Done** completes the group. A session also ends by
itself once every task in it is ticked off. The timer is wall-clock based, so it stays accurate through a
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

Most suites are pure logic in `node`; the ones that need a DOM opt in with a
`@vitest-environment jsdom` docblock. `src/sync/pad.test.ts` runs the sync
wiring against a fake server implementing the Worker's contract, which is where
a silent data loss would actually happen.

Logic lives in modules with no DOM or CodeMirror dependency and is tested
directly: `src/doc/grammar.ts` and `paste.ts` (the line grammar),
`src/doc/edits.ts` (editing as pure `state -> transaction` functions),
`src/focus/timer.ts` and `session.ts` (the clock and the state machine), and
`src/data/` (storage and history). `src/main.ts` is wiring only.

Storage is `localStorage`, per browser. There is no account and no server —
that is the default and the ordinary way to use Sprintpad.

**Earlier versions.** Undo only reaches back as far as the current page — a
reload throws its history away. So the document is copied every few minutes as
you work, keeping the last dozen states, and `⌘K → Restore an earlier version`
brings one back. Restoring is itself an edit: it is undoable, and the text it
replaced becomes a version of its own.

**Sync across devices (advanced, off by default).** `⌘K → Sync across devices`
turns on an opt-in mode that keeps one pad in step across browsers. Until you
turn it on, nothing leaves the machine.

**A pad is a URL.** Name one `happy` and it lives at `sprintpad.app/happy`,
which opens the same list on any device given the password. The root is never a
pad: `sprintpad.app` on its own is always the local browser list, and it keeps
its own document, history and session, entirely separate from every pad.

`⌘K → Pads` lists the pads this device knows, shows which is open, and is where
you make and remove them. A new pad starts as a **copy of the list you are
looking at**, so turning your local list into a synced one takes a name and a
password and nothing else — and the local list stays where it was.

Removing a pad comes in two strengths, deliberately: **Remove here** forgets it
on this device only, while **Delete** removes it for every device and needs a
second click. Renaming is not offered; make a new pad and delete the old one.

You are not asked for a server — the endpoint is a deployment detail baked in
at build time (`VITE_SYNC_ENDPOINT` for self-hosters). Nothing is written until
a sync actually succeeds, so a wrong password leaves the browser exactly as it
was rather than wedging later loads in a state that needs repairing.

The password is not a login — it is the encryption key. The pad is encrypted in
your browser with AES-GCM under a key stretched from that password
(PBKDF2-SHA256, 310k iterations), so the server only ever holds an unreadable
blob. That is why the backend has no accounts, no password hashes and no auth
logic: there is nothing for it to check.

Two consequences, neither of which can be softened:

- **A forgotten password cannot be reset.** Nobody can read the pad without it.
- Anyone with both the pad name and the password can read your list.

A memorable name is a guessable one, so writes carry a token derived from the
password alongside the encryption key. Guessing `happy` gets you ciphertext you
can neither read nor overwrite; the token is useless for reading and is never
returned by the server. A pad with no token yet belongs to its first writer.

If two devices edit the same pad apart, you are asked which to keep rather than
one silently winning — and the other side is still in `Restore an earlier
version`, because joining or pulling a pad snapshots what was here first.

The server is `worker/` — a Cloudflare Worker of about sixty lines over a KV
namespace. See `worker/README.md` to deploy your own.

**Offline.** The app installs as a PWA and its files are cached, so it opens
without a network. One consequence worth knowing: a page load is served from
cache, so a new deploy appears on the *next* load rather than the one where it
was fetched. Reload twice if you are checking whether something shipped. Your list never needed a server; now the page doesn't
either. A deploy is picked up on the next load rather than stranding you on a
cached build.

The deployed site loads [GoatCounter](https://www.goatcounter.com) for pageview
counts — no cookies, and nothing from your document leaves the browser: the app
is a single page, so the only path it can record is `/`. `count.js` ignores
localhost and private networks, so development is never counted.
