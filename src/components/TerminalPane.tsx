import { useEffect, useRef } from 'react'
import { Terminal as XTerm } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'

// Per-session terminal buffer — survives component unmount
const buffers = new Map<string, string[]>()

function appendBuf(sid: string, data: string) {
  let b = buffers.get(sid)
  if (!b) { b = []; buffers.set(sid, b) }
  b.push(data)
  if (b.length > 3000) b.splice(0, b.length - 3000)
}

export function clearBuffer(sid: string) {
  buffers.delete(sid)
}

export default function TerminalPane({ sessionId }: { sessionId: string | null }) {
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!sessionId) return
    const sid = sessionId
    let disposed = false
    let term: XTerm | null = null
    let userScrolledUp = false
    const pending: string[] = []

    const offData = window.api.onPtyData(sid, (data) => {
      appendBuf(sid, data)
      if (term) {
        term.write(data)
        if (!userScrolledUp) requestAnimationFrame(() => term?.scrollToBottom())
      } else {
        pending.push(data)
      }
    })

    const offExit = window.api.onPtyExit(sid, (code) => {
      const msg = `\r\n\x1b[90m[process exited: ${code}]\x1b[0m\r\n`
      appendBuf(sid, msg)
      if (term) term.write(msg)
      else pending.push(msg)
    })

    function tryInit(): boolean {
      const el = containerRef.current
      if (!el || disposed) return false
      if (el.offsetWidth < 50 || el.offsetHeight < 50) return false

      const t = new XTerm({
        cursorBlink: true,
        fontSize: 13,
        fontFamily: '"JetBrains Mono", "Fira Code", Menlo, monospace',
        scrollback: 5000,
        theme: {
          background:          '#0A0A0A',
          foreground:          '#FAFAFA',
          cursor:              '#10B981',
          cursorAccent:        '#0A0A0A',
          selectionBackground: '#10B98133',
          black:   '#1e1e1e', red:     '#EF4444', green:   '#10B981', yellow:  '#F59E0B',
          blue:    '#3B82F6', magenta: '#A855F7', cyan:    '#06B6D4', white:   '#FAFAFA',
          brightBlack:   '#4B5563', brightRed:     '#F87171', brightGreen: '#34D399',
          brightYellow:  '#FCD34D', brightBlue:    '#60A5FA', brightMagenta: '#C084FC',
          brightCyan:    '#22D3EE', brightWhite:   '#FFFFFF',
        },
      })

      const fa = new FitAddon()
      t.loadAddon(fa)

      try { t.open(el) } catch { t.dispose(); return false }
      term = t

      let isComposing = false
      const textarea = el.querySelector<HTMLTextAreaElement>('.xterm-helper-textarea')
      if (textarea) {
        textarea.addEventListener('compositionstart', () => { isComposing = true })
        textarea.addEventListener('compositionend', () => setTimeout(() => { isComposing = false }, 50))
        textarea.setAttribute('autocomplete', 'off')
        textarea.setAttribute('autocorrect', 'off')
        textarea.setAttribute('autocapitalize', 'off')
        textarea.setAttribute('spellcheck', 'false')
      }

      for (const chunk of buffers.get(sid) ?? []) t.write(chunk)
      for (const d of pending) t.write(d)
      pending.length = 0

      requestAnimationFrame(() => {
        if (disposed) return
        fa.fit()
        const dims = fa.proposeDimensions()
        if (dims?.cols && dims?.rows) window.api.ptyResize(sid, dims.cols, dims.rows)
      })

      t.onData((data) => {
        if (isComposing && data.length > 1 && data.charCodeAt(0) >= 32) return
        window.api.ptyWrite(sid, data)
      })

      t.attachCustomKeyEventHandler((e) => {
        if (e.type !== 'keydown') return true
        if ((e.ctrlKey || e.metaKey) && e.key === 'c' && t.hasSelection()) {
          navigator.clipboard.writeText(t.getSelection()).catch(() => {})
          return false
        }
        if ((e.ctrlKey || e.metaKey) && e.key === 'v') {
          navigator.clipboard.readText().then((txt) => window.api.ptyWrite(sid, txt)).catch(() => {})
          return false
        }
        return true
      })

      el.addEventListener('contextmenu', (e) => {
        e.preventDefault()
        const sel = t.getSelection()
        if (sel) navigator.clipboard.writeText(sel).catch(() => {})
        else navigator.clipboard.readText().then((txt) => window.api.ptyWrite(sid, txt)).catch(() => {})
      })

      el.addEventListener('wheel', (e) => {
        if (e.deltaY < 0) { userScrolledUp = true }
        else {
          const buf = t.buffer.active
          if (buf.viewportY + t.rows >= buf.length - 2) userScrolledUp = false
        }
      }, { passive: true })

      const ro = new ResizeObserver(() => {
        setTimeout(() => {
          if (disposed) return
          const wasBottom = !userScrolledUp
          try {
            fa.fit()
            const dims = fa.proposeDimensions()
            if (dims?.cols && dims?.rows) window.api.ptyResize(sid, dims.cols, dims.rows)
          } catch {}
          if (wasBottom) requestAnimationFrame(() => { if (!disposed) t.scrollToBottom() })
        }, 50)
      })
      ro.observe(el)
      ;(el as any).__ro = ro

      t.focus()
      return true
    }

    if (!tryInit()) {
      const iv = setInterval(() => { if (tryInit()) clearInterval(iv) }, 50)
      return () => { disposed = true; clearInterval(iv); cleanup() }
    }
    return () => { disposed = true; cleanup() }

    function cleanup() {
      offData(); offExit()
      const el = containerRef.current
      if (el) { ((el as any).__ro as ResizeObserver)?.disconnect(); delete (el as any).__ro }
      term?.dispose(); term = null
    }
  }, [sessionId])

  if (!sessionId) {
    return (
      <div className="flex-1 flex items-center justify-center bg-tm-bg">
        <span className="text-tm-dim text-sm">select a workspace to start</span>
      </div>
    )
  }

  return (
    <div
      ref={containerRef}
      className="flex-1 overflow-hidden selectable"
      style={{ background: '#0A0A0A', minWidth: 0, minHeight: 0 }}
      onClick={() => containerRef.current?.querySelector<HTMLTextAreaElement>('.xterm-helper-textarea')?.focus()}
    />
  )
}
