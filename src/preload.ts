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
  password: string
  steamID: number
  hidden?: boolean
}

interface Config {
  // Unified to array to support multiple Proton compatdata directories
  compatdataPaths: string[]
  steamApps: Game[]
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
  
  // Listen for games loaded event
  onGamesLoaded: (callback: (games: Game[]) => void): void => {
    ipcRenderer.on('games-loaded', (event, games: Game[]) => callback(games))
  },

  // Open configure window for a game
  openConfigure: (steamID: number): Promise<void> => 
    ipcRenderer.invoke('open-configure', steamID),
  
  // Save game configuration
  saveGameConfig: (index: number, user: string, password: string): Promise<void> => 
    ipcRenderer.invoke('save-game-config', index, user, password),
  
  // Toggle hidden status of a game
  toggleHidden: (steamID: number): Promise<void> => 
    ipcRenderer.invoke('toggle-hidden', steamID),
  
  // Get all games including hidden ones
  getAllGames: (): Promise<Game[]> => 
    ipcRenderer.invoke('get-all-games'),
  
  // Listen for config updated event
  onConfigUpdated: (callback: () => void): void => {
    ipcRenderer.on('config-updated', () => callback())
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
      onGamesLoaded: (callback: (games: Game[]) => void) => void
      openConfigure: (steamID: number) => Promise<void>
      saveGameConfig: (index: number, user: string, password: string) => Promise<void>
      toggleHidden: (steamID: number) => Promise<void>
      getAllGames: () => Promise<Game[]>
      onConfigUpdated: (callback: () => void) => void
      onConfigureGame: (callback: (game: Game, index: number) => void) => void
    }
  }
}
