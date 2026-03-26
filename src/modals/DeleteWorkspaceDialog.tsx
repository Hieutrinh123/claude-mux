import type { Workspace } from '../types'

interface Props {
  workspace: Workspace
  onConfirm: () => void
  onCancel: () => void
}

export default function DeleteWorkspaceDialog({ workspace, onConfirm, onCancel }: Props) {
  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 font-mono">
      <div className="w-[360px] bg-tm-surface border border-tm-border flex flex-col">
        <div className="flex items-center h-9 px-4 border-b border-tm-border">
          <span className="text-[11px] font-bold text-tm-text">// confirm delete</span>
        </div>
        <div className="flex flex-col gap-3 p-4">
          <p className="text-[12px] text-tm-text">
            delete workspace &nbsp;<span className="text-tm-green">{workspace.name}</span> ?
          </p>
          <p className="text-[10px] text-tm-dim leading-relaxed">
            this removes all sessions and history for this workspace.
            files on disk are not deleted.
          </p>
          <div className="flex gap-2 pt-1">
            <button
              onClick={onCancel}
              className="flex-1 h-8 text-[11px] text-tm-dim border border-tm-border hover:border-tm-muted hover:text-tm-muted"
            >
              cancel
            </button>
            <button
              onClick={onConfirm}
              className="flex-1 h-8 text-[11px] font-bold text-tm-red border border-tm-red hover:bg-[#1a0000]"
            >
              delete workspace
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
