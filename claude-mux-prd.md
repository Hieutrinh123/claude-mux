# Claude Mux — Product Requirements Document

> A desktop GUI wrapper for Claude Code CLI. Claude Code does the work; this app makes it visual.
> Auth: reuses existing `claude login` session — no API key required.

---

## Table of Contents

1. [Product Overview](#1-product-overview)
2. [Architecture](#2-architecture)
3. [Data Flow](#3-data-flow)
4. [Persistence](#4-persistence)
5. [Error Logging](#5-error-logging)
6. [User Flows & User Stories](#6-user-flows--user-stories)

---

## 1. Product Overview

Claude Mux is a desktop application (Electron) that provides a GUI shell around the Claude Code CLI. It does **not** reimplement AI logic — it spawns the local `claude` binary in a real PTY and renders the raw terminal output via xterm.js.

### Core Principles

- Claude Code handles all AI logic, tool execution, file writes, and session management
- The app spawns `claude` in a real PTY and renders raw terminal output — no JSON parsing
- No ANSI parsing at the app level — xterm.js handles it natively
- Auth is handled by `claude login` — credentials live at `~/.claude/.credentials.json`
- Every error must be self-diagnosable from the log file alone — no user debugging required

---

## 2. Architecture

### 2.1 Tech Stack

| Layer | Choice | Notes |
|-------|--------|-------|
| App shell | Electron 35 (Node.js) | No Rust — runs entirely on Node.js |
| Frontend | React 19 + TypeScript | Vite dev server, loaded into Electron BrowserWindow |
| Styling | Tailwind CSS | Dark monospace terminal aesthetic |
| Terminal | xterm.js (`@xterm/xterm`) | Full PTY rendering, FitAddon for responsive sizing |
| Process bridge | `node-pty` | Spawns `claude` in a real PTY with full terminal emulation |
| IPC | Electron `ipcMain` / `ipcRenderer` | Main process pushes PTY data to renderer |
| Persistence | localStorage | Workspaces and settings only; sessions are ephemeral |
| Git | `child_process.execFile` | Runs `git` commands in main process, results sent via IPC |

### 2.2 Process Architecture

```
┌─────────────────────────────────────────────────────────┐
│  Electron Main Process (Node.js)                        │
│                                                         │
│  ┌────────────────────────────────────────────────┐     │
│  │  PTY Manager (node-pty)                        │     │
│  │  Map<sessionId, IPty>                          │     │
│  │                                                │     │
│  │  spawn: claude [--model <id>] --cwd <workspace>│     │
│  │  (raw PTY — no --output-format stream-json)    │     │
│  └───────────────────────┬────────────────────────┘     │
│                          │ IPC                          │
│  ┌───────────────────────▼────────────────────────┐     │
│  │  Git IPC Handler                               │     │
│  │  git:status → execFile git diff/log/status     │     │
│  └───────────────────────┬────────────────────────┘     │
└──────────────────────────┼──────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────┐
│  Electron Renderer Process (React + TypeScript)         │
│                                                         │
│  ┌──────────┐  ┌──────────────────┐  ┌───────────────┐  │
│  │ Sidebar  │  │ Multi-pane layout │  │ Right Panel   │  │
│  │ Workspaces│  │ TerminalPane ×N  │  │ git_tree tab  │  │
│  │ Sessions │  │ PaneHeader       │  │ diff tab      │  │
│  └──────────┘  └──────────────────┘  └───────────────┘  │
└─────────────────────────────────────────────────────────┘
```

### 2.3 IPC Channel Reference

| Channel | Direction | Payload | Purpose |
|---------|-----------|---------|---------|
| `pty:spawn` | Renderer → Main | `{ sessionId, cwd, model, cols, rows }` | Spawn a new claude PTY |
| `pty:write` | Renderer → Main | `{ sessionId, data }` | Write keystrokes to PTY stdin |
| `pty:resize` | Renderer → Main | `{ sessionId, cols, rows }` | Resize PTY on layout change |
| `pty:kill` | Renderer → Main | `sessionId` | Terminate PTY process |
| `pty:data:<sessionId>` | Main → Renderer | `string` | Stream raw PTY output |
| `pty:exit:<sessionId>` | Main → Renderer | `exitCode` | PTY process exited |
| `pty:error:<sessionId>` | Main → Renderer | `string` | PTY spawn/write error |
| `git:status` | Renderer → Main | `{ cwd }` | Get git status, log, and diffs |
| `claude:check` | Renderer → Main | — | Check if claude CLI is installed |
| `dialog:open-folder` | Renderer → Main | — | Show native folder picker |

### 2.4 Binary Resolution

At startup, the main process resolves the absolute path to the `claude` binary:

```
App starts
    │
    ▼
Run: where claude (Windows) / which claude (macOS/Linux)
    │
    ├─ found  → cache absolute path, log it [INFO]
    └─ not found → show "Claude CLI not installed" screen
```

### 2.5 Interaction Model

| Interaction | Mechanism |
|-------------|-----------|
| Send user message | Keystrokes written directly to PTY stdin via xterm.js |
| Allow/deny tool | Keystrokes y/n/a written to PTY stdin |
| Stop streaming | Send SIGINT to child process |
| New chat session | Spawn new PTY process |
| Switch model | Spawn new PTY with `--model <id>` flag |
| Multi-pane | Multiple PTY sessions assigned to panes independently |

---

## 3. Data Flow

### 3.1 Terminal I/O

```
USER TYPES IN PANE
──────────────────────────────────────────────────────────
  xterm.js captures keystrokes
          │
          ▼
  Renderer: pty:write → IPC → Main
          │
          ▼
  node-pty writes bytes to claude PTY stdin

STREAMING RESPONSE
──────────────────────────────────────────────────────────
  claude PTY stdout emits raw bytes (ANSI, text, etc.)
          │
          ▼
  Main: pty:data:<sessionId> → IPC → Renderer
          │
          ▼
  xterm.js renders output directly in pane
  (buffer stored per-session, capped at 3000 lines)
          │
          ▼
  On pane switch → replay buffer into xterm instance


GIT PANEL REFRESH
──────────────────────────────────────────────────────────
  User opens git tab / clicks refresh
          │
          ▼
  Renderer: git:status { cwd } → IPC → Main
          │
          ▼
  Main: execFile git status, git log, git diff
          │
          ▼
  Returns: { files, commits, diffs } → Renderer renders graph + diff
```

---

## 4. Persistence

### 4.1 What Is Persisted

Stored in **localStorage** under the following keys:

| Key | Contents |
|-----|----------|
| `cm:workspaces` | Array of workspace objects (id, name, path, color, initial) |
| `cm:settings` | Default model, skipPermissions flag, sessionLayout config |

### 4.2 What Is Not Persisted

- **Sessions** — ephemeral, exist only while the app is running; cleared on restart
- **Terminal buffers** — in-memory only, lost on close
- **Chat history** — not stored; Claude CLI handles its own session state via `~/.claude/`
- **Git state** — always fetched live from disk

### 4.3 Workspace Color Palette

Six rotating colors assigned to workspaces: `#10B981` (green), `#3B82F6` (blue), `#F59E0B` (amber), `#EF4444` (red), `#8B5CF6` (purple), `#06B6D4` (cyan).

---

## 5. Error Logging

### Log File Location

```
Windows: %APPDATA%\claude-mux\logs\claude-mux.log
macOS:   ~/Library/Logs/claude-mux/claude-mux.log
Linux:   ~/.config/claude-mux/logs/claude-mux.log
```

### Log Format (structured JSON lines)

```json
{ "ts": "2026-03-26T10:34:12.441Z", "level": "ERROR", "layer": "pty", "fn": "ptySpawn", "msg": "PTY stdin closed", "session_id": "abc123", "error": "BrokenPipe" }
{ "ts": "2026-03-26T10:34:13.001Z", "level": "WARN",  "layer": "git", "fn": "gitStatus", "msg": "Not a git repo", "cwd": "/tmp/foo" }
{ "ts": "2026-03-26T10:34:15.220Z", "level": "INFO",  "layer": "pty", "fn": "ptySpawn", "msg": "PTY spawned", "session_id": "abc123", "cwd": "/projects/foo" }
```

### Log Levels

| Level | When |
|-------|------|
| `ERROR` | User-visible failure — PTY crash, unhandled exception |
| `WARN` | Recoverable unexpected state — git not found, missing optional field |
| `INFO` | Significant lifecycle events — app start, workspace created, PTY spawned |
| `DEBUG` | High-frequency detail — every PTY chunk |

Production builds: INFO and above. Debug builds: all levels.

---

## 6. User Flows & User Stories

Story code format: `UF_[FLOW]_US_[NNN]`

---

### UF_ONBOARD — First-Run Onboarding

```
Open app
    │
    ▼
Check: claude binary resolvable?
    ├─ No  → UF_ONBOARD_US_001: show "Claude CLI not found" screen
    └─ Yes
         │
         ▼
    Any workspaces in localStorage?
         ├─ No  → UF_ONBOARD_US_003: show New Workspace (0 state)
         └─ Yes → skip to UF_WORKSPACE flow
```

| Code | User Story | Screen |
|------|------------|--------|
| `UF_ONBOARD_US_001` | As a new user whose machine does not have the Claude CLI installed, I see a clear error screen with instructions to install it | First-run — CLI not found |
| `UF_ONBOARD_US_003` | As a brand-new user who has no workspaces yet, I see a clean welcome state with a single CTA | New Workspace — 0 workspaces |
| `UF_ONBOARD_US_004` | As a new user I can complete workspace creation with a single "Create Workspace" button click | New Workspace — CTA |

---

### UF_WORKSPACE — Workspace Management

```
Sidebar visible
    │
    ├─ 0 workspaces  → "New Workspace" CTA
    └─ N workspaces  → list in sidebar
              │
              ├─ Click workspace → toggle expand/collapse
              ├─ Click "+ new_workspace" footer → open NewWorkspaceModal
              └─ Hover → delete button appears
```

| Code | User Story | Screen |
|------|------------|--------|
| `UF_WORKSPACE_US_001` | As a new user I can create my first workspace so I have a place to organise my work | New Workspace — 0 workspaces |
| `UF_WORKSPACE_US_002` | As a returning user I can create an additional workspace from the footer button | Sidebar — footer button |
| `UF_WORKSPACE_US_003` | As a user I can name my workspace and pick a local folder when creating it | NewWorkspaceModal |
| `UF_WORKSPACE_US_004` | As a user I can open a local folder as the workspace source | NewWorkspaceModal — folder picker |
| `UF_WORKSPACE_US_008` | As a user I can delete a workspace with a confirmation prompt | DeleteWorkspaceDialog |
| `UF_WORKSPACE_US_009` | As a user I can collapse a workspace in the sidebar to save space | Sidebar — collapsed |
| `UF_WORKSPACE_US_010` | As a user I can expand a collapsed workspace to reveal its sessions list | Sidebar — expanded |
| `UF_WORKSPACE_US_012` | As a user I can visually distinguish workspaces by their unique colour badge | Sidebar — colour badges |

---

### UF_SESSION — Chat Session Management

```
Workspace selected
    │
    ▼
Sessions list visible under workspace in sidebar
    │
    ├─ Click session  → activate, spawn PTY if not yet spawned
    └─ Click "+ new session" → create session, spawn new PTY

Multi-pane layout:
    Each pane has a PaneHeader dropdown → assign any session to any pane
```

| Code | User Story | Screen |
|------|------------|--------|
| `UF_SESSION_US_001` | As a user I can start a new chat session within the active workspace | Sidebar — "+ new session" |
| `UF_SESSION_US_002` | As a user I can see all sessions grouped under their parent workspace in the sidebar | Sidebar — session tree |
| `UF_SESSION_US_003` | As a user I can switch between sessions by clicking them in the sidebar | Sidebar — session list |
| `UF_SESSION_US_004` | As a user I can assign any session to any pane via the per-pane dropdown | PaneHeader — session picker |
| `UF_SESSION_US_005` | As a user switching to an already-spawned session replays its output buffer | Terminal — buffer replay |
| `UF_SESSION_US_006` | As a user sessions are numbered sequentially (session_1, session_2, …) and reset after deletion | Session numbering |

---

### UF_LAYOUT — Multi-Pane Layout

```
Topbar layout picker button clicked
    │
    ▼
LayoutPickerModal shows 6 options with icons
    │
    └─ Select layout → pane grid updates, sessions reassigned
```

| Code | User Story | Screen |
|------|------------|--------|
| `UF_LAYOUT_US_001` | As a user I can switch between single, split, hstack, master, quad, and three-column layouts | LayoutPickerModal |
| `UF_LAYOUT_US_002` | As a user each pane independently shows whichever session I assign to it | PaneHeader — session picker |
| `UF_LAYOUT_US_003` | As a user the layout picker is anchored to its toolbar button so it does not obscure the panes | LayoutPickerModal — anchored |

---

### UF_MODEL — Model Selection

| Code | User Story | Screen |
|------|------------|--------|
| `UF_MODEL_US_001` | As a user I can open a model picker to change the AI model | ModelPicker |
| `UF_MODEL_US_002` | As a user I can set a default model in Settings that applies to new sessions | Settings — default model |
| `UF_MODEL_US_003` | As a user the model I select is passed as `--model <id>` when spawning a PTY | PTY spawn |

---

### UF_GIT — Git Panel

```
User clicks git_tree tab in right panel
    │
    ▼
git:status IPC → main executes git commands for workspace cwd
    │
    ├─ Visual commit graph rendered with colored branch lanes
    ├─ Refs (HEAD, branches, tags) shown inline
    ├─ Hover tooltip: full hash, author, date
    └─ Click commit → diff tab populated with that commit's changes

User clicks diff tab
    │
    ├─ File list with +added / -removed counts
    ├─ Per-file diff with line-level green/red highlighting
    └─ Long lines truncated with hover popup for full content
```

| Code | User Story | Screen |
|------|------------|--------|
| `UF_GIT_US_001` | As a user I can see a visual commit graph with colored branch lanes | Right panel — git_tree |
| `UF_GIT_US_002` | As a user I can hover a commit to see its full hash, author, and date | git_tree — hover tooltip |
| `UF_GIT_US_003` | As a user I can click a commit to see its diff in the diff tab | diff tab |
| `UF_GIT_US_004` | As a user I can see modified, added, and deleted files with +/− line counts | diff tab — file list |
| `UF_GIT_US_005` | As a user long diff lines are truncated but fully visible on hover | diff tab — hover popup |
| `UF_GIT_US_006` | As a user I can collapse the right panel to a narrow strip for more terminal space | Right panel — collapsed strip |
| `UF_GIT_US_007` | As a user I am shown a "no git repo" state if the workspace is not a git repository | Right panel — no repo state |

---

### UF_ERROR — Error Handling

| Code | User Story | Screen |
|------|------------|--------|
| `UF_ERROR_US_001` | As a user if the claude CLI is not installed I see an installation prompt, not a blank screen | FirstRunNoCli screen |
| `UF_ERROR_US_002` | As a user if the claude PTY crashes I see a clear error rather than a frozen terminal | Terminal — PTY exit handling |

---

### UF_SETTINGS — App Settings

| Code | User Story | Screen |
|------|------------|--------|
| `UF_SETTINGS_US_001` | As a user I can open a Settings panel from the sidebar | Settings screen |
| `UF_SETTINGS_US_002` | As a user I can set a default Claude model (opus/sonnet/haiku) for new sessions | Settings — model selector |
| `UF_SETTINGS_US_003` | As a user I can toggle "skip permissions" to bypass tool permission prompts | Settings — skip permissions |
| `UF_SETTINGS_US_004` | As a user my settings are persisted to localStorage and restored on restart | localStorage — cm:settings |

---

*End of document.*
