import { useEffect, useRef, useState, useCallback, useReducer } from 'react'
import type { AppScreen, Workspace, Session, AppSettings } from './types'
import { loadWorkspaces, saveWorkspaces, loadSettings, saveSettings, nextWorkspaceColor } from './storage'
import TerminalPane from './components/TerminalPane'
import FirstRunNoCli from './screens/FirstRunNoCli'
import Settings from './screens/Settings'
import NewWorkspaceModal from './modals/NewWorkspaceModal'
import ModelPicker from './modals/ModelPicker'
import DeleteWorkspaceDialog from './modals/DeleteWorkspaceDialog'

// ── RightPanel ────────────────────────────────────────────────────────────────

type GitCommit = { hash: string; fullHash: string; message: string; date: string }
type FileDiff  = { patch: string; added: number; removed: number }
type GitData   = {
  files:     { path: string; status: string }[]
  commits:   GitCommit[]
  fileDiffs: Record<string, FileDiff>
}

type Selection = { kind: 'commit'; hash: string; fullHash: string }

function DiffContent({ patch }: { patch: string }) {
  let oldLine = 0, newLine = 0
  return (
    <>
      {patch.split('\n').map((line, i) => {
        if (line.startsWith('@@')) {
          const m = line.match(/@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/)
          if (m) { oldLine = parseInt(m[1]); newLine = parseInt(m[2]) }
          return (
            <div key={i} className="px-2 py-[1px] bg-[#0A1625] font-mono text-[9px] text-[#1E6A8A] whitespace-pre">
              {line}
            </div>
          )
        }
        const isAdd  = line.startsWith('+')
        const isRem  = line.startsWith('-')
        const isNoNl = line.startsWith('\\')
        const dispNum = isRem ? oldLine : newLine
        if (!isNoNl) {
          if (isAdd) newLine++
          else if (isRem) oldLine++
          else { oldLine++; newLine++ }
        }
        return (
          <div key={i} className={`flex items-center font-mono text-[10px] whitespace-pre leading-[18px] ${
            isRem ? 'border-l-[3px] border-[#FF3333] bg-[#250808]' :
            isAdd ? 'border-l-[3px] border-[#00FF88] bg-[#082012]' :
                    'border-l-[3px] border-transparent'
          }`}>
            <span className={`w-[26px] text-right pr-[4px] flex-shrink-0 select-none text-[9px] ${
              isRem ? 'text-[#3D1515]' : isAdd ? 'text-[#153A20]' : 'text-[#1E1E1E]'
            }`}>{isNoNl ? '' : dispNum}</span>
            <span className={
              isRem ? 'text-[#FF8888]' : isAdd ? 'text-[#4DFFC4]' : isNoNl ? 'text-[#2A2A2A]' : 'text-[#3A3A3A]'
            }>{line || ' '}</span>
          </div>
        )
      })}
    </>
  )
}

