# Claude Mux — Product Requirements Document

> A desktop GUI wrapper for Claude Code CLI. Claude Code does the work; this app makes it visual.
> Auth: reuses existing `claude login` session — no API key required.

---

## Table of Contents

1. [Product Overview](#1-product-overview)
2. [Architecture](#2-architecture)
3. [Data Flow](#3-data-flow)
4. [Database Schema](#4-database-schema)
5. [Error Logging](#5-error-logging)
6. [User Flows & User Stories](#6-user-flows--user-stories)

---

## 1. Product Overview

Claude Mux is a desktop application (Electron) that provides a GUI shell around the Claude Code CLI. It does **not** reimplement AI logic — it spawns the local `claude` binary, communicates over structured JSON (NDJSON), and translates the output into visual UI components.

### Core Principles

- Claude Code handles all AI logic, tool execution, file writes, and session management
- The app spawns `claude --output-format stream-json` and reads JSON events line by line
- No ANSI parsing, no keystroke guessing, no API key prompts
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
| Persistence | `better-sqlite3` | Embedded SQLite, local-first, zero infra |
| Git | `simple-git` | File tree, diff, history — pure JS, no compilation |
| FS watch | `chokidar` | Watch workspace folder for changes |

### 2.2 Process Architecture

```
┌─────────────────────────────────────────────────────────┐
│  Electron Main Process (Node.js)                        │
│                                                         │
│  ┌──────────┐    ┌────────────────────────────────┐    │
│  │ SQLite   │    │  PTY Manager (node-pty)         │    │
│  │ (better- │    │  Map<sessionId, IPty>           │    │
│  │  sqlite3)│    │                                 │    │
│  └──────────┘    │  spawn: claude --output-format  │    │
│                  │         stream-json             │    │
│                  │         [--model <id>]          │    │
│                  │         [--resume <session_id>] │    │
│                  │         --cwd <workspace>       │    │
│                  └────────────────┬───────────────┘    │
│                                   │ IPC                 │
└───────────────────────────────────┼─────────────────────┘
                                    │
┌───────────────────────────────────▼─────────────────────┐
│  Electron Renderer Process (React + TypeScript)         │
│                                                         │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌────────┐  │
│  │ Sidebar  │  │ Terminal │  │ RightPanel│  │Topbar  │  │
│  │ Workspaces│  │ (xterm)  │  │ Git/Diff  │  │Breadcrumb│ │
│  │ Sessions │  │ TermPane │  │           │  │Status  │  │
│  └──────────┘  └──────────┘  └──────────┘  └────────┘  │
└─────────────────────────────────────────────────────────┘
```

### 2.3 IPC Channel Reference

| Channel | Direction | Payload | Purpose |
|---------|-----------|---------|---------|
| `pty:spawn` | Renderer → Main | `{ sessionId, cwd, model }` | Spawn a new claude PTY |
| `pty:write` | Renderer → Main | `{ sessionId, data }` | Write keystrokes/JSON to PTY stdin |
| `pty:resize` | Renderer → Main | `{ sessionId, cols, rows }` | Resize PTY on layout change |
| `pty:kill` | Renderer → Main | `sessionId` | Terminate PTY process |
| `pty:data:<sessionId>` | Main → Renderer | `string` | Stream raw PTY output |
| `pty:exit:<sessionId>` | Main → Renderer | `exitCode` | PTY process exited |
| `pty:error:<sessionId>` | Main → Renderer | `string` | PTY spawn/write error |

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

This avoids issues with PATH, nvm, Volta, or other version managers at spawn time.

### 2.5 Claude Stream-JSON Event Reference

Claude emits one JSON object per line on stdout (`--output-format stream-json`).

```typescript
type ClaudeStreamEvent =
  | { type: 'system';    subtype: 'init';    session_id: string; model: string }
  | { type: 'assistant'; message: { content: ContentBlock[] } }
  | { type: 'user';      message: { content: ContentBlock[] } }
  | { type: 'result';    subtype: 'success'; session_id: string; cost_usd: number }
  | { type: 'result';    subtype: 'error';   error: string }

type ContentBlock =
  | { type: 'text';        text: string }
  | { type: 'tool_use';    id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; tool_use_id: string; content: string }
```

| Event | Routed to | App action |
|-------|-----------|------------|
| `system / init` | — | Log session start, store `session_id` |
| `assistant / text` | Chat / terminal | Render streamed text |
| `assistant / tool_use` | Permission card | Show Allow / Deny UI, pause input |
| `user / tool_result` | Diff panel | Parse diff, populate panel |
| `result / success` | — | Flush to SQLite, store `session_id` for resume |
| `result / error` | Error banner | Show error message |

### 2.6 Interaction Model

| Interaction | Mechanism |
|-------------|-----------|
| Send user message | Write JSON line to PTY stdin: `{"type":"user","message":"text\n"}` |
| Allow tool | Write `{"type":"user","message":"y\n"}` to stdin |
| Always Allow tool | Write `{"type":"user","message":"a\n"}` to stdin |
| Deny tool | Write `{"type":"user","message":"n\n"}` to stdin |
| Stop streaming | Send SIGINT to child process |
| New chat session | Spawn new `claude --output-format stream-json` process |
| Resume session | Spawn with `--resume <session_id>` (from last `result` event) |
| Switch model | Spawn with `--model <id>` flag |

---

## 3. Data Flow

### 3.1 Single Message Round-Trip

```
USER SENDS MESSAGE
──────────────────────────────────────────────────────────
  User types in xterm input → PTY captures keystrokes
          │
          ▼
  node-pty writes bytes → claude PTY stdin
          │
          ▼
  Claude CLI receives input, begins processing
          │
          ▼
  Claude CLI streams NDJSON → PTY stdout (real-time)


STREAMING RESPONSE
──────────────────────────────────────────────────────────
  node-pty reads PTY stdout chunks
          │
          ▼
  Main: emit pty:data:<sessionId> → IPC → Renderer
          │
          ▼
  xterm.js renders raw output to terminal pane
          │
          ▼
  (If stream-json mode active): parse JSON lines
          ├── type: assistant/text    → streamed text in terminal
          ├── type: assistant/tool_use → show permission card
          ├── type: user/tool_result  → populate diff panel
          └── type: result/success    → flush to SQLite


TOOL PERMISSION (if triggered)
──────────────────────────────────────────────────────────
  Claude emits tool_use event
          │
          ▼
  App shows: command preview + [Deny] [Allow] [Always Allow]
  PTY input paused
          │
          ├─ Allow       → write {"type":"user","message":"y\n"}
          ├─ Always Allow → write {"type":"user","message":"a\n"}
          └─ Deny        → write {"type":"user","message":"n\n"}
                    │
                    ▼
          Claude continues or aborts tool


APP CLOSE / REOPEN
──────────────────────────────────────────────────────────
  App closes → all PTY processes killed (ptySessions.forEach kill)
  App reopens → SQLite load:
    workspaces → restore sidebar
    sessions   → restore session list per workspace
    messages   → restore full chat history
    diffs      → restore any pending diff state
```

---

## 4. Database Schema

```sql
-- Workspaces
CREATE TABLE workspaces (
  id          TEXT PRIMARY KEY,   -- uuid
  name        TEXT NOT NULL,
  folder_path TEXT,               -- null if GitHub-only
  github_url  TEXT,
  color       TEXT NOT NULL,      -- hex, for sidebar badge
  initial     TEXT NOT NULL,      -- first letter for collapsed badge
  created_at  INTEGER NOT NULL,
  last_opened INTEGER
);

-- Chat sessions (one per claude --resume context)
CREATE TABLE sessions (
  id           TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  name         TEXT NOT NULL,
  model        TEXT NOT NULL DEFAULT 'claude-sonnet-4-5',
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL
);

-- Messages
CREATE TABLE messages (
  id         TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id),
  role       TEXT NOT NULL CHECK(role IN ('user','assistant')),
  content    TEXT NOT NULL,   -- raw text
  events     TEXT,            -- JSON array of ClaudeStreamEvent for replay
  created_at INTEGER NOT NULL
);

-- Diff records (linked to message that produced them)
CREATE TABLE diffs (
  id         TEXT PRIMARY KEY,
  message_id TEXT NOT NULL REFERENCES messages(id),
  file_path  TEXT NOT NULL,
  added      INTEGER NOT NULL DEFAULT 0,
  removed    INTEGER NOT NULL DEFAULT 0,
  patch      TEXT NOT NULL,   -- raw unified diff text
  status     TEXT NOT NULL DEFAULT 'pending'
             CHECK(status IN ('pending','accepted','rejected'))
);
```

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
{ "ts": "2026-03-26T10:34:13.001Z", "level": "WARN",  "layer": "parser", "fn": "parseEvent", "msg": "Unknown event type", "raw": "...", "line": 42 }
{ "ts": "2026-03-26T10:34:15.220Z", "level": "INFO",  "layer": "db", "fn": "saveMessage", "msg": "Message saved", "session_id": "abc123", "msg_id": "def456" }
```

### Log Levels

| Level | When |
|-------|------|
| `ERROR` | User-visible failure — PTY crash, DB write fail, unhandled exception |
| `WARN` | Recoverable unexpected state — unknown event, missing optional field |
| `INFO` | Significant lifecycle events — app start, workspace created, PTY spawned |
| `DEBUG` | High-frequency detail — every PTY chunk, every parser state transition |

Production builds: INFO and above. Debug builds: all levels.

---

## 6. User Flows & User Stories

Story code format: `UF_[FLOW]_US_[NNN]`

---

### UF_ONBOARD — First-Run Onboarding

The path a brand-new user takes from cold open to first message sent.

```
Open app
    │
    ▼
Check: claude binary resolvable?
    ├─ No  → UF_ONBOARD_US_001: show "Claude CLI not found" screen
    └─ Yes
         │
         ▼
    Check: ~/.claude/.credentials.json exists?
         ├─ No  → UF_ONBOARD_US_002: show "Not authenticated" screen
         └─ Yes
              │
              ▼
         Any workspaces in SQLite?
              ├─ No  → UF_ONBOARD_US_003: show New Workspace (0 state)
              └─ Yes → skip to UF_WORKSPACE flow
```

| Code | User Story | Screen |
|------|------------|--------|
| `UF_ONBOARD_US_001` | As a new user whose machine does not have the Claude CLI installed, I see a clear error screen with instructions to install it, so I am not left confused by a blank window | First-run — CLI not found |
| `UF_ONBOARD_US_002` | As a user who has the CLI but has not yet run `claude login`, I see an "unauthenticated" screen with a prompt to run the login command, so I know exactly what to do | First-run — not authenticated |
| `UF_ONBOARD_US_003` | As a brand-new user who has no workspaces yet, I see a clean welcome state with a logo and a single CTA, so I am not overwhelmed | New Workspace — 0 workspaces |
| `UF_ONBOARD_US_004` | As a new user I can complete workspace creation with a single "Create Workspace" button click, so onboarding takes as few steps as possible | New Workspace — CTA |
| `UF_ONBOARD_US_005` | As a new user the sidebar shows an empty workspaces state so I understand the concept of workspaces before adding one | New Workspace — empty sidebar |

---

### UF_WORKSPACE — Workspace Management

Creating, opening, and managing workspaces in the sidebar.

```
Sidebar visible
    │
    ├─ 0 workspaces  → "New Workspace" CTA (UF_WORKSPACE_US_001)
    └─ N workspaces  → list in sidebar
              │
              ├─ Click workspace → toggle expand (UF_WORKSPACE_US_004 / 005)
              ├─ Click "+ New Workspace" → UF_WORKSPACE_US_002
              └─ Right-click → Delete (UF_WORKSPACE_US_008)

New Workspace flow:
    Enter name
         │
         ▼
    Choose source:
         ├─ Open local folder  (UF_WORKSPACE_US_003a)
         └─ Clone GitHub repo  (UF_WORKSPACE_US_003b)
                   │
                   ├─ URL invalid    → UF_WORKSPACE_US_006
                   ├─ Clone progress → UF_WORKSPACE_US_007
                   └─ Success → save to SQLite, spawn claude
```

| Code | User Story | Screen |
|------|------------|--------|
| `UF_WORKSPACE_US_001` | As a new user I can create my first workspace so I have a place to organise my work | New Workspace — 0 workspaces |
| `UF_WORKSPACE_US_002` | As a returning user I can create an additional workspace from the "+ New Workspace" button while existing ones stay visible in the sidebar | New Workspace — existing workspaces |
| `UF_WORKSPACE_US_003` | As a user I can name my workspace before creating it so I can recognise it later | New Workspace — name input |
| `UF_WORKSPACE_US_004` | As a user I can open a local folder as the workspace source so I can work on code already on my machine | New Workspace — "Open a folder" |
| `UF_WORKSPACE_US_005` | As a user I can clone a GitHub repo as the workspace source by pasting a URL, supporting both HTTPS and SSH | New Workspace — GitHub URL input |
| `UF_WORKSPACE_US_006` | As a user invalid GitHub URLs are flagged inline immediately so I can correct them before submitting | New Workspace — URL validation error |
| `UF_WORKSPACE_US_007` | As a user I can see a progress indicator while a large repo is being cloned so I know the app has not frozen | New Workspace — clone progress |
| `UF_WORKSPACE_US_008` | As a user I can delete a workspace with a confirmation prompt so accidental deletion is prevented | Delete workspace — confirmation dialog |
| `UF_WORKSPACE_US_009` | As a user I can collapse a workspace in the sidebar to save space, seeing only its coloured initial badge | Sidebar — workspace collapsed |
| `UF_WORKSPACE_US_010` | As a user I can expand a collapsed workspace to reveal its sessions list | Sidebar — workspace expanded |
| `UF_WORKSPACE_US_011` | As a user I can see the active workspace highlighted with a green left-border so I always know where I am | Sidebar — active workspace highlight |
| `UF_WORKSPACE_US_012` | As a user I can visually distinguish workspaces by their unique colour dot/badge even when collapsed | Sidebar — colour badges |
| `UF_WORKSPACE_US_013` | As a user I can cancel workspace creation and return to the previous screen without losing existing data | New Workspace — cancel / back |

---

### UF_SESSION — Chat Session Management

Creating, switching, and managing chat sessions inside a workspace.

```
Workspace selected
    │
    ▼
Sessions list visible under workspace in sidebar
    │
    ├─ Click session  → activate, spawn PTY if not yet spawned
    ├─ Click "+ new session" → create session, spawn new PTY
    └─ Tab bar shows open sessions across top of terminal area
```

| Code | User Story | Screen |
|------|------------|--------|
| `UF_SESSION_US_001` | As a user I can start a new chat session within the active workspace so I can begin a fresh conversation with Claude | Sidebar — "+ new session" |
| `UF_SESSION_US_002` | As a user I can see all sessions grouped under their parent workspace in the sidebar so I can navigate easily | Sidebar — session tree |
| `UF_SESSION_US_003` | As a user I can switch between sessions by clicking them in the sidebar, and the terminal instantly restores to that session's output buffer | Sidebar — session list |
| `UF_SESSION_US_004` | As a user each open session appears as a tab above the terminal so I can switch without using the sidebar | Tab bar — session tabs |
| `UF_SESSION_US_005` | As a user the active session tab is marked with a green top border so I always know which session is focused | Tab bar — active tab indicator |
| `UF_SESSION_US_006` | As a user switching to a session that is already spawned does not restart the claude process — it replays the buffer | Terminal — buffer replay |
| `UF_SESSION_US_007` | As a user the current workspace and session name are shown in the titlebar breadcrumb so context is always visible | Topbar — breadcrumb |
| `UF_SESSION_US_008` | As a user my session list is persisted in SQLite so it survives app restarts | SQLite — sessions table |

---

### UF_CHAT — AI Chat & Messaging

Sending messages, receiving streamed responses, and interacting with Claude's output.

```
Active session open (PTY running)
    │
    ▼
User types in xterm terminal → keystrokes written to PTY stdin
    │
    ▼
Claude CLI receives input → streams NDJSON to stdout
    │
    ├─ text events      → rendered in terminal by xterm
    ├─ tool_use events  → permission card shown (→ UF_TOOL flow)
    ├─ tool_result      → diff panel updated (→ UF_DIFF flow)
    └─ result/success   → flush to SQLite
```

| Code | User Story | Screen |
|------|------------|--------|
| `UF_CHAT_US_001` | As a user I can type a message in the terminal and press Enter to send it to Claude | Terminal — input |
| `UF_CHAT_US_002` | As a user I can see Claude's response streaming in real time in the terminal as it is generated | Terminal — streaming |
| `UF_CHAT_US_003` | As a user I can stop Claude's response mid-stream so I can redirect it without waiting for completion | Terminal — Ctrl+C / stop button |
| `UF_CHAT_US_004` | As a user I can switch between Ask / Plan / Edit interaction modes to change how Claude approaches my request | Status bar — mode tabs |
| `UF_CHAT_US_005` | As a user switching to Plan mode prepends `/plan` to my next input so Claude produces a step-by-step plan before any edits | Status bar — Plan mode |
| `UF_CHAT_US_006` | As a user I can see which mode is currently active via the highlighted mode tab in the status bar | Status bar — active mode |
| `UF_CHAT_US_007` | As a user I am warned when the context window is nearly full so I can start a new session before Claude is cut off | Context limit warning banner |
| `UF_CHAT_US_008` | As a user I can start a new session from the context limit banner, preserving a summary of prior context | Context limit — "New chat →" |
| `UF_CHAT_US_009` | As a user I can attach files to my message so Claude can reference specific code or documents | File attachment — chip UI |
| `UF_CHAT_US_010` | As a user I can see which files are attached before sending and remove any I don't want | File attachment — × on chip |
| `UF_CHAT_US_011` | As a user file attachments are capped at a size limit with a clear error if exceeded | File attachment — size limit error |
| `UF_CHAT_US_012` | As a user my full chat history is persisted locally and restored when I reopen the app | SQLite — messages table |
| `UF_CHAT_US_013` | As a user I can scroll the terminal output independently without affecting other panels | Terminal — independent scroll |
| `UF_CHAT_US_014` | As a user Copy (Ctrl+C with selection) and Paste (Ctrl+V) work correctly inside the terminal | Terminal — clipboard |

---

### UF_MODEL — Model Selection

Choosing which Claude model to use for a session.

```
Model picker opened (from topbar badge or model picker button)
    │
    ├─ See all available models with descriptions
    ├─ See active model highlighted
    ├─ See Pro-only models badged
    └─ Click model → spawn next PTY with --model <id>
```

| Code | User Story | Screen |
|------|------------|--------|
| `UF_MODEL_US_001` | As a user I can open a model picker to change the AI model for my current session | Model picker — open |
| `UF_MODEL_US_002` | As a user I can see which model is currently active in both the topbar badge and the model picker | Topbar + model picker — active badge |
| `UF_MODEL_US_003` | As a user I can see which models require a Pro plan before selecting them | Model picker — "Pro" badge |
| `UF_MODEL_US_004` | As a user I can read a short description of each model's trade-offs (speed, cost, capability) before choosing | Model picker — descriptions |
| `UF_MODEL_US_005` | As a user the model I select persists for new sessions within the same workspace so I don't have to re-select it | Model picker — persistence |
| `UF_MODEL_US_006` | As a user switching model spawns a new claude process with `--model <id>` so the change takes effect immediately | PTY — model flag |

---

### UF_TOOL — Tool Permission Management

Intercepting and responding to Claude's requests to run terminal commands or access files.

```
Claude emits tool_use event (e.g. Bash: "npm run build")
    │
    ▼
App detects tool_use in stream
    │
    ▼
Permission card shown — command displayed in full
PTY input paused (no writes until resolved)
    │
    ├─ [Allow]        → write y\n → Claude executes
    ├─ [Always Allow] → write a\n → Claude executes, rule saved
    └─ [Deny]         → write n\n → Claude skips, session continues
```

| Code | User Story | Screen |
|------|------------|--------|
| `UF_TOOL_US_001` | As a user I am shown a permission prompt before Claude runs any terminal command so I remain in control | Tool permission card |
| `UF_TOOL_US_002` | As a user I can see the exact command Claude wants to run, including all arguments, before approving | Tool permission — full command display |
| `UF_TOOL_US_003` | As a user I can allow a single tool use so Claude proceeds with that specific command | Tool permission — Allow button |
| `UF_TOOL_US_004` | As a user I can always allow a tool so Claude can run it without prompting me again this session | Tool permission — Always Allow button |
| `UF_TOOL_US_005` | As a user I can deny a tool permission without breaking the session so Claude gracefully handles the refusal | Tool permission — Deny button |
| `UF_TOOL_US_006` | As a user denying a tool mid-stream does not crash or hang the app — Claude receives the denial and continues | PTY — safe deny |

---

### UF_DIFF — Code Diff Review

Reviewing, accepting, and rejecting file changes proposed by Claude.

```
Claude writes files via tool_result
    │
    ▼
Diff panel populated from tool_result content
    │
    ├─ Git tree section: shows M / A / D file statuses
    └─ Diff section: shows unified diff with green/red highlighting
              │
              ├─ [Accept all]  → write y\n → Claude writes all files
              ├─ [Reject all]  → write n\n → Claude skips all files
              ├─ Per-file [✓]  → accept single file
              └─ Per-file [✕]  → reject single file
                       │
                       ▼
              After all files resolved → diff panel clears
```

| Code | User Story | Screen |
|------|------------|--------|
| `UF_DIFF_US_001` | As a user I can see all files Claude has modified listed in the right panel so I have a complete picture of the changes | Right panel — git tree |
| `UF_DIFF_US_002` | As a user I can see a total diff stat (`+N −N`) at the top of the diff panel so I know the overall scope at a glance | Diff panel — header stats |
| `UF_DIFF_US_003` | As a user I can see per-file line counts (`+3 −1`) in each file header | Diff panel — per-file stats |
| `UF_DIFF_US_004` | As a user I can see added lines highlighted green and removed lines highlighted amber/red | Diff panel — line colours |
| `UF_DIFF_US_005` | As a user I can see diff hunks with surrounding context lines so I understand where each change sits | Diff panel — context lines |
| `UF_DIFF_US_006` | As a user I can collapse a file diff section to focus on other files | Diff panel — file section collapse |
| `UF_DIFF_US_007` | As a user I can expand a collapsed file diff to review its changes | Diff panel — file section expand |
| `UF_DIFF_US_008` | As a user I can accept all changes across all files in one action | Diff panel — "Accept all" |
| `UF_DIFF_US_009` | As a user I can reject all changes across all files in one action | Diff panel — "Reject all" |
| `UF_DIFF_US_010` | As a user I can accept changes for a single file independently without affecting others | Diff panel — per-file ✓ |
| `UF_DIFF_US_011` | As a user I can reject changes for a single file independently | Diff panel — per-file ✕ |
| `UF_DIFF_US_012` | As a user after all files are resolved the diff panel clears automatically so the UI is not cluttered | Diff panel — post-action cleared |
| `UF_DIFF_US_013` | As a user the diff panel is hidden entirely when there are no pending changes | Right panel — empty state |
| `UF_DIFF_US_014` | As a user I can collapse the right panel to a narrow strip when I want more terminal space | Right panel — collapsed strip |
| `UF_DIFF_US_015` | As a user I can re-expand the right panel from the collapsed strip | Right panel — expand from strip |
| `UF_DIFF_US_016` | As a user I can scroll the diff panel independently of the terminal | Diff panel — independent scroll |

---

### UF_GIT — File & Git Navigation

Browsing files and git state for the active workspace.

| Code | User Story | Screen |
|------|------------|--------|
| `UF_GIT_US_001` | As a user I can browse the workspace file tree in the right panel so I can see the full project structure | Right panel — file tree |
| `UF_GIT_US_002` | As a user I can see modified (M), added (A), and deleted (D) files highlighted by status colour in the git tree | Right panel — git status colours |
| `UF_GIT_US_003` | As a user I am shown a "no git repo" state if the workspace folder is not a git repository | Right panel — no repo state |

---

### UF_ERROR — Error Handling

Surfacing and recovering from errors without requiring the user to read stack traces.

```
Error occurs
    │
    ├─ Rate limit     → amber banner + countdown timer
    ├─ Folder missing → grey banner + "Re-link →" button
    ├─ PTY crash      → error banner + session recovery prompt
    └─ API error      → red banner + message
              │
              └─ Error resolves → banner auto-dismisses
```

| Code | User Story | Screen |
|------|------------|--------|
| `UF_ERROR_US_001` | As a user I am notified when Claude's API is rate-limiting my requests with an amber warning banner | Error — rate limit banner |
| `UF_ERROR_US_002` | As a user I can see how long to wait before retrying after a rate limit so I know the app is not broken | Error — "Retry in Ns" countdown |
| `UF_ERROR_US_003` | As a user I am notified when my workspace folder has been moved or deleted | Error — folder not found |
| `UF_ERROR_US_004` | As a user I can re-link a missing workspace folder to its new location without losing my chat history | Error — "Re-link →" button |
| `UF_ERROR_US_005` | As a user error banners auto-dismiss once the underlying problem resolves so the UI stays clean | Error — auto-dismiss |
| `UF_ERROR_US_006` | As a user if the claude process crashes unexpectedly I see a clear error rather than a blank or frozen screen | Error — PTY crash recovery |

---

### UF_PERSIST — Persistence & Resume

Ensuring state survives app restarts and sessions can be resumed.

| Code | User Story | Screen |
|------|------------|--------|
| `UF_PERSIST_US_001` | As a user my workspaces are saved to SQLite so they are present when I reopen the app | SQLite — workspaces table |
| `UF_PERSIST_US_002` | As a user my chat sessions are saved so I can return to a conversation after closing the app | SQLite — sessions table |
| `UF_PERSIST_US_003` | As a user my full message history is persisted locally so I can scroll back through previous exchanges | SQLite — messages table |
| `UF_PERSIST_US_004` | As a user pending diff records are persisted so that unreviewed changes survive an app restart | SQLite — diffs table |
| `UF_PERSIST_US_005` | As a user the `session_id` from Claude's `result` event is stored so the next session can resume with `--resume` and retain full context | SQLite — session_id storage |
| `UF_PERSIST_US_006` | As a user when I reopen a session the terminal buffer is replayed from memory so the last output is immediately visible | In-memory buffer — replay |

---

*End of document.*
