// In dev, wait for the Vite dev server to respond with a non-504 before loading the URL
function waitForDevServer(urlStr: string, overallTimeoutMs = 10000, retryIntervalMs = 200): Promise<void> {
  return new Promise((resolve, reject) => {
    const start = Date.now()
    const attempt = () => {
      try {
        const u = new URL(urlStr)
        const getter = u.protocol === 'https:' ? https.get : http.get
        const req = getter(urlStr, (res) => {
          // Accept any successful-ish code below 500; specifically avoid 5xx like 504
          if (res.statusCode && res.statusCode < 500) {
            res.resume() // drain
            return resolve()
          }
          res.resume()
          if (Date.now() - start > overallTimeoutMs) return reject(new Error(`Dev server not ready: ${res.statusCode}`))
          setTimeout(attempt, retryIntervalMs)
        })
        req.on('error', () => {
          if (Date.now() - start > overallTimeoutMs) return reject(new Error('Dev server not reachable'))
          setTimeout(attempt, retryIntervalMs)
        })
      } catch {
        if (Date.now() - start > overallTimeoutMs) return reject(new Error('Dev server URL invalid'))
        setTimeout(attempt, retryIntervalMs)
      }
    }
    attempt()
  })
}
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
import { app, BrowserWindow, ipcMain, Menu, globalShortcut, Tray, nativeImage } from 'electron';
import type { Event as ElectronEvent } from 'electron'
import { exec } from 'child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import * as fs from 'fs';
import * as https from 'https';
import * as http from 'http';
import * as os from 'os';
import started from 'electron-squirrel-startup';
import { AppStarter, SteamStarter, Game, Config } from './classes'

// Reduce Chromium/Electron log verbosity (set before 'ready')
// log-level 3 = warnings and above; v=0 disables extra verbose logs
app.commandLine.appendSwitch('log-level', '3')
app.commandLine.appendSwitch('v', '0')

let mainWindow: BrowserWindow | null = null
let steamStarters: SteamStarter[] = []
let config: Config = {
  compatdataPaths: ['~/.local/share/Steam/steamapps/compatdata/'],
  steamApps: [],
  startMinimized: false,
}
let tray: Tray | null = null
let isQuitting = false

// Verbose logging toggle (set SL_VERBOSE=1 to enable)
const VERBOSE = !!process.env.SL_VERBOSE
const vlog = (...args: any[]) => { if (VERBOSE) console.log('[verbose]', ...args) }

const compareByOrder = (a: Game, b: Game): number => {
  const ao = typeof a.order === 'number' ? a.order : Number.MAX_SAFE_INTEGER
  const bo = typeof b.order === 'number' ? b.order : Number.MAX_SAFE_INTEGER
  if (ao !== bo) return ao - bo
  return a.name.localeCompare(b.name)
}

const getNextOrderValue = (): number => {
  let max = -1
  for (const game of config.steamApps) {
    if (typeof game.order === 'number' && game.order > max) {
      max = game.order
    }
  }
  return max + 1
}

const reindexGameOrders = (): void => {
  const sorted = [...config.steamApps].sort(compareByOrder)
  sorted.forEach((game, index) => {
    game.order = index
  })
}

const getVisibleGamesSorted = (): Game[] => {
  return config.steamApps.filter(game => !game.hidden).sort(compareByOrder)
}

// Run a shell command and resolve when done
function run(cmd: string): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    exec(cmd, (error, stdout, stderr) => {
      resolve({ code: error ? (error as any).code ?? 1 : 0, stdout: stdout ?? '', stderr: stderr ?? '' })
    })
  })
}

