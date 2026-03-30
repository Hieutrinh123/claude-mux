const { app, BrowserWindow, ipcMain, dialog } = require('electron')
const pty = require('node-pty')
const os = require('os')
const path = require('path')
const fs = require('fs')

const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged

const ptySessions = new Map() // sessionId -> pty process

function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#0A0A0A',
    titleBarStyle: 'hiddenInset',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })

  if (isDev) {
    win.loadURL('http://localhost:5173')
  } else {
    win.loadFile(path.join(__dirname, '../dist/index.html'))
  }
}

app.whenReady().then(createWindow)

app.on('window-all-closed', () => {
  for (const [, proc] of ptySessions) {
    try { proc.kill() } catch {}
  }
  if (process.platform !== 'darwin') app.quit()
})

// ── PTY ───────────────────────────────────────────────────────────────────────

ipcMain.handle('pty:spawn', (event, { sessionId, cwd, model, skipPermissions, cols, rows }) => {
  if (ptySessions.has(sessionId)) return

  const env = { ...process.env }
  delete env.CLAUDECODE
  env.CLAUDE_MUX = '1'

  const extraFlags = [
    ...(model ? ['--model', model] : []),
    ...(skipPermissions ? ['--dangerously-skip-permissions'] : []),
  ]

  // On Windows use cmd.exe to run claude.cmd
  const [file, args] = process.platform === 'win32'
    ? ['cmd.exe', ['/c', 'claude', ...extraFlags]]
    : ['claude', ...extraFlags]

  let proc
  try {
    proc = pty.spawn(file, args, {
      name: 'xterm-256color',
      cols: cols || 120,
      rows: rows || 40,
      cwd: cwd || os.homedir(),
      env,
      handleFlowControl: true,
      ...(process.platform === 'win32' ? { useConpty: true } : {}),
    })
  } catch (e) {
    event.sender.send(`pty:error:${sessionId}`, String(e))
    return
  }

  ptySessions.set(sessionId, proc)

  proc.onData((data) => {
    if (!event.sender.isDestroyed()) event.sender.send(`pty:data:${sessionId}`, data)
  })

  proc.onExit(({ exitCode }) => {
    ptySessions.delete(sessionId)
    if (!event.sender.isDestroyed()) event.sender.send(`pty:exit:${sessionId}`, exitCode)
  })
})

ipcMain.on('pty:write', (_e, { sessionId, data }) => {
  const proc = ptySessions.get(sessionId)
  if (proc) try { proc.write(data) } catch {}
})

ipcMain.on('pty:resize', (_e, { sessionId, cols, rows }) => {
  const proc = ptySessions.get(sessionId)
  if (proc) setTimeout(() => { try { proc.resize(cols, rows) } catch {} }, 50)
})

ipcMain.on('pty:kill', (_e, sessionId) => {
  const proc = ptySessions.get(sessionId)
  if (proc) { try { proc.kill() } catch {}; ptySessions.delete(sessionId) }
})

// ── Claude CLI detection ───────────────────────────────────────────────────────

ipcMain.handle('claude:check', async () => {
  const { exec } = require('child_process')
  return new Promise((resolve, reject) => {
    const cmd = process.platform === 'win32' ? 'where claude' : 'which claude'
    exec(cmd, (err, stdout) => {
      if (err) reject(new Error('not found'))
      else resolve(stdout.trim().split('\n')[0])
    })
  })
})

// ── Folder picker ──────────────────────────────────────────────────────────────

ipcMain.handle('dialog:open-folder', async () => {
  const result = await dialog.showOpenDialog({ properties: ['openDirectory'] })
  return result.canceled ? null : result.filePaths[0]
})

// ── Git status + diff ──────────────────────────────────────────────────────────

