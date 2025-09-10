// Ambient declarations for Vite-injected globals (Forge Vite plugin)
// These will be replaced at build time; in dev they are defined strings.
// @ts-ignore
declare const SETTINGS_WINDOW_VITE_DEV_SERVER_URL: string | undefined
// @ts-ignore
declare const SETTINGS_WINDOW_VITE_NAME: string
// @ts-ignore
declare const CONFIGURE_WINDOW_VITE_DEV_SERVER_URL: string | undefined
// @ts-ignore
declare const CONFIGURE_WINDOW_VITE_NAME: string
import { app, BrowserWindow, ipcMain, Menu, globalShortcut } from 'electron';
import { exec } from 'child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import * as fs from 'fs';
import * as https from 'https';
import * as os from 'os';
import started from 'electron-squirrel-startup';
import { AppStarter, SteamStarter, Game, Config } from './classes'

let mainWindow: BrowserWindow | null = null
let steamStarters: SteamStarter[] = []
let config: Config = {
  compatdataPaths: ['~/.local/share/Steam/steamapps/compatdata/'],
  steamApps: []
}

// Load config from file
function loadConfig(): void {
  try {
    const configPath = path.join(app.getPath('userData'), 'config.json')
    if (fs.existsSync(configPath)) {
      const data = fs.readFileSync(configPath, 'utf8')
      const parsed = JSON.parse(data)
      // Backward compatibility: convert old compatdataPath to compatdataPaths
      if (parsed.compatdataPath && !parsed.compatdataPaths) {
        parsed.compatdataPaths = [parsed.compatdataPath]
        delete parsed.compatdataPath
      }
      config = { ...config, ...parsed }
    }
  } catch (error) {
    console.error('Failed to load config:', error)
  }
}

// Save config to file (sanitize legacy password fields)
function saveConfig(): void {
  try {
    const configPath = path.join(app.getPath('userData'), 'config.json')
    const sanitized = {
      ...config,
      steamApps: config.steamApps.map(g => ({
        name: g.name,
        icon: g.icon,
        user: g.user,
        steamID: g.steamID,
        hidden: g.hidden ?? false,
        processName: g.processName,
      })),
    }
    fs.writeFileSync(configPath, JSON.stringify(sanitized, null, 2))
  } catch (error) {
    console.error('Failed to save config:', error)
  }
}

// Fetch game details from Steam API
async function fetchAppDetails(steamID: number): Promise<{ name: string; icon?: string }> {
  return new Promise((resolve, reject) => {
    const url = `https://store.steampowered.com/api/appdetails?appids=${steamID}`
    https.get(url, (res) => {
      let data = ''
      res.on('data', (chunk) => data += chunk)
      res.on('end', () => {
        try {
          const json = JSON.parse(data)
          if (json[steamID]?.success) {
            const name = json[steamID].data.name
            const icon = json[steamID].data.header_image
            resolve({ name, icon })
          } else {
            resolve({ name: `Game ${steamID}` })
          }
        } catch (e) {
          resolve({ name: `Game ${steamID}` })
        }
      })
    }).on('error', (err) => {
      resolve({ name: `Game ${steamID}` })
    })
  })
}

// Fetch games from all compatdata paths
async function fetchGames(): Promise<Game[]> {
  const games: Game[] = []
  const steamIDs = new Set<number>()

  for (const path of config.compatdataPaths) {
    try {
      const fullPath = path.replace('~', os.homedir())
      console.log(`Using compatdata path: ${fullPath}`)
      const entries = fs.readdirSync(fullPath)
      console.log(`Found ${entries.length} entries in compatdata`)

      const filteredEntries = entries.filter(entry => /^\d+$/.test(entry))
      console.log(`Filtered steamIDs: [ ${filteredEntries.join(', ')} ]`)

      for (const entry of filteredEntries) {
        const steamID = parseInt(entry)
        if (steamID > 0 && steamID !== 1493710 && !steamIDs.has(steamID)) {
          steamIDs.add(steamID)

          // Find existing game config or create default
          let gameConfig = config.steamApps.find(g => g.steamID === steamID)
          if (!gameConfig) {
            gameConfig = {
              name: `Game ${steamID}`,
              user: 'default_user',
              steamID: steamID,
              hidden: false,
              processName: undefined,
            }
            config.steamApps.push(gameConfig)
          }

          // Fetch latest game details
          const details = await fetchAppDetails(steamID)
          gameConfig.name = details.name
          gameConfig.icon = details.icon

          if (!gameConfig.hidden) {
            games.push(gameConfig)
          }
        }
      }
    } catch (error) {
      console.error(`Failed to read compatdata path ${path}:`, error)
    }
  }

  return games
}

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (started) {
  app.quit();
}