// Build a robust pgrep command that searches the full command line (works with Wine/Proton)
function buildPgrepCmd(raw: string): string {
  const name = path.basename(raw)
  const escaped = name.replace(/'/g, "'\\''")
  // -f: search full cmdline, -i: case-insensitive (handles wine path case)
  return `pgrep -fi '${escaped}'`
}

// Map the renderer-visible index (filtered list) to the true config entry using steamID
function getGameForVisibleIndex(index: number): Game | undefined {
  const starter = steamStarters[index]
  if (!starter) return undefined
  return config.steamApps.find(g => g.steamID === starter.steamID)
}

// Try to read the running Steam login from the steam process command line
async function getRunningSteamLogin(): Promise<string | null> {
  return new Promise((resolve) => {
    // -x exact name, -a print command line
    exec("pgrep -x -a steam", (err, stdout) => {
      if (err || !stdout) return resolve(null)
      const lines = stdout.split('\n').filter(Boolean)
      for (const line of lines) {
        // Example: "4170 /path/to/steam -srt-logger-opened -login user pass"
        const after = line.split(' -login ')[1]
        if (after) {
          const parts = after.trim().split(/\s+/)
          if (parts.length > 0) {
            return resolve(parts[0])
          }
        }
      }
      resolve(null)
    })
  })
}

// If Steam is running with a different login than desired, request shutdown and wait for exit
async function ensureSteamUserOrShutdown(desiredUser: string): Promise<void> {
  try {
    const runningUser = await getRunningSteamLogin()
    if (!runningUser) return // no steam or cannot detect; proceed
    if (runningUser === desiredUser) return // already correct account
    // Different account: request shutdown and wait until gone
    exec('steam -shutdown', () => { /* noop */ })
    const start = Date.now()
    const timeoutMs = 30000
    const waitTick = () => {
      exec("pgrep -x steam", (err, stdout) => {
        const stillRunning = !err && !!(stdout && stdout.trim().length > 0)
        if (!stillRunning) return
        if (Date.now() - start > timeoutMs) return
        setTimeout(waitTick, 500)
      })
    }
    await new Promise<void>((resolve) => {
      const loop = () => {
        exec("pgrep -x steam", (err, stdout) => {
          const stillRunning = !err && !!(stdout && stdout.trim().length > 0)
          if (!stillRunning) return resolve()
          if (Date.now() - start > timeoutMs) return resolve()
          setTimeout(loop, 500)
        })
      }
      loop()
    })
  } catch {
    // Ignore failures; proceed to launch
  }
}

// If the game has a resolution configured, apply it using kscreen-doctor
async function applyResolutionIfConfigured(index: number): Promise<void> {
  try {
    const game = getGameForVisibleIndex(index)
    const res = game?.resolution?.trim()
    if (!res) return
    const { code, stderr } = await run(`kscreen-doctor ${res}`)
    if (code !== 0) {
      // silently ignore non-zero exit
    }
  } catch (e) {
    // silently ignore resolution errors
  }
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
      reindexGameOrders()
      saveConfig()
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
        resolution: g.resolution,
        notes: g.notes,
        order: typeof g.order === 'number' ? g.order : undefined,
      })),
    }
    fs.writeFileSync(configPath, JSON.stringify(sanitized, null, 2))
  } catch (error) {
    if (VERBOSE) console.error('Failed to save config:', error)
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
          if (VERBOSE) console.error(`Failed API for steamID ${steamID}:`, e)
          resolve({ name: `Game ${steamID}` })
        }
      })
    }).on('error', (err) => {
      if (VERBOSE) console.error(`Failed API for steamID ${steamID}:`, err)
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
      if (VERBOSE) vlog(`Using compatdata path: ${fullPath}`)
      const entries = fs.readdirSync(fullPath)
      if (VERBOSE) vlog(`Found ${entries.length} entries in compatdata`)

      const filteredEntries = entries.filter(entry => /^\d+$/.test(entry))
      if (VERBOSE) vlog(`Filtered steamIDs: [ ${filteredEntries.join(', ')} ]`)

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
              order: getNextOrderValue(),
            }
            config.steamApps.push(gameConfig)
          }
          if (typeof gameConfig.order !== 'number') {
            gameConfig.order = getNextOrderValue()
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
      if (VERBOSE) console.error(`Failed to read compatdata path ${path}:`, error)
    }
  }

  reindexGameOrders()
  games.sort(compareByOrder)
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
    width: 1600,
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

  // Intercept close to minimize to tray instead of quitting (disabled in dev to avoid leftover instances)
  mainWindow.on('close', (e: ElectronEvent) => {
    if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
      // In dev, let the window close normally so the app exits cleanly
      return
    }
    if (!isQuitting) {
      e.preventDefault()
      mainWindow?.hide()
      mainWindow?.setSkipTaskbar(true)
    }
  })

  // Intercept minimize to hide to tray (disabled in dev)
  mainWindow.on('minimize', () => {
    if (MAIN_WINDOW_VITE_DEV_SERVER_URL) return
    if (!isQuitting) {
      mainWindow?.hide()
      mainWindow?.setSkipTaskbar(true)
    }
  })

  // Ensure it reappears in taskbar when shown
  mainWindow.on('show', () => {
    mainWindow?.setSkipTaskbar(false)
  })

  // and load the index.html of the app.
  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    // Clear HTTP and storage caches to avoid stale optimized deps between restarts
    try {
      const ses = mainWindow.webContents.session
      ses.clearCache()
      ses.clearStorageData({
        storages: ['serviceworkers', 'cachestorage']
      })
    } catch {}
    // Add a cache-busting query parameter to avoid reusing stale bundles
    const devUrl = MAIN_WINDOW_VITE_DEV_SERVER_URL.includes('?')
      ? `${MAIN_WINDOW_VITE_DEV_SERVER_URL}&t=${Date.now()}`
      : `${MAIN_WINDOW_VITE_DEV_SERVER_URL}?t=${Date.now()}`
    // Preflight: wait for dev server readiness to avoid intermittent 504
    waitForDevServer(MAIN_WINDOW_VITE_DEV_SERVER_URL).then(() => {
      if (!mainWindow.isDestroyed()) mainWindow.loadURL(devUrl)
    }).catch(() => {
      // Even if preflight fails, attempt to load; the other safeguards may recover
      if (!mainWindow.isDestroyed()) mainWindow.loadURL(devUrl)
    })
    // Dev resilience: sometimes Vite serves 504 "Outdated Optimize Dep" which leaves the page blank.
    // Listen for that console message and force a reload (throttled) to recover automatically.
    let lastDevReload = 0
    mainWindow.webContents.on('console-message', (_event, _level, message) => {
      if (typeof message === 'string' && message.includes('Outdated Optimize Dep')) {
        const now = Date.now()
        if (now - lastDevReload > 2000) {
          lastDevReload = now
          mainWindow.webContents.reloadIgnoringCache()
        }
      }
    })
    // Additionally, if the top-level load fails, retry once shortly after.
    let retriedFailLoad = false
    mainWindow.webContents.on('did-fail-load', () => {
      if (!retriedFailLoad) {
        retriedFailLoad = true
        setTimeout(() => {
          if (!mainWindow.isDestroyed()) {
            mainWindow.webContents.reloadIgnoringCache()
          }
        }, 500)
      }
    })
    // Dev watchdog: if the page remains effectively blank shortly after load, reload once.
    let watchdogTriggered = false
    mainWindow.webContents.on('did-finish-load', () => {
      setTimeout(async () => {
        if (watchdogTriggered || mainWindow.isDestroyed()) return
        try {
          const contentLen: number = await mainWindow!.webContents.executeJavaScript(
            'document.body && document.body.innerText ? document.body.innerText.trim().length : 0',
            true
          )
          if (contentLen < 5) {
            watchdogTriggered = true
            mainWindow!.webContents.reloadIgnoringCache()
          }
        } catch { /* ignore */ }
      }, 1200)
    })
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

  // Create system tray
  const iconPath = getAppIconPath()
  if (iconPath) {
    const trayImage = nativeImage.createFromPath(iconPath)
    tray = new Tray(trayImage)
    tray.setToolTip('Steam Game Launcher')
    const contextMenu = Menu.buildFromTemplate([
      {
        label: 'Show',
        click: () => {
          if (!mainWindow || mainWindow.isDestroyed()) {
            createWindow()
          }
          mainWindow?.show()
          mainWindow?.setSkipTaskbar(false)
          mainWindow?.focus()
        },
      },
      { type: 'separator' },
      {
        label: 'Quit',
        click: () => {
          isQuitting = true
          app.quit()
        },
      },
    ])
    tray.setContextMenu(contextMenu)
    tray.on('click', () => {
      if (!mainWindow || mainWindow.isDestroyed()) {
        createWindow()
      }
      if (mainWindow?.isVisible()) {
        mainWindow.focus()
      } else {
        mainWindow?.show()
        mainWindow?.setSkipTaskbar(false)
      }
    })
  }
  loadConfig()
  const games = await fetchGames()
  steamStarters = games.map(game => new SteamStarter(game.user, game.steamID, 'steam'))

  createWindow()

  if (mainWindow) {
    // If user prefers start minimized, hide to tray immediately
    if (config.startMinimized) {
      mainWindow.hide()
      mainWindow.setSkipTaskbar(true)
    }
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
    // Ensure Steam account matches configured game user; shutdown if different
    const gameForUser = getGameForVisibleIndex(index)
    if (gameForUser?.user) {
      await ensureSteamUserOrShutdown(gameForUser.user)
    }
    // Apply optional screen resolution before launching
    await applyResolutionIfConfigured(index)
    // Notify renderer after prep work has started
    const launchEventPayload = { index, steamID: starter.steamID }
    BrowserWindow.getAllWindows().forEach(win => win.webContents.send('launching-started', launchEventPayload))
    const result = await starter.execute()
    // Start process watcher; fall back to Steam client if no per-game processName configured
    const game = getGameForVisibleIndex(index)
    const configured = game?.processName?.trim()
    const fallback = (process.platform === 'win32' ? 'steam.exe' : 'steam')
    const procName = configured && configured.length > 0 ? configured : fallback
    if (result.success) {
      const start = Date.now()
      const timeoutMs = 120000 // 120s timeout
      const initialDelayMs = 4000
      const cmd = buildPgrepCmd(procName)
      let attempt = 0
      const tick = () => {
        attempt++
        if (Date.now() - start > timeoutMs) {
          BrowserWindow.getAllWindows().forEach(win => win.webContents.send('launching-stopped', launchEventPayload))
          return
        }
        exec(cmd, (err, stdout, stderr) => {
          const out = (stdout || '').trim()
          if (out.length > 0) {
            BrowserWindow.getAllWindows().forEach(win => win.webContents.send('launching-stopped', launchEventPayload))
          } else {
            setTimeout(tick, 1500)
          }
        })
      }
      // Start after a short delay to give the process time to spawn
      setTimeout(tick, initialDelayMs)
    } else {
      // Stop immediately if failed
      BrowserWindow.getAllWindows().forEach(win => win.webContents.send('launching-stopped', launchEventPayload))
    }
    return result
  } catch (error) {
    const launchEventPayload = { index, steamID: steamStarters[index]?.steamID }
    BrowserWindow.getAllWindows().forEach(win => win.webContents.send('launching-stopped', launchEventPayload))
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
  // Validate startMinimized if provided
  if (newConfig && 'startMinimized' in newConfig && typeof newConfig.startMinimized !== 'boolean') {
    return { success: false, error: 'startMinimized must be a boolean' }
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

ipcMain.handle('save-game-config', async (event, index: number, user: string, password: string, processName?: string, resolution?: string, notes?: string) => {
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
  // Update desired resolution string (allow empty -> undefined)
  if (typeof resolution === 'string') {
    const rs = resolution.trim()
    config.steamApps[index].resolution = rs.length ? rs : undefined
  }
  // Update notes (allow empty -> undefined)
  if (typeof notes === 'string') {
    const ns = notes.trim()
    config.steamApps[index].notes = ns.length ? ns : undefined
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

ipcMain.handle('save-game-order', async (_event, steamIDs: number[]) => {
  if (!Array.isArray(steamIDs)) {
    throw new Error('Order payload must be an array')
  }
  const seen = new Set<number>()
  for (const id of steamIDs) {
    if (typeof id !== 'number' || !Number.isInteger(id) || id <= 0) {
      throw new Error('Order payload must contain positive integer steamIDs')
    }
    if (seen.has(id)) {
      throw new Error('Duplicate steamIDs provided in order payload')
    }
    const exists = config.steamApps.some(game => game.steamID === id)
    if (!exists) {
      throw new Error(`Unknown steamID ${id} in order payload`)
    }
    seen.add(id)
  }

  let order = 0
  for (const id of steamIDs) {
    const game = config.steamApps.find(g => g.steamID === id)
    if (game) {
      game.order = order++
    }
  }
  const remaining = config.steamApps
    .filter(game => !seen.has(game.steamID))
    .sort(compareByOrder)
  for (const game of remaining) {
    game.order = order++
  }

  saveConfig()
  const visible = getVisibleGamesSorted()
  steamStarters = visible.map(game => new SteamStarter(game.user, game.steamID, 'steam'))
  BrowserWindow.getAllWindows().forEach(win => {
    win.webContents.send('games-loaded', visible)
    win.webContents.send('config-updated')
  })
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
  steamStarters = updatedGames.map(game => new SteamStarter(game.user, game.steamID, 'steam'))
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
    // Apply optional screen resolution as well for Steam-only (if set)
    await applyResolutionIfConfigured(index)
    const result = await starter.executeSteamOnly()
    // For Steam-only launch, watch the Steam client process rather than the game
    const procName = process.platform === 'win32' ? 'steam.exe' : 'steam'
    if (result.success) {
      const start = Date.now()
      const timeoutMs = 120000 // 120s timeout
      const initialDelayMs = 4000
      const cmd = buildPgrepCmd(procName)
      let attempt = 0
      const tick = () => {
        attempt++
        if (Date.now() - start > timeoutMs) {
          BrowserWindow.getAllWindows().forEach(win => win.webContents.send('launching-stopped', index))
          return
        }
        exec(cmd, (err, stdout, stderr) => {
          const out = (stdout || '').trim()
          if (out.length > 0) {
            BrowserWindow.getAllWindows().forEach(win => win.webContents.send('launching-stopped', index))
          } else {
            setTimeout(tick, 1500)
          }
        })
      }
      setTimeout(tick, initialDelayMs)
    } else {
      BrowserWindow.getAllWindows().forEach(win => win.webContents.send('launching-stopped', index))
    }
    return result
  } catch (e) {
    BrowserWindow.getAllWindows().forEach(win => win.webContents.send('launching-stopped', index))
    return { success: false, error: (e as Error).message }
  }
})

// Manually refresh game library
ipcMain.handle('refresh-games', async () => {
  const games = await fetchGames()
  steamStarters = games.map(game => new SteamStarter(game.user, game.steamID, 'steam'))
  BrowserWindow.getAllWindows().forEach(win => win.webContents.send('games-loaded', games))
  return { success: true, count: games.length }
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    if (!tray) {
      app.quit();
    }
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

// Unregister all shortcuts on quit
app.on('will-quit', () => {
  globalShortcut.unregisterAll()
})

app.on('before-quit', () => {
  isQuitting = true
})