ipcMain.handle('git:status', async (_e, { cwd, commitHash }) => {
  const { execFile } = require('child_process')
  const SEP = '\x1e' // ASCII record separator — safe in git output

  const git = (args) => new Promise((resolve) => {
    execFile('git', args, { cwd, maxBuffer: 4 * 1024 * 1024 }, (err, stdout) => resolve(err ? '' : stdout))
  })

  // Uncommitted changes
  const statusOut = await git(['status', '--porcelain'])
  const files = statusOut.trim().split('\n').filter(Boolean).map((line) => {
    const xy = line.slice(0, 2)
    const fpath = line.slice(3).trim()
    const status = xy[0] !== ' ' && xy[0] !== '?' ? xy[0] : xy[1] !== ' ' ? xy[1] : '?'
    return { path: fpath, status }
  })

  // Recent commits — use SEP as field delimiter, \n as record delimiter
  const logOut = await git(['log', '--all', '--topo-order', `--format=%H${SEP}%P${SEP}%D${SEP}%s${SEP}%ar${SEP}%aI${SEP}%an`, '--max-count=80'])
  const commits = logOut.trim().split('\n').filter(Boolean).map((line) => {
    const parts = line.split(SEP)
    const hash     = parts[0] || ''
    const parentsStr = parts[1] || ''
    const decoStr  = parts[2] || ''
    const message  = parts[3] || ''
    const date     = parts[4] || ''
    const isoDate  = parts[5] || ''
    const author   = parts[6] || ''
    const parents  = parentsStr.trim().split(' ').filter(Boolean)
    const refs = []
    if (decoStr) {
      for (const part of decoStr.split(', ')) {
        const t = part.trim()
        if (t.startsWith('HEAD -> ')) { refs.push('HEAD', t.slice(8)) }
        else if (t) { refs.push(t) }
      }
    }
    return { hash: hash.slice(0, 7), fullHash: hash, parents, refs, message, date, isoDate, author }
  })

  // Parse a multi-file diff into { [filepath]: { patch, added, removed } }
  function parseMultiFileDiff(raw) {
    const result = {}
    let currentFile = null
    let inContent = false
    let lines = [], added = 0, removed = 0

    const flush = () => {
      if (currentFile !== null) result[currentFile] = { patch: lines.join('\n'), added, removed }
    }

    for (const ln of raw.replace(/\r/g, '').split('\n')) {
      if (ln.startsWith('diff --git ')) {
        flush()
        const m = ln.match(/diff --git a\/.+ b\/(.+)/)
        currentFile = m ? m[1] : null
        inContent = false
        lines = []; added = 0; removed = 0
      } else if (currentFile !== null) {
        if (ln.startsWith('--- ') || ln.startsWith('+++ ') || ln.startsWith('index ') ||
            ln.startsWith('Binary ') || ln.startsWith('new file') || ln.startsWith('deleted file')) {
          continue
        } else if (ln.startsWith('@@')) {
          inContent = true
          lines.push(ln)
        } else if (inContent) {
          lines.push(ln)
          if (ln.startsWith('+')) added++
          else if (ln.startsWith('-')) removed++
        }
      }
    }
    flush()
    return result
  }

  let fileDiffs = {}

  if (commitHash) {
    const diffOut = await git(['show', commitHash, '--patch', '--no-color'])
    fileDiffs = parseMultiFileDiff(diffOut)
  } else if (files.length > 0) {
    // Get all changed files at once
    const diffOut = await git(['diff', 'HEAD'])
    fileDiffs = parseMultiFileDiff(diffOut)
    if (Object.keys(fileDiffs).length === 0) {
      // May be all staged
      const stagedOut = await git(['diff', '--cached'])
      fileDiffs = parseMultiFileDiff(stagedOut)
    }
  }

  return { files, commits, fileDiffs }
})

// ── Clipboard image handler ────────────────────────────────────────────────────

ipcMain.handle('clipboard:save-image', async (_e, { buffer, ext }) => {
  const tmpDir = os.tmpdir()
  const timestamp = Date.now()
  const fileName = `paste-${timestamp}.${ext}`
  const filePath = path.join(tmpDir, fileName)

  try {
    fs.writeFileSync(filePath, Buffer.from(buffer))
    return filePath
  } catch (err) {
    throw new Error(`Failed to save image: ${err.message}`)
  }
})
