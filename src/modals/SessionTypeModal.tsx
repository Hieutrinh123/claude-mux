type Props = {
  onSelectClaude: () => void
  onSelectFile: () => void
  onClose: () => void
}

export default function SessionTypeModal({ onSelectClaude, onSelectFile, onClose }: Props) {
  return (
    <>
      <div className="fixed inset-0 bg-black/60 z-40" onClick={onClose} />
      <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-[360px] bg-tm-panel font-mono">
        <div className="flex flex-col gap-3 p-4">
          <div className="flex items-center justify-between">
            <span className="text-xs text-tm-text font-semibold">New Session</span>
          </div>

          <div className="flex flex-col gap-2">
            {/* Claude Session Option */}
            <button
              onClick={onSelectClaude}
              className="flex items-center gap-3 p-3 bg-tm-active hover:bg-[#1F1F1F] transition-colors text-left"
            >
              <span className="text-xs text-tm-green font-mono">[C]</span>
              <div className="flex flex-col gap-0.5 flex-1">
                <span className="text-xs text-tm-text">Claude Session</span>
                <span className="text-[11px] text-tm-muted">Auto-spawn Claude CLI in terminal</span>
              </div>
            </button>

            {/* File Viewer Option */}
            <button
              onClick={onSelectFile}
              className="flex items-center gap-3 p-3 bg-tm-active hover:bg-[#1F1F1F] transition-colors text-left"
            >
              <span className="text-xs text-tm-green font-mono">[F]</span>
              <div className="flex flex-col gap-0.5 flex-1">
                <span className="text-xs text-tm-text">View File...</span>
                <span className="text-[11px] text-tm-muted">Open markdown or code file in terminal</span>
              </div>
            </button>
          </div>
        </div>
      </div>
    </>
  )
}