const createSettingsWindow = () => {
  const settingsWin = new BrowserWindow({
    width: 600,
    height: 600,
    icon: getAppIconPath(),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  })
  // Load via Vite renderer target
  // @ts-ignore
  if (SETTINGS_WINDOW_VITE_DEV_SERVER_URL) {
    // @ts-ignore
    settingsWin.loadURL(SETTINGS_WINDOW_VITE_DEV_SERVER_URL)
  } else {
    // @ts-ignore
    const name = SETTINGS_WINDOW_VITE_NAME
    settingsWin.loadFile(path.join(__dirname, `../renderer/${name}/index.html`))
  }
}

const createConfigureWindow = (index: number) => {
  const configureWin = new BrowserWindow({
    width: 600,
    height: 300,
    icon: getAppIconPath(),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  })
  // @ts-ignore
  if (CONFIGURE_WINDOW_VITE_DEV_SERVER_URL) {
    // @ts-ignore
    configureWin.loadURL(CONFIGURE_WINDOW_VITE_DEV_SERVER_URL)
  } else {
    // @ts-ignore
    const name = CONFIGURE_WINDOW_VITE_NAME
    configureWin.loadFile(path.join(__dirname, `../renderer/${name}/index.html`))
  }
  configureWin.show()
  configureWin.focus()
  configureWin.webContents.on('did-finish-load', () => {
    const game = config.steamApps[index]
    configureWin.webContents.send('configure-game', game, index)
  })
}

// Resolve an asset path both in dev and in packaged builds
function resolveAsset(...segments: string[]): string {
  const devPath = path.join(__dirname, '..', '..', 'assets', ...segments)
  const prodPath = path.join(process.resourcesPath, 'assets', ...segments)
  return fs.existsSync(devPath) ? devPath : prodPath
}

function getAppIconPath(): string | undefined {
  // Prefer PNG (SVG is not supported widely for window icons)
  const pngPath = resolveAsset('app-icon.png')
  if (fs.existsSync(pngPath)) return pngPath
  // Fallback to any png in assets dir
  const altPng = resolveAsset('icon.png')
  if (fs.existsSync(altPng)) return altPng
  return undefined
}

