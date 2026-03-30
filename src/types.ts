export type AppScreen = 'loading' | 'first-run-no-cli' | 'main' | 'settings'

export type SessionLayout = 'strip' | 'split' | 'drawer'

export interface Workspace {
  id: string
  name: string
  color: string
  path: string
}

export interface Session {
  id: string
  workspaceId: string
  name: string
  model: string
}

export interface AppSettings {
  defaultModel: string
  skipPermissions: boolean
  sessionLayout?: SessionLayout
}
