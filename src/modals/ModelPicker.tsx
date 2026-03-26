import { useEffect, useRef } from 'react'

const MODELS = [
  { id: 'claude-opus-4-5',   label: 'claude-opus-4' },
  { id: 'claude-sonnet-4-5', label: 'claude-sonnet-4' },
  { id: 'claude-haiku-4-5',  label: 'claude-haiku-4' },
]

interface Props {
  current: string
  onSelect: (model: string) => void
  onClose: () => void
}

export default function ModelPicker({ current, onSelect, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [onClose])

  return (
    <div
      ref={ref}
      className="absolute top-full right-0 mt-1 w-[220px] bg-tm-surface border border-tm-border z-50 flex flex-col font-mono shadow-lg"
    >
      <div className="flex items-center h-8 px-3 border-b border-tm-border">
        <span className="text-[9px] text-tm-dim tracking-[1px]">// select model</span>
      </div>
      <div className="py-1">
        {MODELS.map((m) => (
          <button
            key={m.id}
            onClick={() => { onSelect(m.id); onClose() }}
            className={`flex items-center justify-between w-full h-8 px-3 text-[11px] text-left hover:bg-tm-active ${
              m.id === current ? 'bg-[#1a1a1a] text-tm-text' : 'text-tm-dim'
            }`}
          >
            <span>{m.label}</span>
            {m.id === current && <span className="text-tm-green">✓</span>}
          </button>
        ))}
        <div className="border-t border-tm-border my-1" />
        <button
          onClick={onClose}
          className="flex items-center w-full h-8 px-3 text-[11px] text-tm-dim hover:bg-tm-active"
        >
          custom…
        </button>
      </div>
    </div>
  )
}
