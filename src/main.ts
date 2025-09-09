import { app, BrowserWindow, ipcMain } from 'electron';
import path from 'node:path';
import * as fs from 'fs';
import * as https from 'https';
import started from 'electron-squirrel-startup';
import { AppStarter, SteamStarter, Game, Config } from './classes'

let mainWindow: BrowserWindow | null = null
let steamStarters: SteamStarter[] = []
let config: Config = {
  compatdataPath: '/home/oliverzein/.local/share/Steam/steamapps/compatdata/',
  steamApps: []
}

// Load config from file
function loadConfig(): void {
  try {
    const configPath = path.join(app.getPath('userData'), 'config.json')
    if (fs.existsSync(configPath)) {
      const data = fs.readFileSync(configPath, 'utf8')
      config = { ...config, ...JSON.parse(data) }
    }
  } catch (error) {
    console.error('Failed to load config:', error)
  }
}

// Save config to file
function saveConfig(): void {
  try {
    const configPath = path.join(app.getPath('userData'), 'config.json')
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2))
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

// Scan Steam games
async function fetchGames(): Promise<Game[]> {
  try {
    console.log('Using compatdata path:', config.compatdataPath)
    const entries = fs.readdirSync(config.compatdataPath, { withFileTypes: true })
    console.log('Found', entries.length, 'entries in compatdata')
    const steamIDs = entries
      .filter(entry => entry.isDirectory() && entry.name !== '0')
      .map(entry => parseInt(entry.name))
      .filter(id => !isNaN(id) && id > 0)
    console.log('Filtered steamIDs:', steamIDs)

    const existingSteamIDs = new Set(config.steamApps.map(app => app.steamID))

    const defaultUser = config.steamApps[0]?.user || 'default_user'
    const defaultPassword = config.steamApps[0]?.password || 'default_password'

    const newSteamIDs = steamIDs.filter(id => !existingSteamIDs.has(id))
    const details = await Promise.all(newSteamIDs.map(fetchAppDetails))
    details.forEach((detail, i) => {
      config.steamApps.push({
        name: detail.name,
        icon: detail.icon,
        user: defaultUser,
        password: defaultPassword,
        steamID: newSteamIDs[i]
      })
    })

    saveConfig()
    return config.steamApps
  } catch (error) {
    console.error('Failed to fetch games:', error)
    return config.steamApps
  }
}

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (started) {
  app.quit();
}

const createSettingsWindow = () => {
  const settingsWin = new BrowserWindow({
    width: 400,
    height: 300,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
    },
  })
  settingsWin.loadFile(path.join(process.cwd(), 'settings.html'))
}

const createWindow = () => {
  // Create the browser window.
  mainWindow = new BrowserWindow({
    width: 1600,
    height: 600,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  // and load the index.html of the app.
  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, '../index.html'));
  }

  // Open the DevTools.
  mainWindow.webContents.openDevTools();
};

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(async () => {
  loadConfig()
  const games = await fetchGames()
  steamStarters = games.map(game => new SteamStarter(game.user, game.password, game.steamID, 'steam'))

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
    const result = await steamStarters[index].execute()
    return result
  } catch (error) {
    return { success: false, error: (error as Error).message }
  }
})

ipcMain.handle('get-config', async () => {
  return config
})

ipcMain.handle('save-config', async (event, newConfig) => {
  config = { ...config, ...newConfig }
  saveConfig()
  const games = await fetchGames()
  steamStarters = games.map(game => new SteamStarter(game.user, game.password, game.steamID, 'steam'))
  if (mainWindow) {
    mainWindow.webContents.send('games-loaded', games)
  }
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
