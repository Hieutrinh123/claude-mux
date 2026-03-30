import { useState } from 'react'
import type { SessionLayout } from '../types'

interface LayoutPickerModalProps {
  currentLayout: SessionLayout
  onSelect: (layout: SessionLayout) => void
  onClose: () => void
}

type LayoutOption = {
  id: SessionLayout
  name: string
  description: string
}

const LAYOUTS: LayoutOption[] = [
  { id: 'strip', name: 'Session Strip', description: 'Horizontal tabs below topbar' },
  { id: 'split', name: 'Split Pane', description: 'Side-by-side session view' },
  { id: 'drawer', name: 'Session Drawer', description: 'Compact icon strip + drawer' },
]

export default function LayoutPickerModal({ currentLayout, onSelect, onClose }: LayoutPickerModalProps) {
  const [selectedLayout, setSelectedLayout] = useState<SessionLayout>(currentLayout)

  const handleApply = () => {
    onSelect(selectedLayout)
    onClose()
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') onClose()
    if (e.key === 'Enter') handleApply()
  }

  return (
    <div
      className="fixed inset-0 flex items-start justify-center bg-black/40 z-50"
      onClick={onClose}
      onKeyDown={handleKeyDown}
    >
      <div
        className="mt-8 w-[360px] bg-tm-surface border border-tm-border rounded-sm shadow-2xl"
        style={{ boxShadow: '0 8px 24px rgba(0,0,0,0.6)' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between h-9 px-3 border-b border-tm-border">
          <span className="text-[9px] text-tm-dim tracking-widest">// select layout</span>
          <button
            onClick={onClose}
            className="text-tm-dim hover:text-tm-text text-[14px] leading-none"
          >
            ×
          </button>
        </div>

        {/* Layout Grid */}
        <div className="p-3 space-y-2">
          {LAYOUTS.map((layout) => (
            <div
              key={layout.id}
              onClick={() => setSelectedLayout(layout.id)}
              className={`flex items-center gap-3 p-3 rounded cursor-pointer border transition-all ${
                selectedLayout === layout.id
                  ? 'border-tm-green bg-tm-green/10'
                  : 'border-tm-border hover:border-tm-muted bg-tm-bg'
              }`}
            >
              {/* Preview Icon */}
              <div className={`flex-shrink-0 w-12 h-12 rounded border flex items-center justify-center ${
                selectedLayout === layout.id ? 'border-tm-green' : 'border-tm-border'
              }`}>
                {layout.id === 'strip' && (
                  <svg width="32" height="24" viewBox="0 0 32 24" fill="none">
                    <rect x="2" y="2" width="28" height="4" fill="currentColor" opacity="0.3" />
                    <rect x="2" y="8" width="8" height="2" fill="currentColor" opacity="0.6" />
                    <rect x="12" y="8" width="8" height="2" fill="currentColor" opacity="0.4" />
                    <rect x="22" y="8" width="8" height="2" fill="currentColor" opacity="0.4" />
                    <rect x="2" y="12" width="28" height="10" fill="currentColor" opacity="0.2" />
                  </svg>
                )}
                {layout.id === 'split' && (
                  <svg width="32" height="24" viewBox="0 0 32 24" fill="none">
                    <rect x="2" y="2" width="28" height="4" fill="currentColor" opacity="0.3" />
                    <rect x="2" y="8" width="13" height="14" fill="currentColor" opacity="0.2" />
                    <line x1="15.5" y1="8" x2="15.5" y2="22" stroke="currentColor" opacity="0.5" />
                    <rect x="17" y="8" width="13" height="14" fill="currentColor" opacity="0.2" />
                  </svg>
                )}
                {layout.id === 'drawer' && (
                  <svg width="32" height="24" viewBox="0 0 32 24" fill="none">
                    <rect x="2" y="2" width="28" height="4" fill="currentColor" opacity="0.3" />
                    <rect x="2" y="8" width="3" height="14" fill="currentColor" opacity="0.4" />
                    <rect x="6" y="8" width="6" height="14" fill="currentColor" opacity="0.3" />
                    <rect x="14" y="8" width="16" height="14" fill="currentColor" opacity="0.2" />
                  </svg>
                )}
              </div>

              {/* Label & Description */}
              <div className="flex-1 min-w-0">
                <div className={`text-[11px] font-bold ${
                  selectedLayout === layout.id ? 'text-tm-green' : 'text-tm-text'
                }`}>
                  {layout.name}
                </div>
                <div className="text-[9px] text-tm-dim mt-0.5">
                  {layout.description}
                </div>
              </div>

              {/* Checkmark */}
              {selectedLayout === layout.id && (
                <div className="flex-shrink-0 text-tm-green text-[12px]">✓</div>
              )}
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between h-9 px-3 border-t border-tm-border">
          <span className="text-[9px] text-tm-dim">esc to close</span>
          <button
            onClick={handleApply}
            className="px-[10px] py-1 bg-tm-green/90 hover:bg-tm-green text-tm-bg text-[9px] font-bold rounded"
          >
            APPLY
          </button>
        </div>
      </div>
    </div>
  )
}
