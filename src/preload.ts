import { contextBridge, ipcRenderer } from 'electron'

interface ExecutionResult {
  success: boolean
  pid?: number
  error?: string
}

interface Game {
  name: string
  icon?: string
  user: string
  steamID: number
  hidden?: boolean
  processName?: string
  resolution?: string
  notes?: string
}

interface Config {
  // Unified to array to support multiple Proton compatdata directories
  compatdataPaths: string[]
  steamApps: Game[]
  startMinimized?: boolean
}

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('electronAPI', {
  // Start a Steam game
  startGame: (index: number): Promise<ExecutionResult> => 
    ipcRenderer.invoke('start-game', index),
  
  // Get current configuration
  getConfig: (): Promise<Config> => 
    ipcRenderer.invoke('get-config'),
  
  // Save configuration
  saveConfig: (config: Partial<Config>): Promise<void> => 
    ipcRenderer.invoke('save-config', config),
  
  // Open settings (placeholder for future implementation)
  openSettings: (): Promise<void> => 
    ipcRenderer.invoke('open-settings'),
  // Start Steam client only (no -applaunch) for a given game index
  startSteamOnly: (index: number): Promise<ExecutionResult> =>
    ipcRenderer.invoke('start-steam-only', index),
  
  // Listen for games loaded event
  onGamesLoaded: (callback: (games: Game[]) => void): void => {
    ipcRenderer.on('games-loaded', (event, games: Game[]) => callback(games))
  },

  // Open configure window for a game
  openConfigure: (steamID: number): Promise<void> => 
    ipcRenderer.invoke('open-configure', steamID),
  
  // Save game configuration (optionally include processName, resolution, and notes)
  saveGameConfig: (index: number, user: string, password: string, processName?: string, resolution?: string, notes?: string): Promise<void> => 
    ipcRenderer.invoke('save-game-config', index, user, password, processName, resolution, notes),

  // Securely fetch stored password for a game/user (on demand)
  getStoredPassword: (steamID: number, user: string): Promise<{ success: boolean; password?: string; error?: string }> =>
    ipcRenderer.invoke('get-stored-password', steamID, user),

  
  // Toggle hidden status of a game
  toggleHidden: (steamID: number): Promise<void> => 
    ipcRenderer.invoke('toggle-hidden', steamID),
  
  // Get all games including hidden ones
  getAllGames: (): Promise<Game[]> => 
    ipcRenderer.invoke('get-all-games'),
  // Refresh games from disk
  refreshGames: (): Promise<{ success: boolean; count: number }> =>
    ipcRenderer.invoke('refresh-games'),
  
  // Listen for config updated event
  onConfigUpdated: (callback: () => void): void => {
    ipcRenderer.on('config-updated', () => callback())
  },

  // Launching status events (per-game index)
  onLaunchingStarted: (callback: (index: number) => void): void => {
    ipcRenderer.on('launching-started', (_e, index: number) => callback(index))
  },
  onLaunchingStopped: (callback: (index: number) => void): void => {
    ipcRenderer.on('launching-stopped', (_e, index: number) => callback(index))
  },

  // Listen for configure game event
  onConfigureGame: (callback: (game: Game, index: number) => void): void => {
    ipcRenderer.on('configure-game', (event, game: Game, index: number) => callback(game, index))
  }
})

// Type declarations for the renderer process
declare global {
  interface Window {
    electronAPI: {
      startGame: (index: number) => Promise<ExecutionResult>
      getConfig: () => Promise<Config>
      saveConfig: (config: Partial<Config>) => Promise<void>
      openSettings: () => Promise<void>
      startSteamOnly: (index: number) => Promise<ExecutionResult>
      onGamesLoaded: (callback: (games: Game[]) => void) => void
      openConfigure: (steamID: number) => Promise<void>
      saveGameConfig: (index: number, user: string, password: string, processName?: string, resolution?: string, notes?: string) => Promise<void>
      getStoredPassword: (steamID: number, user: string) => Promise<{ success: boolean; password?: string; error?: string }>
      toggleHidden: (steamID: number) => Promise<void>
      getAllGames: () => Promise<Game[]>
      refreshGames: () => Promise<{ success: boolean; count: number }>
      onConfigUpdated: (callback: () => void) => void
      onLaunchingStarted: (callback: (index: number) => void) => void
      onLaunchingStopped: (callback: (index: number) => void) => void
      onConfigureGame: (callback: (game: Game, index: number) => void) => void
    }
  }
}