function RightPanel({ state, onToggle, cwd }: { state: 'open' | 'collapsed'; onToggle: () => void; cwd: string | null }) {
  const [git, setGit]             = useState<GitData>({ files: [], commits: [], fileDiffs: {} })
  const [selection, setSelection] = useState<Selection | null>(null)
  const [activeFile, setActiveFile] = useState<string | null>(null)
  const [tab, setTab]             = useState<'git_tree' | 'diff'>('diff')
  const [tick, refresh]           = useReducer((n: number) => n + 1, 0)

  useEffect(() => {
    if (!cwd) return
    let cancelled = false
    window.api.gitStatus(cwd, undefined, selection?.fullHash).then((data: GitData) => {
      if (!cancelled) setGit(data)
    }).catch(() => {})
    return () => { cancelled = true }
  }, [cwd, selection, tick])

  useEffect(() => {
    const id = setInterval(refresh, 4000)
    return () => clearInterval(id)
  }, [])

  useEffect(() => { setSelection(null); setActiveFile(null) }, [cwd])

  // Auto-select first file; keep selection if it still exists
  useEffect(() => {
    const keys = Object.keys(git.fileDiffs)
    if (keys.length > 0) {
      setActiveFile(prev => (!prev || !git.fileDiffs[prev]) ? keys[0] : prev)
    } else {
      setActiveFile(null)
    }
  }, [git.fileDiffs])

  const selectedKey = selection?.hash ?? null
  const fileKeys    = Object.keys(git.fileDiffs)
  const currentDiff = activeFile ? git.fileDiffs[activeFile] : null

  if (state === 'collapsed') {
    return (
      <div
        className="flex-shrink-0 flex flex-col items-center pt-3 gap-4 cursor-pointer border-l border-tm-border bg-tm-bg"
        style={{ width: 32 }}
        onClick={onToggle}
        title="Open panel"
      >
        <div className="flex flex-col items-center gap-[2px] border border-tm-green px-[5px] py-[5px]">
          {['g','i','t'].map((c) => (
            <span key={c} className="text-[9px] font-bold text-tm-green leading-none">{c}</span>
          ))}
        </div>
        <div className="flex flex-col items-center gap-[2px] border border-tm-border px-[5px] py-[5px]">
          {['d','i','f','f'].map((c) => (
            <span key={c} className="text-[9px] text-tm-dim leading-none">{c}</span>
          ))}
        </div>
        <div className="w-[6px] h-[6px] rounded-full bg-tm-cyan" />
      </div>
    )
  }

  return (
    <div className="flex-shrink-0 flex flex-col border-l border-tm-border bg-tm-bg" style={{ width: 320 }}>

      {/* Header */}
      <div className="flex items-center px-3 h-8 border-b border-tm-border bg-tm-surface flex-shrink-0">
        <span className="text-[11px] font-bold text-tm-green flex-1">// git_panel</span>
        <button onClick={onToggle} className="text-[10px] text-tm-dim hover:text-tm-muted">[collapse]</button>
      </div>

      {/* Tab row */}
      <div className="flex items-center flex-shrink-0 border-b border-tm-border bg-[#0D0D0D]" style={{ height: 32 }}>
        {(['git_tree', 'diff'] as const).map((t) => {
          const isActive = tab === t
          return (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`flex items-center h-full px-[14px] text-[10px] font-mono border-b-2 transition-none ${
                isActive
                  ? 'text-tm-green font-bold bg-[#071209] border-tm-green'
                  : 'text-[#3A3A3A] border-transparent hover:text-tm-dim'
              }`}
            >
              {isActive ? `[${t}]` : t}
            </button>
          )
        })}
      </div>

      {/* git_tree tab: commit history only */}
      {tab === 'git_tree' && (
        <div className="flex-1 overflow-auto scrollbar-hidden">
          {git.commits.length === 0 ? (
            <div className="px-3 py-3 text-[11px] text-tm-dim">no commits</div>
          ) : git.commits.map((c) => (
            <div
              key={c.hash}
              onClick={() => setSelection({ kind: 'commit', hash: c.hash, fullHash: c.fullHash })}
              className={`flex items-center gap-2 px-3 py-[4px] cursor-pointer hover:bg-tm-surface ${
                selectedKey === c.hash ? 'bg-tm-surface' : ''
              }`}
            >
              <span className="text-[10px] font-mono text-tm-cyan flex-shrink-0 w-[42px]">{c.hash}</span>
              <span className="text-[11px] text-tm-text truncate flex-1">{c.message}</span>
              <span className="text-[9px] text-tm-dim flex-shrink-0 ml-1">{c.date}</span>
            </div>
          ))}
        </div>
      )}

      {/* diff tab: file selector + diff content */}
      {tab === 'diff' && (
        <>
          {/* File selector strip */}
          {fileKeys.length > 0 && (
            <div className="flex flex-col border-b border-tm-border flex-shrink-0 overflow-auto scrollbar-hidden" style={{ maxHeight: 140 }}>
              {fileKeys.map((fp) => {
                const d = git.fileDiffs[fp]
                const isActive = fp === activeFile
                const label = fp.split('/').slice(-2).join('/')
                return (
                  <div
                    key={fp}
                    title={fp}
                    onClick={() => setActiveFile(fp)}
                    className={`flex items-center gap-2 px-3 py-[5px] cursor-pointer hover:bg-tm-surface font-mono text-[10px] ${
                      isActive ? 'border-l-[2px] border-tm-green bg-[#0C180C]' : 'border-l-[2px] border-transparent'
                    }`}
                  >
                    <span className={`truncate flex-1 ${isActive ? 'text-tm-text' : 'text-tm-dim'}`}>{label}</span>
                    <span className="text-[9px] text-tm-green flex-shrink-0">+{d.added}</span>
                    <span className="text-[9px] text-[#FF6666] flex-shrink-0">−{d.removed}</span>
                  </div>
                )
              })}
            </div>
          )}
          {/* Diff content */}
          <div className="flex-1 overflow-auto scrollbar-hidden selectable">
            {!currentDiff?.patch ? (
              <div className="px-3 py-3 text-[11px] text-tm-dim">no diff</div>
            ) : (
              <DiffContent patch={currentDiff.patch} />
            )}
          </div>
        </>
      )}

    </div>
  )
}

