import { useEffect, useRef, useState, useCallback, useReducer, useMemo } from 'react'
import type { AppScreen, Workspace, Session, AppSettings, SessionLayout } from './types'
import { loadWorkspaces, saveWorkspaces, loadSettings, saveSettings, nextWorkspaceColor } from './storage'
import TerminalPane, { clearBuffer } from './components/TerminalPane'
import FirstRunNoCli from './screens/FirstRunNoCli'
import Settings from './screens/Settings'
import NewWorkspaceModal from './modals/NewWorkspaceModal'
import ModelPicker from './modals/ModelPicker'
import DeleteWorkspaceDialog from './modals/DeleteWorkspaceDialog'
import LayoutPickerModal from './modals/LayoutPickerModal'

// ── RightPanel ────────────────────────────────────────────────────────────────

type GitCommit = {
  hash: string; fullHash: string; parents: string[]
  refs: string[]; message: string; date: string; isoDate: string; author: string
}
type FileDiff  = { patch: string; added: number; removed: number }
type GitData   = {
  files:     { path: string; status: string }[]
  commits:   GitCommit[]
  fileDiffs: Record<string, FileDiff>
}

type Selection = { kind: 'commit'; hash: string; fullHash: string }

// ── Git graph layout ──────────────────────────────────────────────────────────

const LANE_COLORS = [
  '#3B82F6','#A855F7','#F59E0B','#10B981',
  '#EF4444','#06B6D4','#F97316','#EC4899',
]
const LANE_W = 12
const ROW_H  = 26
const DOT_R  = 3.5

type ComputedRow = GitCommit & {
  laneIndex:   number
  color:       string
  topLanes:    (string | null)[]
  bottomLanes: (string | null)[]
  extraEdges:  { toLane: number }[]   // dot → bottom of toLane (merge-into)
}

function computeGraph(commits: GitCommit[]): ComputedRow[] {
  const lanes: (string | null)[] = []

  return commits.map((commit) => {
    const topLanes  = [...lanes]
    const extraEdges: { toLane: number }[] = []

    // Assign a lane to this commit
    let laneIndex = lanes.indexOf(commit.fullHash)
    if (laneIndex === -1) {
      const free = lanes.indexOf(null)
      laneIndex = free !== -1 ? free : lanes.length
      if (laneIndex === lanes.length) lanes.push(null)
    }

    const parents = commit.parents
    if (parents.length === 0) {
      lanes[laneIndex] = null
    } else {
      // First parent
      const taken = lanes.findIndex((l, i) => l === parents[0] && i !== laneIndex)
      if (taken !== -1) {
        lanes[laneIndex] = null
        extraEdges.push({ toLane: taken })
      } else {
        lanes[laneIndex] = parents[0]
      }
      // Additional parents → open new lanes (shows as branch-out in SVG)
      for (let p = 1; p < parents.length; p++) {
        if (!lanes.includes(parents[p])) {
          const free = lanes.indexOf(null)
          if (free !== -1) lanes[free] = parents[p]
          else lanes.push(parents[p])
        }
      }
    }
    while (lanes.length > 0 && lanes[lanes.length - 1] === null) lanes.pop()

    return {
      ...commit,
      laneIndex,
      color: LANE_COLORS[laneIndex % LANE_COLORS.length],
      topLanes,
      bottomLanes: [...lanes],
      extraEdges,
    }
  })
}

