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
import { app, BrowserWindow, ipcMain } from 'electron';
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
              hidden: false
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

const createWindow = () => {
  // Create the browser window.
  mainWindow = new BrowserWindow({
    width: 1600,
    height: 600,
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
    mainWindow.webContents.openDevTools();
  }
};

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(async () => {
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
    const result = await starter.execute()
    return result
  } catch (error) {
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

ipcMain.handle('save-game-config', async (event, index: number, user: string, password: string) => {
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
  // If a non-empty password is provided, store it securely in keytar
  if (password && password.length > 0) {
    try {
      let keytar: { setPassword: (service: string, account: string, password: string) => Promise<void> }
      try {
        keytar = (eval('require') as NodeRequire)('keytar')
      } catch {
        const altPath = path.join(process.resourcesPath, 'app.asar.unpacked', 'node_modules', 'keytar')
        keytar = (eval('require') as NodeRequire)(altPath)
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

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and import them here.
