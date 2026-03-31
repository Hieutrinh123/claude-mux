const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('api', {
  ptySpawn: (opts) => ipcRenderer.invoke('pty:spawn', opts),
  ptyWrite: (sessionId, data) => ipcRenderer.send('pty:write', { sessionId, data }),
  ptyResize: (sessionId, cols, rows) => ipcRenderer.send('pty:resize', { sessionId, cols, rows }),
  ptyKill: (sessionId) => ipcRenderer.send('pty:kill', sessionId),

  onPtyData: (sessionId, cb) => {
    const handler = (_e, data) => cb(data)
    ipcRenderer.on(`pty:data:${sessionId}`, handler)
    return () => ipcRenderer.off(`pty:data:${sessionId}`, handler)
  },
  onPtyExit: (sessionId, cb) => {
    const handler = (_e, code) => cb(code)
    ipcRenderer.on(`pty:exit:${sessionId}`, handler)
    return () => ipcRenderer.off(`pty:exit:${sessionId}`, handler)
  },
  onPtyError: (sessionId, cb) => {
    const handler = (_e, msg) => cb(msg)
    ipcRenderer.on(`pty:error:${sessionId}`, handler)
    return () => ipcRenderer.off(`pty:error:${sessionId}`, handler)
  },

  claudeCheck: () => ipcRenderer.invoke('claude:check'),
  openFolder:  () => ipcRenderer.invoke('dialog:open-folder'),
  openFile:    (defaultPath) => ipcRenderer.invoke('dialog:open-file', { defaultPath }),
  gitStatus:   (cwd, file, commitHash) => ipcRenderer.invoke('git:status', { cwd, file, commitHash }),
  saveClipboardImage: (buffer, ext) => ipcRenderer.invoke('clipboard:save-image', { buffer, ext }),
  readFile:  (filePath) => ipcRenderer.invoke('files:read', { filePath }),
  listFiles: (cwd) => ipcRenderer.invoke('files:list', { cwd }),

  // Git Worktree
  gitWorktreeCreate: (opts) => ipcRenderer.invoke('git:worktree:create', opts),
  gitWorktreeDelete: (opts) => ipcRenderer.invoke('git:worktree:delete', opts),
  gitWorktreeMerge:  (opts) => ipcRenderer.invoke('git:worktree:merge', opts),

  // Git Actions
  gitCommit:        (cwd, message) => ipcRenderer.invoke('git:commit', { cwd, message }),
  gitPush:          (cwd) => ipcRenderer.invoke('git:push', { cwd }),
  gitPull:          (cwd) => ipcRenderer.invoke('git:pull', { cwd }),
  gitFetch:         (cwd) => ipcRenderer.invoke('git:fetch', { cwd }),
  gitStash:         (cwd, action) => ipcRenderer.invoke('git:stash', { cwd, action }),
  gitBranchCurrent: (cwd) => ipcRenderer.invoke('git:branch:current', { cwd }),

  // PTY
  ptyChangeCwd: (sessionId, cwd) => ipcRenderer.invoke('pty:change-cwd', { sessionId, cwd }),
})
