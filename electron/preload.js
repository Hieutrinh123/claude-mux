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
  gitStatus:   (cwd, file, commitHash) => ipcRenderer.invoke('git:status', { cwd, file, commitHash }),
  saveClipboardImage: (buffer, ext) => ipcRenderer.invoke('clipboard:save-image', { buffer, ext }),
})
