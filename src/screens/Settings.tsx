import type { AppSettings } from '../types'

const MODELS = [
  { id: 'claude-opus-4-5',   label: 'claude-opus-4',   desc: 'Most capable. Best for complex tasks.' },
  { id: 'claude-sonnet-4-5', label: 'claude-sonnet-4',  desc: 'Balanced. Best for everyday tasks.' },
  { id: 'claude-haiku-4-5',  label: 'claude-haiku-4',   desc: 'Fastest. Lowest cost.' },
]

interface Props {
  settings: AppSettings
  onSave: (s: AppSettings) => void
  onBack: () => void
}

export default function Settings({ settings, onSave, onBack }: Props) {
  function toggle(key: keyof AppSettings, value: unknown) {
    onSave({ ...settings, [key]: value })
  }

  return (
    <div className="flex flex-col h-screen bg-tm-bg font-mono">
      {/* Topbar */}
      <div className="flex items-center justify-between h-8 px-4 flex-shrink-0 bg-tm-surface border-b border-tm-border titlebar-drag">
        <div className="flex items-center gap-3 titlebar-nodrag">
          <span className="text-[11px] font-bold text-tm-green">claude mux</span>
          <span className="text-[11px] text-tm-border">/</span>
          <span className="text-[11px] text-tm-dim">settings</span>
        </div>
        <button
          onClick={onBack}
          className="text-[10px] text-tm-dim hover:text-tm-muted titlebar-nodrag"
        >
          ×  close
        </button>
      </div>

      {/* Body */}
      <div className="flex flex-1 overflow-hidden">
        {/* Nav */}
        <nav className="w-[200px] flex-shrink-0 border-r border-tm-border flex flex-col">
          <div className="px-3 py-4">
            <span className="text-[10px] text-tm-dim tracking-[2px]">// settings</span>
          </div>
          <div className="flex items-center h-8 px-3 border-l-2 border-tm-green bg-tm-surface">
            <span className="text-[11px] text-tm-text">general</span>
          </div>
        </nav>

        {/* Content */}
        <div className="flex-1 overflow-auto p-10 flex flex-col gap-0">
          <span className="text-[10px] text-tm-dim tracking-[2px] mb-4">// general</span>
          <div className="border-t border-tm-border" />

          {/* Default model */}
          <div className="flex items-center justify-between py-4 border-b border-tm-border">
            <div className="flex flex-col gap-1">
              <span className="text-[12px] text-tm-text">default model</span>
              <span className="text-[10px] text-tm-dim">model used when starting new sessions</span>
            </div>
            <div className="flex gap-1">
              {MODELS.map((m) => (
                <button
                  key={m.id}
                  onClick={() => toggle('defaultModel', m.id)}
                  className={`px-3 py-1 text-[10px] border transition-colors ${
                    settings.defaultModel === m.id
                      ? 'border-tm-green text-tm-green bg-[#001a0a]'
                      : 'border-tm-border text-tm-dim hover:border-tm-muted hover:text-tm-muted'
                  }`}
                >
                  {m.label.replace('claude-', '').replace('-4-5', '-4')}
                </button>
              ))}
            </div>
          </div>

          {/* Skip permissions */}
          <div className="flex items-center justify-between py-4 border-b border-tm-border">
            <div className="flex flex-col gap-1">
              <span className="text-[12px] text-tm-text">skip permissions prompt</span>
              <span className="text-[10px] text-tm-dim">
                pass --dangerously-skip-permissions on every spawn
              </span>
            </div>
            <button
              onClick={() => toggle('skipPermissions', !settings.skipPermissions)}
              className={`relative w-9 h-5 rounded-full transition-colors flex-shrink-0 ${
                settings.skipPermissions ? 'bg-tm-green' : 'bg-tm-border'
              }`}
            >
              <span
                className={`absolute top-[3px] w-[14px] h-[14px] rounded-full bg-tm-bg transition-all ${
                  settings.skipPermissions ? 'left-[19px]' : 'left-[3px]'
                }`}
              />
            </button>
          </div>
        </div>
      </div>

      {/* Statusbar */}
      <div className="flex items-center h-6 px-4 bg-tm-surface border-t border-tm-border flex-shrink-0">
        <span className="text-[10px] text-tm-dim">settings</span>
      </div>
    </div>
  )
}
