import { useEffect, useRef, useState, useCallback } from 'react'
import type { AppScreen, Workspace, Session, AppSettings } from './types'
import { loadWorkspaces, saveWorkspaces, loadSettings, saveSettings, nextWorkspaceColor } from './storage'
import TerminalPane from './components/TerminalPane'
import FirstRunNoCli from './screens/FirstRunNoCli'
import Settings from './screens/Settings'
import NewWorkspaceModal from './modals/NewWorkspaceModal'
import ModelPicker from './modals/ModelPicker'
import DeleteWorkspaceDialog from './modals/DeleteWorkspaceDialog'

// ── Mock diff data (right panel) ──────────────────────────────────────────────

const MOCK_DIFF = {
  gitFiles: [
    { path: 'src/auth/middleware.ts', status: 'M' as const },
    { path: 'src/auth/tokens.ts',     status: 'A' as const },
    { path: 'src/auth/sessions.ts',   status: 'D' as const },
    { path: 'src/index.ts',           status: 'M' as const },
  ],
  patch: `@@ -12,8 +12,10 @@
  const app = express()
- app.use(session({ secret: key }))
- app.use(sessionParser)
+ const token = jwt.sign(payload, secret)
+ app.use(verifyJwtToken)
  app.listen(PORT)`,
  file: 'src/auth/middleware.ts',
  added: 2,
  removed: 2,
}

// ── RightPanel ────────────────────────────────────────────────────────────────