function GraphSvg({ row }: { row: ComputedRow }) {
  const numLanes = Math.max(row.laneIndex + 1, row.topLanes.length, row.bottomLanes.length)
  const svgW = numLanes * LANE_W + 2
  const cx   = row.laneIndex * LANE_W + LANE_W / 2
  const cy   = ROW_H / 2
  const maxI = Math.max(row.topLanes.length, row.bottomLanes.length)
  const els: React.ReactNode[] = []

  // Non-commit lanes
  for (let i = 0; i < maxI; i++) {
    if (i === row.laneIndex) continue
    const x      = i * LANE_W + LANE_W / 2
    const inTop  = i < row.topLanes.length    && row.topLanes[i]    !== null
    const inBot  = i < row.bottomLanes.length && row.bottomLanes[i] !== null
    const color  = LANE_COLORS[i % LANE_COLORS.length]

    if (inTop && inBot) {
      els.push(<line key={`v${i}`} x1={x} y1={0} x2={x} y2={ROW_H} stroke={color} strokeWidth={1.5} />)
    } else if (inTop) {
      // Lane merging into this commit from above
      els.push(<path key={`mi${i}`} d={`M ${x} 0 C ${x} ${cy} ${cx} 0 ${cx} ${cy}`}
        fill="none" stroke={color} strokeWidth={1.5} />)
    } else if (inBot) {
      // New lane branching out from this commit downward
      els.push(<path key={`bo${i}`} d={`M ${cx} ${cy} C ${cx} ${ROW_H} ${x} ${cy} ${x} ${ROW_H}`}
        fill="none" stroke={color} strokeWidth={1.5} />)
    }
  }

  // Extra edges: commit merges into another lane below
  for (const edge of row.extraEdges) {
    const tx = edge.toLane * LANE_W + LANE_W / 2
    els.push(<path key={`ex${edge.toLane}`} d={`M ${cx} ${cy} C ${cx} ${ROW_H} ${tx} ${cy} ${tx} ${ROW_H}`}
      fill="none" stroke={row.color} strokeWidth={1.5} />)
  }

  // Commit lane half-lines
  if (row.topLanes[row.laneIndex] === row.fullHash)
    els.push(<line key="lt" x1={cx} y1={0}  x2={cx} y2={cy}     stroke={row.color} strokeWidth={1.5} />)
  if (row.laneIndex < row.bottomLanes.length && row.bottomLanes[row.laneIndex] !== null)
    els.push(<line key="lb" x1={cx} y1={cy} x2={cx} y2={ROW_H}  stroke={row.color} strokeWidth={1.5} />)

  // Dot on top
  els.push(<circle key="dot" cx={cx} cy={cy} r={DOT_R} fill={row.color} stroke="#0A0A0A" strokeWidth={1} />)

  return <svg width={svgW} height={ROW_H} style={{ display: 'block', flexShrink: 0 }}>{els}</svg>
}

function RefBadge({ label }: { label: string }) {
  const isHead   = label === 'HEAD'
  const isTag    = label.startsWith('tag:')
  const isRemote = !isHead && !isTag && (label.includes('/'))
  const text     = isTag ? label.slice(5) : label
  const cls = isHead
    ? 'bg-[#064E3B] text-[#34D399] border-[#065F46]'
    : isTag
    ? 'bg-[#451A03] text-[#FCD34D] border-[#78350F]'
    : isRemote
    ? 'bg-[#1E1B4B] text-[#818CF8] border-[#312E81]'
    : 'bg-[#0C1A2E] text-[#60A5FA] border-[#1E3A5F]'
  return (
    <span className={`inline-flex items-center px-[3px] py-[1px] rounded-[2px] text-[8px] font-mono flex-shrink-0 border ${cls}`}>
      {text}
    </span>
  )
}

function formatAbsDate(iso: string) {
  if (!iso) return ''
  try { return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) }
  catch { return iso }
}

type LineTooltip = { text: string; color: string; x: number; y: number }

