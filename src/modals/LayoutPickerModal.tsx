import { useState } from 'react'
import type { SessionLayout } from '../types'

interface Props {
  currentLayout: SessionLayout
  anchor: DOMRect | null
  onSelect: (layout: SessionLayout) => void
  onClose: () => void
}

type LayoutOption = { id: Exclude<SessionLayout, 'single'>; name: string }

const LAYOUTS: LayoutOption[] = [
  { id: 'split',  name: 'Split Pane'   },
  { id: 'hstack', name: 'Horiz Stack'  },
  { id: 'master', name: 'Master+Stack' },
  { id: 'quad',   name: 'Quad Grid'    },
  { id: 'three',  name: 'Three Col'    },
]

function LayoutPreview({ id }: { id: Exclude<SessionLayout, 'single'> }) {
  const W = 90, H = 48, P = 3, G = 2
  const iw = W - P * 2, ih = H - P * 2
  const hw = (iw - G) / 2
  const hh = (ih - G) / 2
  const C = '#06B6D4'

  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} fill="none" className="w-full h-full">
      {id === 'split' && <>
        <rect x={P} y={P} width={hw} height={ih} fill={C} opacity={0.2} rx={1} />
        <rect x={P+hw+G} y={P} width={hw} height={ih} fill={C} opacity={0.2} rx={1} />
      </>}
      {id === 'hstack' && <>
        <rect x={P} y={P} width={iw} height={hh} fill={C} opacity={0.2} rx={1} />
        <rect x={P} y={P+hh+G} width={iw} height={hh} fill={C} opacity={0.2} rx={1} />
      </>}
      {id === 'master' && <>
        <rect x={P} y={P} width={iw*0.58} height={ih} fill="#F59E0B" opacity={0.22} rx={1} />
        <rect x={P+iw*0.58+G} y={P} width={iw*0.42-G} height={hh} fill="#F59E0B" opacity={0.15} rx={1} />
        <rect x={P+iw*0.58+G} y={P+hh+G} width={iw*0.42-G} height={hh} fill="#F59E0B" opacity={0.15} rx={1} />
      </>}
      {id === 'quad' && <>
        <rect x={P} y={P} width={hw} height={hh} fill={C} opacity={0.2} rx={1} />
        <rect x={P+hw+G} y={P} width={hw} height={hh} fill={C} opacity={0.2} rx={1} />
        <rect x={P} y={P+hh+G} width={hw} height={hh} fill={C} opacity={0.2} rx={1} />
        <rect x={P+hw+G} y={P+hh+G} width={hw} height={hh} fill={C} opacity={0.2} rx={1} />
      </>}
      {id === 'three' && <>
        <rect x={P} y={P} width={(iw-G*2)/3} height={ih} fill={C} opacity={0.18} rx={1} />
        <rect x={P+(iw-G*2)/3+G} y={P} width={(iw-G*2)/3} height={ih} fill={C} opacity={0.18} rx={1} />
        <rect x={P+2*((iw-G*2)/3+G)} y={P} width={(iw-G*2)/3} height={ih} fill={C} opacity={0.18} rx={1} />
      </>}
    </svg>
  )
}

function LayoutCard({ layout, selected, onSelect }: {
  layout: LayoutOption
  selected: boolean
  onSelect: (id: Exclude<SessionLayout, 'single'>) => void
}) {
  return (
    <div
      onClick={() => onSelect(layout.id)}
      className={`flex-1 flex flex-col items-center gap-1.5 p-2 cursor-pointer border transition-colors ${
        selected ? 'bg-[#1A1A1A] border-tm-green' : 'bg-[#141414] border-[#2a2a2a] hover:border-[#4B5563]'
      }`}
    >
      <div className="w-full border border-[#2a2a2a] bg-[#141414]" style={{ height: 48 }}>
        <LayoutPreview id={layout.id} />
      </div>
      <span className={`text-[9px] font-bold font-mono ${selected ? 'text-tm-green' : 'text-[#6B7280]'}`}>
        {layout.name}
      </span>
    </div>
  )
}

export default function LayoutPickerModal({ currentLayout, anchor, onSelect, onClose }: Props) {
  const [selected, setSelected] = useState<Exclude<SessionLayout, 'single'>>(
    currentLayout === 'single' ? 'split' : currentLayout
  )

  const handleApply = () => { onSelect(selected); onClose() }

  const top  = anchor ? anchor.bottom + 6 : 40
  const left = anchor ? anchor.right - 360 : undefined

  return (
    <div
      className="fixed inset-0 z-50"
      onClick={onClose}
      onKeyDown={(e) => { if (e.key === 'Escape') onClose(); if (e.key === 'Enter') handleApply() }}
    >
      <div
        className="absolute w-[360px] bg-[#0F0F0F] border border-tm-border"
        style={{ top, left, boxShadow: '0 8px 24px rgba(0,0,0,0.6)' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between h-9 px-3 border-b border-tm-border">
          <span className="text-[9px] text-tm-dim tracking-widest font-mono">// select layout</span>
          <button onClick={onClose} className="text-tm-dim hover:text-tm-text text-[14px] leading-none">×</button>
        </div>

        {/* Grid */}
        <div className="flex flex-col gap-2 p-3">
          <div className="flex gap-2">
            {LAYOUTS.slice(0, 3).map((l) => (
              <LayoutCard key={l.id} layout={l} selected={selected === l.id} onSelect={setSelected} />
            ))}
          </div>
          <div className="flex gap-2">
            {LAYOUTS.slice(3).map((l) => (
              <LayoutCard key={l.id} layout={l} selected={selected === l.id} onSelect={setSelected} />
            ))}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between h-9 px-3 border-t border-tm-border">
          <button
            onClick={() => { onSelect('single'); onClose() }}
            className="flex items-center gap-1.5 px-2 py-[3px] border border-[#2a2a2a] text-[#6B7280] text-[9px] font-mono hover:border-[#4B5563] hover:text-tm-muted transition-colors"
          >
            <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/>
              <path d="M3 3v5h5"/>
            </svg>
            single panel
          </button>
          <button
            onClick={handleApply}
            className="px-[10px] py-1 bg-tm-green text-tm-bg text-[9px] font-bold font-mono hover:bg-tm-green/90 transition-colors"
          >
            apply
          </button>
        </div>
      </div>
    </div>
  )
}
