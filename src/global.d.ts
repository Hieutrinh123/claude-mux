interface Window {
  api: {
    ptySpawn: (opts: { sessionId: string; cwd: string; model: string; skipPermissions?: boolean }) => Promise<void>
    ptyWrite: (sessionId: string, data: string) => void
    ptyResize: (sessionId: string, cols: number, rows: number) => void
    ptyKill: (sessionId: string) => void
    onPtyData:  (sessionId: string, cb: (data: string) => void) => () => void
    onPtyExit:  (sessionId: string, cb: (code: number) => void) => () => void
    onPtyError: (sessionId: string, cb: (msg: string) => void) => () => void
    claudeCheck: () => Promise<string>
    openFolder:  () => Promise<string | null>
  }
}
