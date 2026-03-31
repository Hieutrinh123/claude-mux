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

  // Clean up all worktrees on app close
  cleanupAllWorktrees()

  if (process.platform !== 'darwin') app.quit()
})

// Clean up all .claude-worktrees directories
function cleanupAllWorktrees() {
  const { execFileSync } = require('child_process')
  try {
    // Get list of all worktrees
    const output = execFileSync('git', ['worktree', 'list', '--porcelain'], { encoding: 'utf8' })
    const lines = output.split('\n')

    // Find all worktrees in .claude-worktrees directories
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].startsWith('worktree ')) {
        const worktreePath = lines[i].substring('worktree '.length)
        if (worktreePath.includes('.claude-worktrees')) {
          try {
            execFileSync('git', ['worktree', 'remove', worktreePath, '--force'], { encoding: 'utf8' })
            console.log('Cleaned up worktree:', worktreePath)
          } catch (err) {
            console.error('Failed to cleanup worktree:', worktreePath, err.message)
          }
        }
      }
    }
  } catch (err) {
    // Ignore errors - might not be in a git repo
    console.error('Failed to cleanup worktrees:', err.message)
  }
}

// ── PTY ───────────────────────────────────────────────────────────────────────

ipcMain.handle('pty:spawn', (event, { sessionId, cwd, model, skipPermissions, cols, rows, sessionType, filePath }) => {
  if (ptySessions.has(sessionId)) return

  const env = { ...process.env }
  delete env.CLAUDECODE
  env.CLAUDE_MUX = '1'

  let file, args

  if (sessionType === 'file-viewer') {
    // For file viewer, spawn cat/bat to display file contents
    // Try bat first (if available), fallback to cat
    if (process.platform === 'win32') {
      file = 'cmd.exe'
      args = ['/c', 'type', filePath]
    } else {
      file = 'cat'
      args = [filePath]
    }
  } else {
    // Default: Claude session
    const extraFlags = [
      ...(model ? ['--model', model] : []),
      ...(skipPermissions ? ['--dangerously-skip-permissions'] : []),
    ]

    // On Windows use cmd.exe to run claude.cmd
    if (process.platform === 'win32') {
      file = 'cmd.exe'
      args = ['/c', 'claude', ...extraFlags]
    } else {
      file = 'claude'
      args = extraFlags
    }
  }

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

ipcMain.handle('dialog:open-folder', async (event) => {
  const win = BrowserWindow.fromWebContents(event.sender)
  const result = await dialog.showOpenDialog(win, { properties: ['openDirectory'] })
  return result.canceled ? null : result.filePaths[0]
})

// ── File picker ────────────────────────────────────────────────────────────────

ipcMain.handle('dialog:open-file', async (event, { defaultPath } = {}) => {
  const win = BrowserWindow.fromWebContents(event.sender)
  const result = await dialog.showOpenDialog(win, { properties: ['openFile'], defaultPath })
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

// ── File read ──────────────────────────────────────────────────────────────────

ipcMain.handle('files:read', async (_e, { filePath }) => {
  return fs.readFileSync(filePath, 'utf8')
})

// ── File list ──────────────────────────────────────────────────────────────────

ipcMain.handle('files:list', async (_e, { cwd }) => {
  try {
    const files = []

    function walkDir(dir, depth = 0) {
      if (depth > 3) return // Limit depth to avoid huge lists

      const entries = fs.readdirSync(dir, { withFileTypes: true })

      for (const entry of entries) {
        // Skip hidden files, node_modules, .git, etc.
        if (entry.name.startsWith('.') || entry.name === 'node_modules') continue

        const fullPath = path.join(dir, entry.name)

        if (entry.isDirectory()) {
          walkDir(fullPath, depth + 1)
        } else if (entry.isFile()) {
          const ext = path.extname(entry.name).slice(1) // Remove leading dot
          files.push({
            name: entry.name,
            path: fullPath,
            ext: ext || 'txt'
          })
        }
      }
    }

    walkDir(cwd)
    return files.slice(0, 500) // Limit to 500 files max
  } catch (err) {
    console.error('Failed to list files:', err)
    return []
  }
})

// ── Git Worktree ───────────────────────────────────────────────────────────────

ipcMain.handle('git:worktree:create', async (_e, { sessionId, workspaceId, workspacePath }) => {
  const { execFile } = require('child_process')

  return new Promise((resolve, reject) => {
    const worktreesDir = path.join(workspacePath, '.claude-worktrees')
    const worktreePath = path.join(worktreesDir, `session_${sessionId}`)
    const branchName = `claude-session/${workspaceId}/${sessionId}`

    // Create .claude-worktrees directory if it doesn't exist
    if (!fs.existsSync(worktreesDir)) {
      fs.mkdirSync(worktreesDir, { recursive: true })
    }

    // First, try to remove any existing worktree at this path (cleanup from crashed sessions)
    execFile('git', ['worktree', 'remove', worktreePath, '--force'],
      { cwd: workspacePath },
      () => {
        // Ignore errors - worktree might not exist, which is fine

        // Check if branch already exists, if so use -B to force recreate
        execFile('git', ['rev-parse', '--verify', branchName],
          { cwd: workspacePath },
          (checkErr) => {
            const branchExists = !checkErr
            const flag = branchExists ? '-B' : '-b'

            // Create worktree with new (or force-recreated) branch
            execFile('git', ['worktree', 'add', flag, branchName, worktreePath],
              { cwd: workspacePath },
              (err, stdout, stderr) => {
                if (err) {
                  reject(new Error(`Failed to create worktree: ${stderr || err.message}`))
                } else {
                  resolve({ worktreePath, branchName })
                }
              }
            )
          }
        )
      }
    )
  })
})

ipcMain.handle('git:worktree:delete', async (_e, { sessionId, workspacePath }) => {
  const { execFile } = require('child_process')

  return new Promise((resolve, reject) => {
    const worktreePath = path.join(workspacePath, '.claude-worktrees', `session_${sessionId}`)

    // Remove worktree
    execFile('git', ['worktree', 'remove', worktreePath, '--force'],
      { cwd: workspacePath },
      (err, stdout, stderr) => {
        if (err) {
          reject(new Error(`Failed to delete worktree: ${stderr || err.message}`))
        } else {
          resolve({ success: true })
        }
      }
    )
  })
})

ipcMain.handle('git:worktree:merge', async (_e, { sessionId, workspaceId, workspacePath, targetBranch }) => {
  const { execFile } = require('child_process')

  return new Promise((resolve, reject) => {
    const branchName = `claude-session/${workspaceId}/${sessionId}`
    const worktreePath = path.join(workspacePath, '.claude-worktrees', `session_${sessionId}`)

    // Switch to target branch
    execFile('git', ['checkout', targetBranch],
      { cwd: workspacePath },
      (err1) => {
        if (err1) {
          reject(new Error(`Failed to checkout ${targetBranch}: ${err1.message}`))
          return
        }

        // Merge session branch
        execFile('git', ['merge', branchName, '--no-ff'],
          { cwd: workspacePath },
          (err2, stdout, stderr) => {
            if (err2) {
              reject(new Error(`Failed to merge: ${stderr || err2.message}`))
              return
            }

            // Delete worktree
            execFile('git', ['worktree', 'remove', worktreePath, '--force'],
              { cwd: workspacePath },
              (err3) => {
                if (err3) {
                  console.error('Failed to delete worktree after merge:', err3)
                }

                // Delete branch
                execFile('git', ['branch', '-d', branchName],
                  { cwd: workspacePath },
                  (err4) => {
                    if (err4) {
                      console.error('Failed to delete branch after merge:', err4)
                    }
                    resolve({ success: true })
                  }
                )
              }
            )
          }
        )
      }
    )
  })
})

// ── Git Actions ────────────────────────────────────────────────────────────────

ipcMain.handle('git:commit', async (_e, { cwd, message }) => {
  const { execFile } = require('child_process')

  return new Promise((resolve, reject) => {
    execFile('git', ['add', '-A'],
      { cwd },
      (err1) => {
        if (err1) {
          reject(new Error(`Failed to stage changes: ${err1.message}`))
          return
        }
        execFile('git', ['commit', '-m', message],
          { cwd, maxBuffer: 4 * 1024 * 1024 },
          (err2, stdout, stderr) => {
            if (err2) {
              reject(new Error(`Failed to commit: ${stderr || err2.message}`))
            } else {
              resolve({ success: true, output: stdout })
            }
          }
        )
      }
    )
  })
})

ipcMain.handle('git:push', async (_e, { cwd }) => {
  const { execFile } = require('child_process')

  return new Promise((resolve, reject) => {
    execFile('git', ['push'],
      { cwd, maxBuffer: 4 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err) {
          reject(new Error(`Push failed: ${stderr || err.message}`))
        } else {
          resolve({ success: true, output: stdout || stderr })
        }
      }
    )
  })
})

ipcMain.handle('git:pull', async (_e, { cwd }) => {
  const { execFile } = require('child_process')

  return new Promise((resolve, reject) => {
    execFile('git', ['pull'],
      { cwd, maxBuffer: 4 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err) {
          reject(new Error(`Pull failed: ${stderr || err.message}`))
        } else {
          resolve({ success: true, output: stdout || stderr })
        }
      }
    )
  })
})

ipcMain.handle('git:fetch', async (_e, { cwd }) => {
  const { execFile } = require('child_process')

  return new Promise((resolve, reject) => {
    execFile('git', ['fetch', '--all'],
      { cwd, maxBuffer: 4 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err) {
          reject(new Error(`Fetch failed: ${stderr || err.message}`))
        } else {
          resolve({ success: true, output: stdout || stderr })
        }
      }
    )
  })
})

ipcMain.handle('git:stash', async (_e, { cwd, action }) => {
  const { execFile } = require('child_process')

  return new Promise((resolve, reject) => {
    const args = action === 'pop' ? ['stash', 'pop'] :
                 action === 'list' ? ['stash', 'list'] :
                 ['stash', 'save', '--include-untracked']

    execFile('git', args,
      { cwd, maxBuffer: 4 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err && action !== 'list') {
          reject(new Error(`Stash failed: ${stderr || err.message}`))
        } else {
          resolve({ success: true, output: stdout || stderr })
        }
      }
    )
  })
})

