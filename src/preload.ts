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
}

interface Config {
  compatdataPath: string
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
    }
  }
}