function RightPanel({ state, onToggle }: { state: 'open' | 'collapsed'; onToggle: () => void }) {
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
        <div className="w-[6px] h-[6px] rounded-full bg-tm-amber" />
      </div>
    )
  }

  return (
    <div className="flex-shrink-0 flex flex-col border-l border-tm-border bg-tm-bg" style={{ width: 320 }}>
      <div className="flex items-center px-3 h-8 border-b border-tm-border bg-tm-surface flex-shrink-0">
        <span className="text-[11px] font-bold text-tm-text flex-1">// git_tree</span>
        <button onClick={onToggle} className="text-[10px] text-tm-dim hover:text-tm-muted">[collapse]</button>
      </div>
      <div className="flex flex-col py-1 border-b border-tm-border">
        {MOCK_DIFF.gitFiles.map((f) => (
          <div key={f.path} className="flex items-center gap-2 px-3 py-[5px] hover:bg-tm-surface">
            <span className={`text-[11px] font-bold w-3 flex-shrink-0 ${
              f.status === 'M' ? 'text-tm-amber' : f.status === 'A' ? 'text-tm-green' : 'text-tm-red'
            }`}>{f.status}</span>
            <span className="text-[11px] text-tm-text truncate">{f.path}</span>
          </div>
        ))}
      </div>
      <div className="flex items-center gap-2 px-3 h-8 border-b border-tm-border bg-tm-surface flex-shrink-0">
        <span className="text-[11px] font-bold text-tm-text">// diff</span>
        <span className="text-[10px] text-tm-dim border border-tm-border px-[6px] py-[1px]">
          {MOCK_DIFF.file.split('/').pop()}
        </span>
      </div>
      <div className="flex-1 overflow-auto scrollbar-hidden selectable">
        {MOCK_DIFF.patch.split('\n').map((line, i) => {
          const isAdd  = line.startsWith('+') && !line.startsWith('+++')
          const isRem  = line.startsWith('-') && !line.startsWith('---')
          const isHunk = line.startsWith('@@')
          return (
            <div key={i} className={`px-3 py-[2px] font-mono text-[11px] whitespace-pre ${
              isAdd ? 'bg-[#001a0a] text-tm-green' : isRem ? 'bg-[#1a0a00] text-tm-amber' : isHunk ? 'text-tm-cyan' : 'text-tm-dim'
            }`}>{line || ' '}</div>
          )
        })}
      </div>
      <div className="flex items-center gap-2 px-3 h-10 border-t border-tm-border flex-shrink-0">
        <button className="text-[11px] text-tm-green border border-tm-green px-3 py-[4px] hover:bg-[#001a0a]">
          [y] accept all
        </button>
        <button className="text-[11px] text-tm-amber border border-tm-border px-3 py-[4px] hover:bg-[#1a0a00]">
          [n] reject
        </button>
        <span className="ml-auto text-[10px] text-tm-dim">+{MOCK_DIFF.added} -{MOCK_DIFF.removed}</span>
      </div>
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
  const [mode, setMode]               = useState<'ASK' | 'PLAN' | 'EDIT'>('ASK')
  const [showModelPicker, setShowModelPicker]     = useState(false)
  const [showNewWorkspace, setShowNewWorkspace]   = useState(false)
  const [deleteWsId, setDeleteWsId]               = useState<string | null>(null)
  const spawnedSessions = useRef<Set<string>>(new Set())
  const nextSessionNum  = useRef(1)
  const modelBtnRef     = useRef<HTMLButtonElement>(null)

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
    const session: Session = {
      id:          `${ws.id}-s${nextSessionNum.current++}`,
      workspaceId: ws.id,
      name:        `session_${nextSessionNum.current - 1}`,
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
  const spawnSession = useCallback((session: Session, workspace: Workspace) => {
    if (spawnedSessions.current.has(session.id)) return
    spawnedSessions.current.add(session.id)
    window.api.ptySpawn({
      sessionId:       session.id,
      cwd:             workspace.path,
      model:           session.model,
      skipPermissions: settings.skipPermissions,
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
      const session: Session = {
        id:          `${ws.id}-s${nextSessionNum.current++}`,
        workspaceId: ws.id,
        name:        `session_${nextSessionNum.current - 1}`,
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
    const session: Session = {
      id:          `${wsId}-s${nextSessionNum.current++}`,
      workspaceId: wsId,
      name:        `session_${nextSessionNum.current - 1}`,
      model:       settings.defaultModel,
    }
    setSessions((prev) => [...prev, session])
    setActiveWsId(wsId)
    setActiveSessionId(session.id)
    spawnSession(session, ws)
  }

  function handleModeClick(m: 'ASK' | 'PLAN' | 'EDIT') {
    setMode(m)
    if (!activeSessionId) return
    if (m === 'PLAN') window.api.ptyWrite(activeSessionId, '/plan ')
    document.querySelector<HTMLTextAreaElement>('.xterm-helper-textarea')?.focus()
  }

  // ── Derived ────────────────────────────────────────────────────────────────
  const activeWs      = workspaces.find((w) => w.id === activeWsId) ?? null
  const activeSession = sessions.find((s) => s.id === activeSessionId) ?? null
  const wsSessions    = (wsId: string) => sessions.filter((s) => s.workspaceId === wsId)
  const activeModel   = settings.defaultModel.replace('claude-', '').replace('-4-5', '-4')
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

        <div className="flex items-center gap-3 titlebar-nodrag flex-shrink-0">
          <button
            onClick={() => setScreen('settings')}
            className="text-[10px] text-tm-dim hover:text-tm-muted"
          >
            settings
          </button>

          {/* Model picker anchor */}
          <div className="relative">
            <button
              ref={modelBtnRef}
              onClick={() => setShowModelPicker((v) => !v)}
              className="border border-tm-border px-2 py-[2px] text-[10px] text-tm-muted hover:border-tm-muted hover:text-tm-text"
            >
              {activeModel} ▾
            </button>
            {showModelPicker && (
              <ModelPicker
                current={settings.defaultModel}
                onSelect={(m) => handleSaveSettings({ ...settings, defaultModel: m })}
                onClose={() => setShowModelPicker(false)}
              />
            )}
          </div>
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
                          className={`flex items-center px-[22px] py-[4px] cursor-pointer text-[11px] hover:bg-tm-surface ${
                            s.id === activeSessionId ? 'text-tm-green' : 'text-tm-dim'
                          }`}
                          onClick={() => handleSelectSession(s)}
                        >
                          $ {s.name}
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

          <TerminalPane sessionId={activeSessionId} />
        </div>

        {/* ── Right panel ───────────────────────────────────────────────────── */}
        <RightPanel
          state={panelState}
          onToggle={() => setPanelState((p) => p === 'open' ? 'collapsed' : 'open')}
        />
      </div>

      {/* ── Status bar ────────────────────────────────────────────────────── */}
      <div className="flex items-center h-6 px-4 gap-0 flex-shrink-0 bg-tm-surface border-t border-tm-border text-[10px]">
        {/* Mode tag */}
        <div className="flex items-center gap-0">
          {(['ASK', 'PLAN', 'EDIT'] as const).map((m) => (
            <button
              key={m}
              onClick={() => handleModeClick(m)}
              className={`px-2 py-0 text-[9px] font-bold ${
                mode === m
                  ? 'text-tm-bg bg-tm-green'
                  : 'text-tm-dim hover:text-tm-muted'
              }`}
            >
              {m}
            </button>
          ))}
        </div>

        {activeWs && (
          <>
            <span className="mx-3 text-tm-border">|</span>
            <span className="text-tm-dim">{activeWs.name}</span>
          </>
        )}

        <span className="ml-auto flex items-center gap-3 text-tm-dim">
          <span>{activeModel}</span>
        </span>
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