function DiffContent({ patch, onLineEnter, onLineLeave }: {
  patch: string
  onLineEnter: (e: React.MouseEvent<HTMLDivElement>, text: string, color: string) => void
  onLineLeave: () => void
}) {
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
        const textColor = isRem ? '#FF8888' : isAdd ? '#4DFFC4' : isNoNl ? '#2A2A2A' : '#3A3A3A'
        return (
          <div
            key={i}
            className={`flex items-center font-mono text-[10px] whitespace-pre leading-[18px] overflow-hidden ${
              isRem ? 'border-l-[3px] border-[#FF3333] bg-[#250808]' :
              isAdd ? 'border-l-[3px] border-[#00FF88] bg-[#082012]' :
                      'border-l-[3px] border-transparent'
            }`}
            onMouseEnter={(e) => {
              if (e.currentTarget.scrollWidth > e.currentTarget.clientWidth)
                onLineEnter(e, line, textColor)
            }}
            onMouseLeave={onLineLeave}
          >
            <span className={`w-[26px] text-right pr-[4px] flex-shrink-0 select-none text-[9px] ${
              isRem ? 'text-[#3D1515]' : isAdd ? 'text-[#153A20]' : 'text-[#1E1E1E]'
            }`}>{isNoNl ? '' : dispNum}</span>
            <span style={{ color: textColor }}>{line || ' '}</span>
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
  const [tooltip, setTooltip]         = useState<{ row: ComputedRow; x: number; y: number } | null>(null)
  const [lineTooltip, setLineTooltip] = useState<LineTooltip | null>(null)

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

  const rows = useMemo(() => computeGraph(git.commits), [git.commits])

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

      {/* git_tree tab: visual branch graph */}
      {tab === 'git_tree' && (
        <div
          className="flex-1 overflow-auto scrollbar-hidden"
          onMouseLeave={() => setTooltip(null)}
        >
          {rows.length === 0 ? (
            <div className="px-3 py-3 text-[11px] text-tm-dim">no commits</div>
          ) : rows.map((row) => {
            const isSelected = selectedKey === row.hash
            return (
              <div
                key={row.hash}
                style={{ height: ROW_H }}
                onClick={() => setSelection({ kind: 'commit', hash: row.hash, fullHash: row.fullHash })}
                onMouseEnter={(e) => {
                  const rect = e.currentTarget.getBoundingClientRect()
                  setTooltip({ row, x: rect.left + 4, y: rect.bottom })
                }}
                onMouseLeave={() => setTooltip(null)}
                className={`flex items-center cursor-pointer hover:bg-tm-surface ${isSelected ? 'bg-[#0D1C0D]' : ''}`}
              >
                {/* Branch graph */}
                <GraphSvg row={row} />

                {/* Metadata */}
                <div className="flex items-center gap-[5px] px-[6px] min-w-0 flex-1 overflow-hidden">
                  <span className="text-[10px] font-mono text-tm-cyan flex-shrink-0">{row.hash}</span>
                  {row.refs.slice(0, 2).map(r => <RefBadge key={r} label={r} />)}
                  <span className="text-[10px] text-tm-muted truncate flex-1 min-w-0">{row.message}</span>
                  <span className="text-[9px] text-tm-dim flex-shrink-0 whitespace-nowrap">{row.date}</span>
                </div>
              </div>
            )
          })}

          {/* Hover tooltip */}
          {tooltip && (
            <div
              className="fixed z-50 pointer-events-none"
              style={{
                left: Math.min(tooltip.x, window.innerWidth - 300),
                top:  tooltip.y + 6 + 130 > window.innerHeight ? tooltip.y - 134 : tooltip.y + 6,
              }}
            >
              <div className="bg-[#141414] border border-[#2D2D2D] rounded shadow-2xl p-3 w-[288px]">
                <div className="font-mono text-[10px] text-[#22D3EE] mb-[6px] break-all">{tooltip.row.fullHash}</div>
                <div className="text-[11px] text-[#E5E5E5] leading-snug mb-2">{tooltip.row.message}</div>
                <div className="flex items-center gap-2 flex-wrap mb-[4px]">
                  {tooltip.row.refs.map(r => <RefBadge key={r} label={r} />)}
                </div>
                <div className="text-[10px] text-[#6B7280]">{tooltip.row.author}</div>
                <div className="text-[10px] text-[#4B5563] mt-[2px]">{formatAbsDate(tooltip.row.isoDate)}</div>
              </div>
            </div>
          )}
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
              <DiffContent
                patch={currentDiff.patch}
                onLineEnter={(e, text, color) => {
                  const rect = e.currentTarget.getBoundingClientRect()
                  setLineTooltip({ text, color, x: rect.left, y: rect.bottom })
                }}
                onLineLeave={() => setLineTooltip(null)}
              />
            )}
          </div>

          {/* Long-line hover popup */}
          {lineTooltip && (
            <div
              className="fixed z-50 pointer-events-none"
              style={{
                left: Math.min(lineTooltip.x, window.innerWidth - 500),
                top:  lineTooltip.y + 4,
              }}
            >
              <div className="bg-[#141414] border border-[#2D2D2D] rounded shadow-2xl px-3 py-2 max-w-[480px]">
                <pre
                  className="font-mono text-[10px] whitespace-pre-wrap break-all"
                  style={{ color: lineTooltip.color }}
                >
                  {lineTooltip.text}
                </pre>
              </div>
            </div>
          )}
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
  const [showLayoutPicker, setShowLayoutPicker]   = useState(false)
  const [sessionLayout, setSessionLayout]         = useState<SessionLayout>(settings.sessionLayout || 'strip')
  const spawnedSessions  = useRef<Set<string>>(new Set())

  function nextNumForWs(wsId: string): number {
    const wsSessions = sessions.filter((s) => s.workspaceId === wsId)
    return wsSessions.length + 1
  }

  // ── Startup: detect CLI then load workspaces ────────────────────────────────
  useEffect(() => {
    window.api.claudeCheck()
      .then(() => {
        localStorage.removeItem('cm:sessions') // sessions are ephemeral, clear any stale data
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
    // Always start with a fresh session_1 on launch
    const session: Session = {
      id:          `${found.id}-s1`,
      workspaceId: found.id,
      name:        'session_1',
      model:       settings.defaultModel,
    }
    setSessions((prev) => prev.some((s) => s.id === session.id) ? prev : [...prev, session])
    setActiveSessionId(session.id)
    spawnSession(session, found)
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

    // Clear buffers for all sessions in this workspace
    const wsSessionIds = sessions.filter((s) => s.workspaceId === id).map((s) => s.id)
    wsSessionIds.forEach((sid) => clearBuffer(sid))

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
    const deletedSession = sessions.find((s) => s.id === sessionId)
    if (!deletedSession) return

    window.api.ptyKill(sessionId)
    spawnedSessions.current.delete(sessionId)
    pendingSpawn.current.delete(sessionId)
    clearBuffer(sessionId)  // Clear terminal buffer

    setSessions((prev) => {
      const wsId = deletedSession.workspaceId
      const otherWorkspaces = prev.filter((s) => s.workspaceId !== wsId)
      const wsSessionsFiltered = prev.filter((s) => s.workspaceId === wsId && s.id !== sessionId)

      // Renumber display names for remaining sessions (keep IDs stable)
      const renumbered = wsSessionsFiltered.map((s, idx) => {
        const newName = `session_${idx + 1}`
        return { ...s, name: newName }
      })

      const next = [...otherWorkspaces, ...renumbered]

      // If deleted session was active, select the last remaining session in workspace
      if (activeSessionId === sessionId) {
        setActiveSessionId(renumbered[renumbered.length - 1]?.id ?? null)
      }

      return next
    })
  }

  function handleLayoutChange(layout: SessionLayout) {
    setSessionLayout(layout)
    setSettings((prev) => {
      const updated = { ...prev, sessionLayout: layout }
      saveSettings(updated)
      return updated
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

        <button
          onClick={() => setShowLayoutPicker(true)}
          className="flex items-center gap-[5px] px-2 py-1 bg-tm-bg border border-tm-green rounded-sm hover:bg-tm-surface titlebar-nodrag flex-shrink-0"
          title="Change session layout"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-tm-green">
            <rect x="3" y="3" width="7" height="7"/>
            <rect x="14" y="3" width="7" height="7"/>
            <rect x="14" y="14" width="7" height="7"/>
            <rect x="3" y="14" width="7" height="7"/>
          </svg>
          <span className="text-[10px] font-bold text-tm-green">layout</span>
          <span className="text-[9px] text-tm-green">▾</span>
        </button>

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
        {sessionLayout === 'strip' && (
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
        )}

        {sessionLayout === 'split' && (
          <div className="flex flex-col flex-1 overflow-hidden min-w-0">
            {/* Session selector in center of topbar for split mode */}
            <div className="flex items-center justify-center h-9 flex-shrink-0 border-b border-tm-border bg-tm-bg">
              <select
                value={activeSessionId ?? ''}
                onChange={(e) => {
                  const session = sessions.find(s => s.id === e.target.value)
                  if (session) handleSelectSession(session)
                }}
                className="bg-tm-surface border border-tm-border text-tm-text text-[11px] px-2 py-1 rounded"
              >
                {activeWsId && wsSessions(activeWsId).map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </div>
            {/* Split panes */}
            <div className="flex flex-1 overflow-hidden">
              <div className="flex-1 min-w-0">
                <TerminalPane sessionId={activeSessionId} onReady={handleTerminalReady} />
              </div>
              <div className="w-[1px] bg-tm-border flex-shrink-0" />
              <div className="flex-1 min-w-0">
                {activeWsId && wsSessions(activeWsId).length > 1 ? (
                  <TerminalPane
                    sessionId={wsSessions(activeWsId).find(s => s.id !== activeSessionId)?.id ?? null}
                    onReady={handleTerminalReady}
                  />
                ) : (
                  <div className="flex items-center justify-center h-full text-tm-dim text-[11px]">
                    No second session available
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {sessionLayout === 'drawer' && (
          <div className="flex flex-1 overflow-hidden min-w-0">
            {/* Icon strip */}
            <div className="flex flex-col w-12 bg-tm-surface border-r border-tm-border gap-2 py-3 items-center flex-shrink-0">
              {activeWsId && wsSessions(activeWsId).map((s, idx) => (
                <button
                  key={s.id}
                  onClick={() => handleSelectSession(s)}
                  className={`w-8 h-8 rounded flex items-center justify-center text-[10px] font-bold transition-colors ${
                    s.id === activeSessionId
                      ? 'bg-tm-green text-tm-bg'
                      : 'bg-tm-bg text-tm-dim hover:bg-tm-border hover:text-tm-text'
                  }`}
                  title={s.name}
                >
                  {idx + 1}
                </button>
              ))}
              {activeWsId && (
                <button
                  onClick={() => handleNewSession(activeWsId)}
                  className="w-8 h-8 rounded flex items-center justify-center text-[16px] bg-tm-bg text-tm-dim hover:bg-tm-border hover:text-tm-text"
                  title="New session"
                >
                  +
                </button>
              )}
            </div>
            {/* Drawer */}
            <div className="w-[200px] bg-tm-bg border-r border-tm-border flex-shrink-0 overflow-auto">
              <div className="p-3">
                <div className="text-[9px] text-tm-dim mb-3 tracking-widest">// sessions</div>
                {activeWsId && wsSessions(activeWsId).map((s) => (
                  <div
                    key={s.id}
                    onClick={() => handleSelectSession(s)}
                    className={`group flex items-center gap-2 px-2 py-[6px] cursor-pointer rounded text-[11px] mb-1 ${
                      s.id === activeSessionId
                        ? 'bg-tm-green/10 text-tm-green border-l-2 border-tm-green pl-[6px]'
                        : 'text-tm-dim hover:bg-tm-surface border-l-2 border-transparent'
                    }`}
                  >
                    <span className="flex-1">$ {s.name}</span>
                    <button
                      className="opacity-0 group-hover:opacity-100 text-[10px] hover:text-tm-red"
                      onClick={(e) => { e.stopPropagation(); handleDeleteSession(s.id) }}
                      title="Delete session"
                    >×</button>
                  </div>
                ))}
              </div>
            </div>
            {/* Terminal */}
            <div className="flex-1 min-w-0">
              <TerminalPane sessionId={activeSessionId} onReady={handleTerminalReady} />
            </div>
          </div>
        )}

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

      {showLayoutPicker && (
        <LayoutPickerModal
          currentLayout={sessionLayout}
          onSelect={handleLayoutChange}
          onClose={() => setShowLayoutPicker(false)}
        />
      )}
    </div>
  )
}
