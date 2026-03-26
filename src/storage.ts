import type { Workspace, AppSettings } from './types'

const WS_KEY  = 'cm:workspaces'
const SET_KEY = 'cm:settings'

const DEFAULT_SETTINGS: AppSettings = {
  defaultModel:    'claude-sonnet-4-5',
  skipPermissions: false,
}

export function loadWorkspaces(): Workspace[] {
  try {
    const raw = localStorage.getItem(WS_KEY)
    return raw ? (JSON.parse(raw) as Workspace[]) : []
  } catch {
    return []
  }
}

export function saveWorkspaces(ws: Workspace[]): void {
  localStorage.setItem(WS_KEY, JSON.stringify(ws))
}

export function loadSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(SET_KEY)
    return raw ? { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<AppSettings>) } : DEFAULT_SETTINGS
  } catch {
    return DEFAULT_SETTINGS
  }
}

export function saveSettings(s: AppSettings): void {
  localStorage.setItem(SET_KEY, JSON.stringify(s))
}

const COLOR_PALETTE = ['#10B981', '#F59E0B', '#06B6D4', '#A855F7', '#EF4444', '#3B82F6']

export function nextWorkspaceColor(existingCount: number): string {
  return COLOR_PALETTE[existingCount % COLOR_PALETTE.length]
}