ipcMain.handle('git:branch:current', async (_e, { cwd }) => {
  const { execFile } = require('child_process')

  return new Promise((resolve, reject) => {
    // Get current branch name
    execFile('git', ['rev-parse', '--abbrev-ref', 'HEAD'],
      { cwd },
      (err1, stdout1) => {
        if (err1) {
          reject(new Error(`Failed to get branch: ${err1.message}`))
          return
        }

        const branchName = stdout1.trim()

        // Get status (ahead/behind)
        execFile('git', ['status', '--porcelain', '--branch'],
          { cwd },
          (err2, stdout2) => {
            const statusLine = stdout2.split('\n')[0] || ''
            const aheadMatch = statusLine.match(/ahead (\d+)/)
            const behindMatch = statusLine.match(/behind (\d+)/)
            const ahead = aheadMatch ? parseInt(aheadMatch[1]) : 0
            const behind = behindMatch ? parseInt(behindMatch[1]) : 0

            // Check for uncommitted changes
            const hasUncommitted = stdout2.trim().split('\n').length > 1
            const hasUntracked = /^\?\?/m.test(stdout2)

            resolve({
              name: branchName,
              ahead,
              behind,
              hasUncommitted,
              hasUntracked
            })
          }
        )
      }
    )
  })
})

// ── PTY Change CWD ─────────────────────────────────────────────────────────────

ipcMain.handle('pty:change-cwd', async (_e, { sessionId, cwd }) => {
  const proc = ptySessions.get(sessionId)
  if (!proc) {
    throw new Error(`No PTY session found for ${sessionId}`)
  }

  // Send cd command to PTY
  const cdCommand = process.platform === 'win32'
    ? `cd /d "${cwd}"\r`
    : `cd "${cwd}"\n`

  proc.write(cdCommand)

  return { success: true }
})