// ── App ───────────────────────────────────────────────────────────────────────

export default function App() {
  const [screen, setScreen]           = useState<AppScreen>('loading')
  const [workspaces, setWorkspaces]   = useState<Workspace[]>([])
  const [sessions, setSessions]       = useState<Session[]>([])
  const [settings, setSettings]       = useState<AppSettings>(loadSettings)
  const [activeWsId, setActiveWsId]   = useState<string | null>(null)
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null)
  const [expandedWs, setExpandedWs]   = useState<Set<string>>(new Set())
  const [panelState, setPanelState]   = useState<'open' | 'collapsed'>('open')
  const [showNewWorkspace, setShowNewWorkspace]   = useState(false)
  const [deleteWsId, setDeleteWsId]               = useState<string | null>(null)
  const spawnedSessions  = useRef<Set<string>>(new Set())
  const wsSessionNums    = useRef<Map<string, number>>(new Map())

  function nextNumForWs(wsId: string): number {
    const n = (wsSessionNums.current.get(wsId) ?? 0) + 1
    wsSessionNums.current.set(wsId, n)
    return n
  }

  // ── Startup: detect CLI then load workspaces ────────────────────────────────
  useEffect(() => {
    window.api.claudeCheck()
      .then(() => {
        const ws = loadWorkspaces()
        setWorkspaces(ws)
        setScreen('main')
        if (ws.length === 0) {
          setShowNewWorkspace(true)
        } else {
          autoSelectWorkspace(ws, ws[0].id)
        }
      })
      .catch(() => setScreen('first-run-no-cli'))
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  function autoSelectWorkspace(ws: Workspace[], id: string) {
    const found = ws.find((w) => w.id === id)
    if (!found) return
    setActiveWsId(id)
    setExpandedWs(new Set([id]))
  }

  // ── Settings ───────────────────────────────────────────────────────────────
  function handleSaveSettings(s: AppSettings) {
    setSettings(s)
    saveSettings(s)
  }

  // ── Workspaces ─────────────────────────────────────────────────────────────
  function handleAddWorkspace(ws: Workspace) {
    const next = [...workspaces, ws]
    setWorkspaces(next)
    saveWorkspaces(next)
    setShowNewWorkspace(false)
    setActiveWsId(ws.id)
    setExpandedWs(new Set([ws.id]))
    // Auto-create a session
    const n = nextNumForWs(ws.id)
    const session: Session = {
      id:          `${ws.id}-s${n}`,
      workspaceId: ws.id,
      name:        `session_${n}`,
      model:       settings.defaultModel,
    }
    setSessions((prev) => [...prev, session])
    setActiveSessionId(session.id)
    spawnSession(session, ws)
  }

  function handleDeleteWorkspace(id: string) {
    const next = workspaces.filter((w) => w.id !== id)
    setWorkspaces(next)
    saveWorkspaces(next)
    setSessions((prev) => prev.filter((s) => s.workspaceId !== id))
    if (activeWsId === id) {
      setActiveWsId(next[0]?.id ?? null)
      setActiveSessionId(null)
    }
    setDeleteWsId(null)
  }

  // ── Sessions ───────────────────────────────────────────────────────────────
  // pendingSpawn holds sessions waiting for terminal dims before spawning
  const pendingSpawn = useRef<Map<string, { session: Session; workspace: Workspace }>>(new Map())

  const spawnSession = useCallback((session: Session, workspace: Workspace) => {
    if (spawnedSessions.current.has(session.id)) return
    // Queue the spawn — TerminalPane will call handleTerminalReady with real dims
    pendingSpawn.current.set(session.id, { session, workspace })
  }, [])

  const handleTerminalReady = useCallback((sessionId: string, cols: number, rows: number) => {
    const pending = pendingSpawn.current.get(sessionId)
    if (!pending) return
    pendingSpawn.current.delete(sessionId)
    if (spawnedSessions.current.has(sessionId)) return
    spawnedSessions.current.add(sessionId)
    window.api.ptySpawn({
      sessionId,
      cwd:             pending.workspace.path,
      model:           pending.session.model,
      skipPermissions: settings.skipPermissions,
      cols,
      rows,
    })
  }, [settings.skipPermissions])

  function handleSelectWorkspace(ws: Workspace) {
    setActiveWsId(ws.id)
    setExpandedWs((prev) => {
      const next = new Set(prev)
      next.has(ws.id) ? next.delete(ws.id) : next.add(ws.id)
      return next
    })
    const wsSessions = sessions.filter((s) => s.workspaceId === ws.id)
    if (wsSessions.length === 0) {
      const n = nextNumForWs(ws.id)
      const session: Session = {
        id:          `${ws.id}-s${n}`,
        workspaceId: ws.id,
        name:        `session_${n}`,
        model:       settings.defaultModel,
      }
      setSessions((prev) => [...prev, session])
      setActiveSessionId(session.id)
      spawnSession(session, ws)
    } else {
      const last = wsSessions[wsSessions.length - 1]
      setActiveSessionId(last.id)
      spawnSession(last, ws)
    }
  }

  function handleSelectSession(session: Session) {
    const ws = workspaces.find((w) => w.id === session.workspaceId)
    if (!ws) return
    setActiveWsId(ws.id)
    setActiveSessionId(session.id)
    spawnSession(session, ws)
  }

  function handleNewSession(wsId: string) {
    const ws = workspaces.find((w) => w.id === wsId)
    if (!ws) return
    const n = nextNumForWs(wsId)
    const session: Session = {
      id:          `${wsId}-s${n}`,
      workspaceId: wsId,
      name:        `session_${n}`,
      model:       settings.defaultModel,
    }
    setSessions((prev) => [...prev, session])
    setActiveWsId(wsId)
    setActiveSessionId(session.id)
    spawnSession(session, ws)
  }

  function handleDeleteSession(sessionId: string) {
    window.api.ptyKill(sessionId)
    spawnedSessions.current.delete(sessionId)
    pendingSpawn.current.delete(sessionId)
    setSessions((prev) => {
      const next = prev.filter((s) => s.id !== sessionId)
      if (activeSessionId === sessionId) {
        const ws = workspaces.find((w) => w.id === prev.find((s) => s.id === sessionId)?.workspaceId)
        const remaining = next.filter((s) => s.workspaceId === ws?.id)
        setActiveSessionId(remaining[remaining.length - 1]?.id ?? null)
      }
      return next
    })
  }

  // ── Derived ────────────────────────────────────────────────────────────────
  const activeWs      = workspaces.find((w) => w.id === activeWsId) ?? null
  const activeSession = sessions.find((s) => s.id === activeSessionId) ?? null
  const wsSessions    = (wsId: string) => sessions.filter((s) => s.workspaceId === wsId)
  const deleteWs      = workspaces.find((w) => w.id === deleteWsId) ?? null

  // ── Screen routing ─────────────────────────────────────────────────────────
  if (screen === 'loading') {
    return (
      <div className="flex h-screen items-center justify-center bg-tm-bg font-mono">
        <span className="text-[11px] text-tm-dim">initializing…</span>
      </div>
    )
  }

  if (screen === 'first-run-no-cli') {
    return (
      <FirstRunNoCli
        onRetry={() => {
          window.api.claudeCheck()
            .then(() => {
              const ws = loadWorkspaces()
              setWorkspaces(ws)
              setScreen('main')
              if (ws.length === 0) setShowNewWorkspace(true)
              else autoSelectWorkspace(ws, ws[0].id)
            })
            .catch(() => {})
        }}
      />
    )
  }

  if (screen === 'settings') {
    return (
      <Settings
        settings={settings}
        onSave={handleSaveSettings}
        onBack={() => setScreen('main')}
      />
    )
  }

  // ── Main layout ────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-screen overflow-hidden bg-tm-bg font-mono">

      {/* ── Topbar ────────────────────────────────────────────────────────── */}
      <div className="flex items-center h-8 px-4 gap-3 flex-shrink-0 bg-tm-surface border-b border-tm-border titlebar-drag">
        <span className="text-[11px] font-bold text-tm-green titlebar-nodrag flex-shrink-0">claude mux</span>

        <div className="flex-1 flex justify-center titlebar-nodrag">
          {activeWs && (
            <span className="text-[11px] text-tm-dim truncate max-w-[480px]">
              {activeWs.path}
              {activeSession ? <span className="text-tm-border">  /  </span> : null}
              {activeSession && <span className="text-tm-muted">{activeSession.name}</span>}
            </span>
          )}
        </div>

      </div>

      {/* ── Body ──────────────────────────────────────────────────────────── */}
      <div className="flex flex-1 overflow-hidden">

        {/* ── Sidebar ─────────────────────────────────────────────────────── */}
        <aside className="flex flex-col flex-shrink-0 border-r border-tm-border bg-tm-bg" style={{ width: 200 }}>
          <div className="flex-1 overflow-auto scrollbar-hidden py-3">
            <div className="px-3 mb-2">
              <span className="text-[10px] text-tm-dim tracking-widest">// workspaces</span>
            </div>

            {workspaces.map((ws) => {
              const isActive   = ws.id === activeWsId
              const isExpanded = expandedWs.has(ws.id)
              const wss        = wsSessions(ws.id)

              return (
                <div key={ws.id}>
                  <div
                    className={`group flex items-center gap-2 px-[10px] py-[6px] cursor-pointer hover:bg-tm-surface ${
                      isActive ? 'border-l-2 border-tm-green' : 'border-l-2 border-transparent'
                    }`}
                    onClick={() => handleSelectWorkspace(ws)}
                  >
                    <div className="w-[6px] h-[6px] rounded-full flex-shrink-0" style={{ background: ws.color }} />
                    <span className={`text-[11px] truncate flex-1 ${isActive ? 'text-tm-text' : 'text-tm-muted'}`}>
                      {ws.name}
                    </span>
                    <button
                      className="opacity-0 group-hover:opacity-100 text-[10px] text-tm-dim hover:text-tm-red flex-shrink-0 titlebar-nodrag"
                      onClick={(e) => { e.stopPropagation(); setDeleteWsId(ws.id) }}
                      title="Delete workspace"
                    >
                      ×
                    </button>
                  </div>

                  {isExpanded && (
                    <div>
                      {wss.map((s) => (
                        <div
                          key={s.id}
                          className={`group flex items-center px-[22px] py-[4px] cursor-pointer text-[11px] hover:bg-tm-surface ${
                            s.id === activeSessionId ? 'text-tm-green' : 'text-tm-dim'
                          }`}
                          onClick={() => handleSelectSession(s)}
                        >
                          <span className="flex-1">$ {s.name}</span>
                          <button
                            className="opacity-0 group-hover:opacity-100 text-[10px] hover:text-tm-red pr-1 flex-shrink-0"
                            onClick={(e) => { e.stopPropagation(); handleDeleteSession(s.id) }}
                            title="Delete session"
                          >×</button>
                        </div>
                      ))}
                      <button
                        className="flex items-center px-[22px] py-[4px] text-[11px] text-tm-dim hover:bg-tm-surface w-full text-left"
                        onClick={(e) => { e.stopPropagation(); handleNewSession(ws.id) }}
                      >
                        + new session
                      </button>
                    </div>
                  )}
                </div>
              )
            })}
          </div>

          {/* Bottom bar */}
          <div className="border-t border-tm-border">
            <button
              className="flex items-center w-full px-3 py-[10px] text-[11px] text-tm-dim hover:bg-tm-surface hover:text-tm-muted"
              onClick={() => setShowNewWorkspace(true)}
            >
              + new_workspace
            </button>
          </div>
        </aside>

        {/* ── Content ───────────────────────────────────────────────────────── */}
        <div className="flex flex-col flex-1 overflow-hidden min-w-0">

          {/* Tab bar */}
          <div className="flex items-end h-9 flex-shrink-0 border-b border-tm-border bg-tm-bg">
            {activeWsId && wsSessions(activeWsId).map((s) => (
              <div
                key={s.id}
                onClick={() => handleSelectSession(s)}
                className={`flex items-center px-4 h-full cursor-pointer text-[12px] border-r border-tm-border flex-shrink-0 ${
                  s.id === activeSessionId
                    ? 'text-tm-text border-t-2 border-t-tm-green bg-tm-bg'
                    : 'text-tm-dim hover:text-tm-muted border-t-2 border-t-transparent'
                }`}
              >
                {s.name}
              </div>
            ))}
            <div className="flex-1" />
            {activeWsId && (
              <button
                onClick={() => handleNewSession(activeWsId)}
                className="flex items-center px-3 h-full text-tm-dim hover:text-tm-muted text-[16px] flex-shrink-0"
              >
                +
              </button>
            )}
          </div>

          <TerminalPane sessionId={activeSessionId} onReady={handleTerminalReady} />
        </div>

        {/* ── Right panel ───────────────────────────────────────────────────── */}
        <RightPanel
          state={panelState}
          onToggle={() => setPanelState((p) => p === 'open' ? 'collapsed' : 'open')}
          cwd={activeWs?.path ?? null}
        />
      </div>


{/* ── Modals ────────────────────────────────────────────────────────── */}
      {showNewWorkspace && (
        <NewWorkspaceModal
          color={nextWorkspaceColor(workspaces.length)}
          onConfirm={handleAddWorkspace}
          onCancel={() => setShowNewWorkspace(false)}
        />
      )}

      {deleteWs && (
        <DeleteWorkspaceDialog
          workspace={deleteWs}
          onConfirm={() => handleDeleteWorkspace(deleteWs.id)}
          onCancel={() => setDeleteWsId(null)}
        />
      )}
    </div>
  )
}
