# Claude Mux — Desktop App

Native Electron app. Terminal-first UI for running Claude Code sessions across multiple workspaces.

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│  Electron main (electron/main.js)                        │
│  - Spawns claude CLI via node-pty (real PTY, not pipe)   │
│  - One PTY per session, keyed by sessionId               │
│  - IPC: pty:spawn / pty:write / pty:resize / pty:kill    │
├─────────────────────────────────────────────────────────┤
│  Preload (electron/preload.js)                           │
│  - contextBridge exposes window.api to renderer          │
│  - Bidirectional: renderer calls invoke, main pushes data│
├─────────────────────────────────────────────────────────┤
│  Renderer (React + Vite + Tailwind)                      │
│  - xterm.js renders terminal output                      │
│  - addon-fit auto-resizes to container                   │
│  - Per-session output buffer → replay on tab switch      │
└─────────────────────────────────────────────────────────┘
```

## Stack

| Layer | Choice | Why |
|---|---|---|
| Shell | Electron 35 | Native window, PTY access, no browser sandbox |
| Terminal | xterm.js + addon-fit | Battle-tested, handles ANSI/IME/resize |
| PTY | node-pty 1.1 | Real pseudo-terminal, not a pipe — Claude CLI needs it |
| UI | React 19 + TypeScript | Component model for sidebar/tabs/panels |
| Styling | Tailwind CSS 3 | `tm-*` token namespace, monospace everywhere |

## Run

```bash
cd workspace2
npm install
npm run dev      # Vite (renderer) + Electron (main) via concurrently
```

If you hit port conflicts from a previous run, kill stray processes:
```bash
powershell -ExecutionPolicy Bypass -File kill-ports.ps1
```

## File Structure

```
workspace2/
├── electron/
│   ├── main.js          # PTY lifecycle, IPC handlers
│   └── preload.js       # contextBridge API surface
├── src/
│   ├── App.tsx          # All UI: sidebar, tabs, terminal, right panel
│   ├── main.tsx         # React root
│   └── index.css        # Base styles + xterm overrides
├── tailwind.config.js   # tm-* color tokens
├── vite.config.ts       # Renderer build config
└── package.json
```

## Design Tokens (`tm-*`)

```
bg      #0A0A0A   body background
surface #0F0F0F   sidebar/panel background
panel   #141414   section headers
active  #1A1A1A   hover/selected rows
border  #2a2a2a   dividers
text    #FAFAFA   primary text
muted   #6B7280   secondary text
green   #10B981   active state, cursor, adds
amber   #F59E0B   warnings, modifications
red     #EF4444   errors, deletions
cyan    #06B6D4   git hunks, info
```

---

## Planned Features

### Workspace Tabs
Each workspace gets a tab. Tabs survive session restarts. Active tab shows workspace name + color dot. Switching tabs mounts a different `<TerminalPane>` with its own buffered output.

### Session Management
Multiple sessions per workspace (e.g. `feat/auth`, `fix/login`). Each session = one node-pty instance. Sessions are listed in the sidebar under each workspace. New session button spawns a fresh PTY.

### Model Selection
Dropdown or command palette to switch between `claude-sonnet-4-6`, `claude-opus-4-6`, `claude-haiku-4-5`. Passed as `--model` flag when spawning the PTY. Shown in status bar.

### Diff View
See section below.

### Git Tree
See section below.

---

## How to Build: Diff View

**Data source**: run `git diff HEAD` (or `git diff --cached`) via `child_process.execFile` in the main process. Send raw unified diff text to renderer via IPC.

**Parsing**: split on `\n` and classify each line:
```ts
type DiffLine =
  | { type: 'hunk';    text: string }   // @@ -1,4 +1,6 @@
  | { type: 'add';     text: string }   // + added line
  | { type: 'remove';  text: string }   // - removed line
  | { type: 'context'; text: string }   //   unchanged line
  | { type: 'file';    text: string }   // diff --git a/... b/...
```

**Render**: a virtualized list (react-window or simple `overflow-y: auto`) where each row gets a background color:
- add → `bg-tm-green/10` + `text-tm-green`, left border `border-l-2 border-tm-green`
- remove → `bg-tm-red/10` + `text-tm-red`
- hunk → `bg-tm-panel text-tm-cyan font-bold`
- file → `bg-tm-panel text-tm-text font-bold`
- context → `text-tm-muted`

**Line numbers**: two columns (old / new), computed by tracking offsets from each `@@` hunk header.

**Accept/Reject**: `[y] accept` calls `git apply` with the selected hunk patch. `[n] reject` calls `git checkout -- <file>`. Both go through IPC to main process.

**Auto-refresh**: watch workspace dir with `chokidar` (already a dep of Vite). On any file change, re-run `git diff` and push updated diff to renderer via `win.webContents.send`.

---

## How to Build: Git Tree

**Data source**: two git commands run in main process:
```bash
git status --porcelain=v1   # changed files with XY status codes
git log --oneline -20       # recent commits (optional, for history view)
```

**Parsing `--porcelain=v1`**: each line is `XY path` where X = index status, Y = worktree status:
```ts
type GitFile = {
  path: string
  indexStatus: 'M' | 'A' | 'D' | 'R' | '?' | ' '
  workStatus:  'M' | 'A' | 'D' | 'R' | '?' | ' '
}
```

**Render**: flat list grouped by directory. Each file row shows:
- Status badge: `M` amber, `A` green, `D` red, `?` muted (untracked)
- File path (dirname muted, basename bright)
- Click → triggers `git diff HEAD -- <file>` and opens diff in right panel

**Tree structure**: split paths on `/`, build a prefix tree, render with indentation. Collapse/expand directories. Or keep it flat for the demo — simpler and easier to scan.

**Staging**: checkbox next to each file → `git add <file>` or `git restore --staged <file>` via IPC. Commit button at bottom → `git commit -m "..."` with an inline text input.

**Auto-refresh**: same `chokidar` watcher as diff view. Git status is fast (~10ms), re-run on every file change.
