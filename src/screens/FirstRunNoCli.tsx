interface Props {
  onRetry: () => void
}

export default function FirstRunNoCli({ onRetry }: Props) {
  return (
    <div className="flex flex-col h-screen bg-tm-bg font-mono">
      {/* Topbar */}
      <div className="flex items-center h-8 px-4 flex-shrink-0 bg-tm-surface border-b border-tm-border titlebar-drag">
        <span className="text-[11px] font-bold text-tm-green titlebar-nodrag">claude mux</span>
      </div>

      {/* Body */}
      <div className="flex-1 flex items-center justify-center">
        <div className="w-[560px] bg-tm-surface border border-tm-border flex flex-col gap-4 p-8">
          <span className="text-[10px] text-tm-dim tracking-[2px]">// error</span>
          <h1 className="text-[18px] font-bold text-tm-text">claude CLI not found</h1>
          <p className="text-[12px] text-tm-dim leading-relaxed">
            claude was not found in your PATH. install it to continue.
          </p>

          <div className="bg-tm-bg border border-tm-border px-4 py-3">
            <span className="text-[12px] text-tm-green">
              npm install -g @anthropic-ai/claude-code
            </span>
          </div>

          <p className="text-[11px] text-tm-dim">
            once installed, click retry below.
          </p>

          <button
            onClick={onRetry}
            className="h-9 bg-tm-green text-tm-bg text-[12px] font-bold hover:opacity-90 active:opacity-80 transition-opacity"
          >
            retry detection
          </button>
        </div>
      </div>

      {/* Statusbar */}
      <div className="flex items-center h-6 px-4 bg-tm-surface border-t border-tm-border flex-shrink-0">
        <span className="text-[10px] text-tm-dim">claude CLI not detected</span>
      </div>
    </div>
  )
}
