# Claude Mux — Desktop App

Native Electron app. Terminal-first UI for running Claude Code sessions across multiple workspaces.

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│  Electron main (electron/main.js)                        │
│  - Spawns claude CLI via node-pty (real PTY, not pipe)   │
│  - One PTY per session, keyed by sessionId               │
│  - IPC: pty:spawn / pty:write / pty:resize / pty:kill    │
│  - IPC: file:read → readFile for file-viewer sessions    │
│  - IPC: file:save → writeFile for clipboard images       │
│  - Git IPC: git:status → execFile git diff/log/status   │
├─────────────────────────────────────────────────────────┤
│  Preload (electron/preload.js)                           │
│  - contextBridge exposes window.api to renderer          │
│  - Bidirectional: renderer calls invoke, main pushes data│
├─────────────────────────────────────────────────────────┤
│  Renderer (React + Vite + Tailwind)                      │
│  - xterm.js renders claude sessions (PTY output)         │
│  - React text renderer for file-viewer sessions          │
│  - addon-fit auto-resizes to container                   │
│  - Per-session output buffer → replay on tab switch      │
│  - Multi-pane layout engine (single/split/hstack/etc.)   │
│  - Clipboard: text + image paste support                 │
└─────────────────────────────────────────────────────────┘
```

## Stack

| Layer | Choice | Why |
|---|---|---|
| Shell | Electron 35 | Native window, PTY access, no browser sandbox |
| Terminal | xterm.js + addon-fit | Battle-tested, handles ANSI/IME/resize, 25k line scrollback |
| PTY | node-pty 1.1 | Real pseudo-terminal, not a pipe — Claude CLI needs it |
| UI | React 19 + TypeScript | Component model for sidebar/tabs/panels |
| Styling | Tailwind CSS 3 | `tm-*` token namespace, monospace everywhere |
| Persistence | localStorage | Workspaces + settings; sessions are ephemeral |

## Run

Double-click **`launch.bat`** to start the app.

Or from a terminal:
```bash
npm install   # first time only
npm run dev   # Vite (renderer) + Electron (main) via concurrently
```

## Session Types

The app supports two session types:

| Type | Description |
|---|---|
| `claude` | Standard Claude CLI session via PTY — full terminal with model execution |
| `file-viewer` | Read-only file viewer with syntax highlighting — no PTY, just React renderer |

When creating a new session, a type picker modal appears. File-viewer sessions open a native file picker dialog scoped to the workspace folder.

## Clipboard Support

Terminal panes support:
- **Text paste** — Ctrl+V / Cmd+V pastes text from clipboard
- **Image paste** — Pasting an image from clipboard saves it to the workspace and inserts the file path
- **Copy** — Select text and Ctrl+C / Cmd+C to copy, or right-click selection

## File Structure

```
workspace2/
├── electron/
│   ├── main.js          # PTY lifecycle, git IPC handlers
│   └── preload.js       # contextBridge API surface
├── src/
│   ├── App.tsx          # Root: screen routing, all app state
│   ├── main.tsx         # React root
│   ├── storage.ts       # localStorage helpers (workspaces, settings)
│   ├── types.ts         # Shared TypeScript types
│   ├── components/
│   │   ├── TerminalPane.tsx   # xterm.js wrapper, PTY events, buffer, file viewer
│   │   └── PaneHeader.tsx     # Per-pane session picker dropdown
│   ├── screens/
│   │   ├── FirstRunNoCli.tsx  # "Claude CLI not found" screen
│   │   └── Settings.tsx       # Settings screen (model, permissions)
│   ├── modals/
│   │   ├── NewWorkspaceModal.tsx
│   │   ├── DeleteWorkspaceDialog.tsx
│   │   ├── ModelPicker.tsx
│   │   ├── LayoutPickerModal.tsx
│   │   ├── SessionTypeModal.tsx    # Claude vs file-viewer picker
│   │   └── FilePickerModal.tsx     # Native file picker bridge
│   └── index.css        # Base styles + xterm overrides
├── launch.bat           # Double-click launcher for normal users
├── tailwind.config.js   # tm-* color tokens
├── vite.config.ts       # Renderer build config
├── package.json
└── video/               # Remotion project for intro/demo videos
```

## Layout Modes

The pane layout is switchable from the topbar picker:

| Mode | Description |
|---|---|
| `single` | One full terminal pane |
| `split` | Two panes side by side |
| `hstack` | Two panes stacked vertically |
| `master` | One large left + two stacked right |
| `quad` | 2×2 grid |
| `three` | Three equal columns |

Each pane has an independent session picker dropdown — any session can be assigned to any pane.

## Right Panel

The right panel (320px, collapsible to 32px strip) has two tabs:

- **git_tree** — visual commit graph with colored branch lanes, refs, hover tooltips; click a commit to diff it
- **diff** — per-file diff with line-level add/remove highlighting, +/− stats, long-line hover popups

## Settings

Access via gear icon in topbar. Available settings:

| Setting | Description |
|---|---|
| **Default model** | Model used when creating new sessions (opus-4, sonnet-4, haiku-4) |
| **Skip permissions** | Pass `--dangerously-skip-permissions` to every Claude CLI spawn |

Settings persist to `localStorage` and apply globally across all workspaces.

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
