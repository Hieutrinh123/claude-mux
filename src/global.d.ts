interface Window {
  api: {
    ptySpawn: (opts: { sessionId: string; cwd: string; model: string; skipPermissions?: boolean; cols?: number; rows?: number; sessionType?: string; filePath?: string }) => Promise<void>
    ptyWrite: (sessionId: string, data: string) => void
    ptyResize: (sessionId: string, cols: number, rows: number) => void
    ptyKill: (sessionId: string) => void
    onPtyData:  (sessionId: string, cb: (data: string) => void) => () => void
    onPtyExit:  (sessionId: string, cb: (code: number) => void) => () => void
    onPtyError: (sessionId: string, cb: (msg: string) => void) => () => void
    claudeCheck: () => Promise<string>
    openFolder:  () => Promise<string | null>
    openFile:    (defaultPath?: string) => Promise<string | null>
    gitStatus:   (cwd: string, file?: string, commitHash?: string) => Promise<{
      files:     { path: string; status: string }[]
      commits:   { hash: string; fullHash: string; parents: string[]; refs: string[]; message: string; date: string; isoDate: string; author: string }[]
      fileDiffs: Record<string, { patch: string; added: number; removed: number }>
    }>
    saveClipboardImage: (buffer: number[], ext: string) => Promise<string>
    readFile:  (filePath: string) => Promise<string>
    listFiles: (cwd: string) => Promise<{ name: string; path: string; ext: string }[]>

    // Git Worktree
    gitWorktreeCreate: (opts: { sessionId: string; workspaceId: string; workspacePath: string }) => Promise<{ worktreePath: string; branchName: string }>
    gitWorktreeDelete: (opts: { sessionId: string; workspacePath: string }) => Promise<{ success: boolean }>
    gitWorktreeMerge:  (opts: { sessionId: string; workspaceId: string; workspacePath: string; targetBranch: string }) => Promise<{ success: boolean }>

    // Git Actions
    gitCommit:        (cwd: string, message: string) => Promise<{ success: boolean; output: string }>
    gitPush:          (cwd: string) => Promise<{ success: boolean; output: string }>
    gitPull:          (cwd: string) => Promise<{ success: boolean; output: string }>
    gitFetch:         (cwd: string) => Promise<{ success: boolean; output: string }>
    gitStash:         (cwd: string, action: 'save' | 'pop' | 'list') => Promise<{ success: boolean; output: string }>
    gitBranchCurrent: (cwd: string) => Promise<{ name: string; ahead: number; behind: number; hasUncommitted: boolean; hasUntracked: boolean }>

    // PTY
    ptyChangeCwd: (sessionId: string, cwd: string) => Promise<{ success: boolean }>
  }
}