const createWindow = () => {
  // Create the browser window.
  mainWindow = new BrowserWindow({
    width: 1416,
    height: 600,
    icon: getAppIconPath(),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });

  // and load the index.html of the app.
  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    // Use the renderer output folder provided by Forge Vite plugin
    // MAIN_WINDOW_VITE_NAME is injected at build time
    mainWindow.loadFile(path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`));
  }

  // Open DevTools only in development
  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    //mainWindow.webContents.openDevTools();
  }
};

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(async () => {
  // Remove default application menu
  Menu.setApplicationMenu(null)
  // Register global shortcuts to toggle DevTools
  const registerDevtoolsShortcuts = () => {
    const toggleFocusedDevTools = () => {
      const win = BrowserWindow.getFocusedWindow()
      if (win) {
        if (win.webContents.isDevToolsOpened()) win.webContents.closeDevTools()
        else win.webContents.openDevTools({ mode: 'detach' })
      }
    }
    globalShortcut.register('CommandOrControl+Shift+I', toggleFocusedDevTools)
    globalShortcut.register('F12', toggleFocusedDevTools)
  }
  registerDevtoolsShortcuts()
  loadConfig()
  const games = await fetchGames()
  steamStarters = games.map(game => new SteamStarter(game.user, game.steamID, 'steam'))

  createWindow()

  if (mainWindow) {
    mainWindow.webContents.once('did-finish-load', () => {
      mainWindow.webContents.send('games-loaded', games)
    })
  }
})

// IPC handlers
ipcMain.handle('start-game', async (event, index: number) => {
  try {
    if (typeof index !== 'number' || !Number.isInteger(index)) {
      return { success: false, error: 'Invalid index type' }
    }
    if (index < 0 || index >= steamStarters.length) {
      return { success: false, error: 'Index out of range' }
    }
    const starter = steamStarters[index]
    if (!starter) {
      return { success: false, error: 'Game starter not available' }
    }
    // Notify renderer: launching started
    BrowserWindow.getAllWindows().forEach(win => win.webContents.send('launching-started', index))
    const result = await starter.execute()
    // Start process watcher; fall back to Steam client if no per-game processName configured
    const game = config.steamApps[index]
    const configured = game?.processName?.trim()
    const procName = configured && configured.length > 0
      ? configured
      : (process.platform === 'win32' ? 'steam.exe' : 'steam')
    if (result.success) {
      const start = Date.now()
      const timeoutMs = 60000 // 60s timeout
      const interval = setInterval(() => {
        if (Date.now() - start > timeoutMs) {
          clearInterval(interval)
          BrowserWindow.getAllWindows().forEach(win => win.webContents.send('launching-stopped', index))
          return
        }
        // Use pgrep -f to match full command line
        exec(`pgrep -f ${JSON.stringify(procName)}`, (err, stdout) => {
          if (!err && stdout && stdout.trim().length > 0) {
            clearInterval(interval)
            BrowserWindow.getAllWindows().forEach(win => win.webContents.send('launching-stopped', index))
          }
        })
      }, 1500)
    } else {
      // Stop immediately if failed
      BrowserWindow.getAllWindows().forEach(win => win.webContents.send('launching-stopped', index))
    }
    return result
  } catch (error) {
    BrowserWindow.getAllWindows().forEach(win => win.webContents.send('launching-stopped', index))
    return { success: false, error: (error as Error).message }
  }
})

ipcMain.handle('get-config', async () => {
  return config
})

ipcMain.handle('save-config', async (event, newConfig) => {
  // Basic validation for compatdataPaths if present
  if (newConfig && Array.isArray(newConfig.compatdataPaths)) {
    const valid = newConfig.compatdataPaths.every((p: unknown) => typeof p === 'string' && p.length > 0)
    if (!valid) {
      return { success: false, error: 'compatdataPaths must be a non-empty array of strings' }
    }
  }
  config = { ...config, ...newConfig }
  saveConfig()
  const games = await fetchGames()
  steamStarters = games.map(game => new SteamStarter(game.user, game.steamID, 'steam'))
  if (mainWindow) {
    mainWindow.webContents.send('games-loaded', games)
  }
  return { success: true }
})

ipcMain.handle('open-configure', async (event, steamID: number) => {
  if (typeof steamID !== 'number' || !Number.isInteger(steamID) || steamID <= 0) {
    return { success: false, error: 'Invalid steamID' }
  }
  const index = config.steamApps.findIndex(g => g.steamID === steamID)
  if (index === -1) {
    return { success: false, error: 'Game not found' }
  }
  createConfigureWindow(index)
  return { success: true }
})

ipcMain.handle('save-game-config', async (event, index: number, user: string, password: string, processName?: string) => {
  if (typeof index !== 'number' || !Number.isInteger(index)) {
    return { success: false, error: 'Invalid index type' }
  }
  if (index < 0 || index >= config.steamApps.length) {
    return { success: false, error: 'Index out of range' }
  }
  if (typeof user !== 'string' || typeof password !== 'string') {
    return { success: false, error: 'Invalid credentials type' }
  }
  const steamID = config.steamApps[index].steamID
  // Update user in config
  config.steamApps[index].user = user
  // Update processName if provided (allow empty -> undefined)
  if (typeof processName === 'string') {
    const pn = processName.trim()
    config.steamApps[index].processName = pn.length ? pn : undefined
  }
  // If a non-empty password is provided, store it securely in keytar
  if (password && password.length > 0) {
    try {
      const req = createRequire(__filename)
      let keytar: { setPassword: (service: string, account: string, password: string) => Promise<void> }
      try {
        keytar = req('keytar')
      } catch {
        try {
          const altPath = path.join(process.resourcesPath, 'app.asar.unpacked', 'node_modules', 'keytar')
          keytar = req(altPath)
        } catch {
          try {
            const altResources = path.join(process.resourcesPath, 'keytar')
            keytar = req(altResources)
          } catch {
            const altNodeModules = path.join(process.resourcesPath, 'node_modules', 'keytar')
            keytar = req(altNodeModules)
          }
        }
      }
      await keytar.setPassword('steamlauncher', `${user}:${steamID}`, password)
    } catch (e) {
      return { success: false, error: 'Failed to store password in keychain' }
    }
  }
  saveConfig()
  // Notify all windows of config update
  BrowserWindow.getAllWindows().forEach(win => {
    win.webContents.send('config-updated')
  })
  return { success: true }
})

// Retrieve stored password for a given (user, steamID)
ipcMain.handle('get-stored-password', async (event, steamID: number, user: string) => {
  try {
    if (typeof steamID !== 'number' || !Number.isInteger(steamID) || steamID <= 0) {
      return { success: false, error: 'Invalid steamID' }
    }
    if (typeof user !== 'string' || user.length === 0) {
      return { success: false, error: 'Invalid user' }
    }
    const req = createRequire(__filename)
    let keytar: { getPassword: (service: string, account: string) => Promise<string | null> }
    try {
      keytar = req('keytar')
    } catch {
      try {
        const altUnpacked = path.join(process.resourcesPath, 'app.asar.unpacked', 'node_modules', 'keytar')
        keytar = req(altUnpacked)
      } catch {
        try {
          const altResources = path.join(process.resourcesPath, 'keytar')
          keytar = req(altResources)
        } catch {
          const altNodeModules = path.join(process.resourcesPath, 'node_modules', 'keytar')
          keytar = req(altNodeModules)
        }
      }
    }
    const account = `${user}:${steamID}`
    const password = await keytar.getPassword('steamlauncher', account)
    if (!password) return { success: false, error: 'No password set' }
    return { success: true, password }
  } catch (e) {
    return { success: false, error: 'Failed to retrieve password' }
  }
})

ipcMain.handle('toggle-hidden', async (event, steamID: number) => {
  if (typeof steamID !== 'number' || !Number.isInteger(steamID) || steamID <= 0) {
    return { success: false, error: 'Invalid steamID' }
  }
  const index = config.steamApps.findIndex(g => g.steamID === steamID)
  if (index === -1) {
    return { success: false, error: 'Game not found' }
  }
  const game = config.steamApps[index]
  game.hidden = !game.hidden
  saveConfig()
  // Reload games to update the list
  const updatedGames = await fetchGames()
  mainWindow?.webContents.send('games-loaded', updatedGames)
  // Notify all windows of config update
  BrowserWindow.getAllWindows().forEach(win => {
    win.webContents.send('config-updated')
  })
  return { success: true }
})

// Get all games including hidden ones
ipcMain.handle('get-all-games', () => {
  return config.steamApps
})

ipcMain.handle('open-settings', async () => {
  createSettingsWindow()
})

// Start Steam client only (no -applaunch) for a given game index
ipcMain.handle('start-steam-only', async (_event, index: number) => {
  try {
    if (typeof index !== 'number' || !Number.isInteger(index)) {
      return { success: false, error: 'Invalid index type' }
    }
    if (index < 0 || index >= steamStarters.length) {
      return { success: false, error: 'Index out of range' }
    }
    const starter = steamStarters[index]
    if (!starter) {
      return { success: false, error: 'Game starter not available' }
    }
    // Notify renderer: launching started
    BrowserWindow.getAllWindows().forEach(win => win.webContents.send('launching-started', index))
    const result = await starter.executeSteamOnly()
    // For Steam-only launch, watch the Steam client process rather than the game
    const procName = process.platform === 'win32' ? 'steam.exe' : 'steam'
    if (result.success) {
      const start = Date.now()
      const timeoutMs = 60000 // 60s timeout
      const interval = setInterval(() => {
        if (Date.now() - start > timeoutMs) {
          clearInterval(interval)
          BrowserWindow.getAllWindows().forEach(win => win.webContents.send('launching-stopped', index))
          return
        }
        exec(`pgrep -f ${JSON.stringify(procName)}`, (err, stdout) => {
          if (!err && stdout && stdout.trim().length > 0) {
            clearInterval(interval)
            BrowserWindow.getAllWindows().forEach(win => win.webContents.send('launching-stopped', index))
          }
        })
      }, 1500)
    } else {
      BrowserWindow.getAllWindows().forEach(win => win.webContents.send('launching-stopped', index))
    }
    return result
  } catch (e) {
    BrowserWindow.getAllWindows().forEach(win => win.webContents.send('launching-stopped', index))
    return { success: false, error: (e as Error).message }
  }
})

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  // On OS X it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

// Unregister all shortcuts on quit
app.on('will-quit', () => {
  globalShortcut.unregisterAll()
})

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and import them here.
