const { app, BrowserWindow, ipcMain, dialog } = require('electron')
const pty = require('node-pty')
const os = require('os')
const path = require('path')

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

ipcMain.handle('pty:spawn', (event, { sessionId, cwd, model, skipPermissions }) => {
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
      cols: 200,
      rows: 50,
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
    event.sender.send(`pty:data:${sessionId}`, data)
  })

  proc.onExit(({ exitCode }) => {
    ptySessions.delete(sessionId)
    event.sender.send(`pty:exit:${sessionId}`, exitCode)
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
