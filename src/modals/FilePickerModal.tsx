import { useState, useEffect } from 'react'

type FileItem = {
  name: string
  path: string
  ext: string
}

type Props = {
  workspacePath: string
  onSelect: (filePath: string) => void
  onClose: () => void
}

const EXT_COLORS: Record<string, string> = {
  md: 'text-tm-green',
  ts: 'text-tm-cyan',
  tsx: 'text-tm-cyan',
  js: 'text-[#F59E0B]',
  jsx: 'text-[#F59E0B]',
  json: 'text-[#F59E0B]',
  py: 'text-tm-green',
  txt: 'text-tm-muted',
}

export default function FilePickerModal({ workspacePath, onSelect, onClose }: Props) {
  const [files, setFiles] = useState<FileItem[]>([])
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [filter, setFilter] = useState<string>('all')

  useEffect(() => {
    loadFiles()
  }, [workspacePath])

  async function loadFiles() {
    try {
      const fileList = await window.api.listFiles(workspacePath)
      setFiles(fileList)
    } catch (err) {
      console.error('Failed to load files:', err)
    }
  }

  const filteredFiles = files.filter((f) => {
    if (filter === 'all') return true
    return f.ext === filter
  })

  const handleSelect = () => {
    if (filteredFiles[selectedIndex]) {
      onSelect(filteredFiles[selectedIndex].path)
    }
  }

  return (
    <>
      <div className="fixed inset-0 bg-black/60 z-40" onClick={onClose} />
      <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-[480px] h-[520px] bg-tm-panel font-mono flex flex-col">
        <div className="flex flex-col gap-3 p-4 flex-1 overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between">
            <span className="text-xs text-tm-text font-semibold">Select File</span>
            <button onClick={onClose} className="w-5 h-5 bg-[#3D3D3D] hover:bg-tm-border transition-colors" />
          </div>

          {/* Filter */}
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-tm-muted font-semibold">Filter:</span>
            <select
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              className="flex-1 px-3 py-2 text-xs bg-tm-active border border-tm-border text-tm-text focus:outline-none"
            >
              <option value="all">All files</option>
              <option value="md">Markdown (.md)</option>
              <option value="ts">TypeScript (.ts, .tsx)</option>
              <option value="js">JavaScript (.js, .jsx)</option>
              <option value="json">JSON (.json)</option>
              <option value="py">Python (.py)</option>
            </select>
          </div>

          {/* File List */}
          <div className="flex-1 bg-tm-bg border border-tm-border p-2 overflow-y-auto">
            <div className="flex flex-col gap-px">
              {filteredFiles.map((file, idx) => {
                const isSelected = idx === selectedIndex
                const extColor = EXT_COLORS[file.ext] || 'text-tm-muted'
                return (
                  <button
                    key={file.path}
                    onClick={() => setSelectedIndex(idx)}
                    onDoubleClick={handleSelect}
                    className={`flex items-center gap-2 px-3 py-2.5 text-left transition-colors ${
                      isSelected ? 'bg-tm-panel border border-tm-green' : 'bg-tm-bg hover:bg-[#0D0D0D]'
                    }`}
                  >
                    <span className={`text-[10px] font-mono ${extColor}`}>[{file.ext}]</span>
                    <span className="text-xs text-tm-text">{file.name}</span>
                  </button>
                )
              })}
            </div>
          </div>

          {/* Buttons */}
          <div className="flex justify-end gap-2">
            <button
              onClick={onClose}
              className="px-4 h-8 bg-tm-active border border-tm-border text-xs text-tm-text hover:bg-[#1F1F1F] transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleSelect}
              className="px-4 h-8 bg-tm-green text-xs text-tm-bg font-semibold hover:bg-[#0EA572] transition-colors"
            >
              Open
            </button>
          </div>
        </div>
      </div>
    </>
  )
}
