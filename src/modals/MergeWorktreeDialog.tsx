interface MergeWorktreeDialogProps {
  isOpen: boolean
  sessionName: string
  branchName: string
  hasUncommitted: boolean
  onMerge: () => void
  onDiscard: () => void
  onCancel: () => void
}

export default function MergeWorktreeDialog({
  isOpen,
  sessionName,
  branchName,
  hasUncommitted,
  onMerge,
  onDiscard,
  onCancel,
}: MergeWorktreeDialogProps) {
  if (!isOpen) return null

  return (
    <div className="fixed inset-0 flex items-center justify-center z-50 bg-black/60">
      <div className="bg-[#1A1A1A] border border-[#2a2a2a] rounded-lg w-[480px] shadow-2xl">
        {/* Header */}
        <div className="px-5 py-4 border-b border-[#2a2a2a]">
          <h2 className="text-[15px] font-semibold text-tm-text">Close Session Worktree</h2>
          <p className="text-[12px] text-tm-muted mt-1">
            Session: <span className="text-tm-text font-medium">{sessionName}</span>
          </p>
        </div>

        {/* Body */}
        <div className="px-5 py-4 space-y-3">
          <div className="text-[12px] text-tm-muted">
            This session has an active worktree on branch:
          </div>
          <div className="px-3 py-2 bg-[#0D0D0D] border border-[#2a2a2a] rounded font-mono text-[11px] text-tm-green">
            {branchName}
          </div>

          {hasUncommitted && (
            <div className="flex items-start gap-2 px-3 py-2 bg-[#2D1F0A] border border-[#F59E0B] rounded">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" className="flex-shrink-0 mt-[1px]">
                <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" stroke="#F59E0B" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                <line x1="12" y1="9" x2="12" y2="13" stroke="#F59E0B" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                <line x1="12" y1="17" x2="12.01" y2="17" stroke="#F59E0B" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              <div className="text-[11px] text-[#F59E0B]">
                This branch has uncommitted changes
              </div>
            </div>
          )}

          <div className="text-[12px] text-tm-muted pt-2">
            What would you like to do?
          </div>
        </div>

        {/* Actions */}
        <div className="px-5 py-4 border-t border-[#2a2a2a] flex items-center gap-2">
          <button
            onClick={onCancel}
            className="px-4 py-2 text-[12px] text-tm-muted hover:text-tm-text border border-[#2a2a2a] rounded bg-[#1A1A1A] hover:bg-[#252525]"
          >
            Cancel
          </button>
          <div className="flex-1" />
          <button
            onClick={onDiscard}
            className="px-4 py-2 text-[12px] text-[#EF4444] hover:text-white border border-[#EF4444] rounded bg-[#1A1A1A] hover:bg-[#EF4444]/20"
          >
            Discard Changes
          </button>
          <button
            onClick={onMerge}
            className="px-4 py-2 text-[12px] text-white border border-tm-green rounded bg-tm-green hover:bg-tm-green/80"
          >
            Merge to Main
          </button>
        </div>
      </div>
    </div>
  )
}
