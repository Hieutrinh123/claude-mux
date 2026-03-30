import type { Session, Workspace } from '../types'

interface Props {
  sessionId: string | null
  sessions: Session[]
  workspaces: Workspace[]
  isOpen: boolean
  onToggle: (e: React.MouseEvent<HTMLDivElement>) => void
}

export default function PaneHeader({ sessionId, sessions, workspaces, isOpen, onToggle }: Props) {
  const session  = sessions.find(s => s.id === sessionId) ?? null
  const workspace = session ? workspaces.find(w => w.id === session.workspaceId) : null

  return (
    <div
      onMouseDown={e => e.stopPropagation()}
      onClick={onToggle}
      className={`flex items-center justify-between h-6 px-2 cursor-pointer flex-shrink-0 group ${
        isOpen
          ? 'bg-[#161616] border-b border-[#10B98133]'
          : 'bg-[#0F0F0F] border-b border-[#2a2a2a] hover:bg-[#161616]'
      }`}
    >
      <div className="flex items-center gap-1.5">
        <div
          className="w-[5px] h-[5px] rounded-sm flex-shrink-0"
          style={{ background: workspace?.color ?? '#4B5563' }}
        />
        <span className={`text-[10px] font-mono ${
          isOpen ? 'text-tm-text' : 'text-[#6B7280] group-hover:text-tm-text'
        }`}>
          {session?.name ?? '—'}
        </span>
      </div>
      <svg
        width="10" height="10" viewBox="0 0 24 24" fill="none"
        stroke={isOpen ? '#10B981' : '#4B5563'}
        strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
        className="flex-shrink-0"
      >
        {isOpen
          ? <polyline points="18 15 12 9 6 15" />
          : <polyline points="6 9 12 15 18 9" />
        }
      </svg>
    </div>
  )
}
