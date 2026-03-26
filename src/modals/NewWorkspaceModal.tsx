import { useState } from 'react'
import type { Workspace } from '../types'

interface Props {
  color: string
  onConfirm: (ws: Workspace) => void
  onCancel: () => void
}

export default function NewWorkspaceModal({ color, onConfirm, onCancel }: Props) {
  const [path, setPath]   = useState('')
  const [name, setName]   = useState('')
  const [error, setError] = useState<string | null>(null)

  async function handleBrowse() {
    const picked = await window.api.openFolder()
    if (!picked) return
    setPath(picked)
    if (!name) {
      const basename = picked.replace(/\\/g, '/').split('/').filter(Boolean).pop() ?? ''
      setName(basename)
    }
  }

  function handleConfirm() {
    if (!path.trim()) { setError('workspace path is required'); return }
    if (!name.trim()) { setError('workspace name is required'); return }
    onConfirm({
      id:    crypto.randomUUID(),
      name:  name.trim(),
      path:  path.trim(),
      color,
    })
  }

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50" onClick={onCancel}>
      <div
        className="w-[480px] bg-tm-surface border border-tm-border flex flex-col font-mono"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between h-10 px-4 border-b border-tm-border flex-shrink-0">
          <span className="text-[11px] font-bold text-tm-text tracking-[1px]">// new workspace</span>
          <button onClick={onCancel} className="text-[14px] text-tm-dim hover:text-tm-muted">×</button>
        </div>

        {/* Body */}
        <div className="flex flex-col gap-4 p-4">
          {/* Path */}
          <div className="flex flex-col gap-2">
            <span className="text-[10px] text-tm-dim">// workspace path</span>
            <div className="flex gap-2">
              <input
                className="flex-1 h-9 bg-tm-bg border border-tm-border px-3 text-[12px] text-tm-text placeholder-tm-dim outline-none focus:border-tm-green font-mono"
                placeholder="/path/to/project"
                value={path}
                onChange={(e) => { setPath(e.target.value); setError(null) }}
                spellCheck={false}
              />
              <button
                onClick={handleBrowse}
                className="h-9 px-3 text-[11px] text-tm-dim border border-tm-border hover:border-tm-muted hover:text-tm-muted flex-shrink-0"
              >
                browse
              </button>
            </div>
          </div>

          {/* Name */}
          <div className="flex flex-col gap-2">
            <span className="text-[10px] text-tm-dim">// name  (auto-derived from path)</span>
            <input
              className="h-9 bg-tm-bg border border-tm-border px-3 text-[12px] text-tm-text placeholder-tm-dim outline-none focus:border-tm-green font-mono"
              placeholder="my-project"
              value={name}
              onChange={(e) => { setName(e.target.value); setError(null) }}
              spellCheck={false}
            />
          </div>

          {error && (
            <span className="text-[10px] text-tm-red">{error}</span>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 h-[52px] px-4 border-t border-tm-border flex-shrink-0">
          <button
            onClick={onCancel}
            className="h-8 px-4 text-[11px] text-tm-dim border border-tm-border hover:border-tm-muted hover:text-tm-muted"
          >
            cancel
          </button>
          <button
            onClick={handleConfirm}
            className="h-8 px-4 text-[11px] font-bold text-tm-bg bg-tm-green hover:opacity-90"
          >
            open workspace
          </button>
        </div>
      </div>
    </div>
  )
}
