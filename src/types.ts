export type AppScreen = 'loading' | 'first-run-no-cli' | 'main' | 'settings'

export type SessionLayout = 'single' | 'split' | 'hstack' | 'master' | 'quad' | 'three'

export interface Workspace {
  id: string
  name: string
  color: string
  path: string
}

export type Session = {
  id: string
  workspaceId: string
  name: string
  model: string
} & (
  | { type: 'claude' }
  | { type: 'file-viewer'; filePath: string }
)

export interface AppSettings {
  defaultModel: string
  skipPermissions: boolean
  sessionLayout?: SessionLayout
}
