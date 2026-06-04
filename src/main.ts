/* eslint-disable @typescript-eslint/ban-ts-comment */
import { app, BrowserWindow, ipcMain, Menu, globalShortcut, Tray, nativeImage } from 'electron'
import type { Event as ElectronEvent } from 'electron'
import { exec } from 'child_process'
import path from 'node:path'
import started from 'electron-squirrel-startup'

import { SteamStarter, Game, loadKeytar } from './classes'
import { waitForDevServer, buildPgrepCmd, getAppIconPath } from './utils/helpers'
import { configService } from './services/config.service'
import { steamService } from './services/steam.service'
import { updateService } from './services/update.service'

// Ambient declarations for Vite-injected globals (Forge Vite plugin)
// @ts-ignore
declare const SETTINGS_WINDOW_VITE_DEV_SERVER_URL: string | undefined
// @ts-ignore
declare const SETTINGS_WINDOW_VITE_NAME: string
// @ts-ignore
declare const CONFIGURE_WINDOW_VITE_DEV_SERVER_URL: string | undefined
// @ts-ignore
declare const CONFIGURE_WINDOW_VITE_NAME: string

// Reduce Chromium/Electron log verbosity (set before 'ready')
app.commandLine.appendSwitch('log-level', '3')
app.commandLine.appendSwitch('v', '0')

let mainWindow: BrowserWindow | null = null
let steamStarters: SteamStarter[] = []
let tray: Tray | null = null
let isQuitting = false


function getGameForVisibleIndex(index: number): Game | undefined {
  const starter = steamStarters[index]
  if (!starter) return undefined
  return configService.getConfig().steamApps.find(g => g.steamID === starter.steamID)
}

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (started) {
  app.quit()
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
    const game = configService.getConfig().steamApps[index]
    configureWin.webContents.send('configure-game', game, index)
  })
}

const createWindow = () => {
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
  })

  mainWindow.on('close', (e: ElectronEvent) => {
    // @ts-ignore
    if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
      return
    }
    if (!isQuitting) {
      e.preventDefault()
      mainWindow?.hide()
      mainWindow?.setSkipTaskbar(true)
    }
  })

  mainWindow.on('minimize', () => {
    // @ts-ignore
    if (MAIN_WINDOW_VITE_DEV_SERVER_URL) return
    if (!isQuitting) {
      mainWindow?.hide()
      mainWindow?.setSkipTaskbar(true)
    }
  })

  mainWindow.on('show', () => {
    mainWindow?.setSkipTaskbar(false)
  })

  // @ts-ignore
  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    try {
      const ses = mainWindow.webContents.session
      ses.clearCache()
      ses.clearStorageData({
        storages: ['serviceworkers', 'cachestorage']
      })
    } catch {
      // Ignore
    }
    // @ts-ignore
    const devUrl = MAIN_WINDOW_VITE_DEV_SERVER_URL.includes('?')
      // @ts-ignore
      ? `${MAIN_WINDOW_VITE_DEV_SERVER_URL}&t=${Date.now()}`
      // @ts-ignore
      : `${MAIN_WINDOW_VITE_DEV_SERVER_URL}?t=${Date.now()}`
    // @ts-ignore
    waitForDevServer(MAIN_WINDOW_VITE_DEV_SERVER_URL).then(() => {
      if (!mainWindow?.isDestroyed()) mainWindow?.loadURL(devUrl)
    }).catch(() => {
      if (!mainWindow?.isDestroyed()) mainWindow?.loadURL(devUrl)
    })

    let lastDevReload = 0
    mainWindow.webContents.on('console-message', (_event, _level, message) => {
      if (typeof message === 'string' && message.includes('Outdated Optimize Dep')) {
        const now = Date.now()
        if (now - lastDevReload > 2000) {
          lastDevReload = now
          mainWindow?.webContents.reloadIgnoringCache()
        }
      }
    })

    let retriedFailLoad = false
    mainWindow.webContents.on('did-fail-load', () => {
      if (!retriedFailLoad) {
        retriedFailLoad = true
        setTimeout(() => {
          if (!mainWindow?.isDestroyed()) {
            mainWindow?.webContents.reloadIgnoringCache()
          }
        }, 500)
      }
    })

    let watchdogTriggered = false
    mainWindow.webContents.on('did-finish-load', () => {
      setTimeout(async () => {
        const win = mainWindow
        if (watchdogTriggered || !win || win.isDestroyed()) return
        try {
          const contentLen: number = await win.webContents.executeJavaScript(
            'document.body && document.body.innerText ? document.body.innerText.trim().length : 0',
            true
          )
          if (contentLen < 5) {
            watchdogTriggered = true
            win.webContents.reloadIgnoringCache()
          }
        } catch { /* ignore */ }
      }, 1200)
    })
  } else {
    // @ts-ignore
    mainWindow.loadFile(path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`))
  }

  mainWindow.webContents.once('did-finish-load', () => {
    mainWindow?.webContents.send('games-loaded', configService.getVisibleGamesSorted())
    steamService.triggerBackgroundUpdateChecks(false)
  })
}

app.whenReady().then(async () => {
  Menu.setApplicationMenu(null)
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
  configService.loadConfig()
  const games = await steamService.fetchGames()
  steamStarters = games.map(game => new SteamStarter(game.user, game.steamID, 'steam'))

  createWindow()

  if (mainWindow) {
    if (configService.getConfig().startMinimized) {
      mainWindow.hide()
      mainWindow.setSkipTaskbar(true)
    }
  }
})

// IPC Handlers
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
    const gameForUser = getGameForVisibleIndex(index)
    if (gameForUser?.user) {
      await steamService.ensureSteamUserOrShutdown(gameForUser.user)
    }
    if (gameForUser) {
      await steamService.applyResolutionIfConfigured(gameForUser)
    }
    const launchEventPayload = { index, steamID: starter.steamID }
    BrowserWindow.getAllWindows().forEach(win => win.webContents.send('launching-started', launchEventPayload))
    const result = await starter.execute()
    const game = getGameForVisibleIndex(index)
    const configured = game?.processName?.trim()
    const fallback = (process.platform === 'win32' ? 'steam.exe' : 'steam')
    const procName = configured && configured.length > 0 ? configured : fallback
    if (result.success) {
      const start = Date.now()
      const timeoutMs = 120000
      const initialDelayMs = 4000
      const cmd = buildPgrepCmd(procName)
      const tick = () => {
        if (Date.now() - start > timeoutMs) {
          BrowserWindow.getAllWindows().forEach(win => win.webContents.send('launching-stopped', launchEventPayload))
          return
        }
        exec(cmd, (err, stdout) => {
          const out = (stdout || '').trim()
          if (out.length > 0) {
            BrowserWindow.getAllWindows().forEach(win => win.webContents.send('launching-stopped', launchEventPayload))
          } else {
            setTimeout(tick, 1500)
          }
        })
      }
      setTimeout(tick, initialDelayMs)
    } else {
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
  return configService.getConfig()
})

ipcMain.handle('save-config', async (event, newConfig) => {
  if (newConfig && Array.isArray(newConfig.compatdataPaths)) {
    const valid = newConfig.compatdataPaths.every((p: unknown) => typeof p === 'string' && p.length > 0)
    if (!valid) {
      return { success: false, error: 'compatdataPaths must be a non-empty array of strings' }
    }
  }
  if (newConfig && 'startMinimized' in newConfig && typeof newConfig.startMinimized !== 'boolean') {
    return { success: false, error: 'startMinimized must be a boolean' }
  }
  configService.saveConfig(newConfig)
  const games = await steamService.fetchGames()
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
  const index = configService.getConfig().steamApps.findIndex(g => g.steamID === steamID)
  if (index === -1) {
    return { success: false, error: 'Game not found' }
  }
  createConfigureWindow(index)
  return { success: true }
})

ipcMain.handle('save-game-config', async (event, index: number, user: string, password: string, processName?: string, resolution?: string, notes?: string) => {
  const config = configService.getConfig()
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
  config.steamApps[index].user = user
  if (typeof processName === 'string') {
    const pn = processName.trim()
    config.steamApps[index].processName = pn.length ? pn : undefined
  }
  if (typeof resolution === 'string') {
    const rs = resolution.trim()
    config.steamApps[index].resolution = rs.length ? rs : undefined
  }
  if (typeof notes === 'string') {
    const ns = notes.trim()
    config.steamApps[index].notes = ns.length ? ns : undefined
  }
  if (password && password.length > 0) {
    try {
      const keytar = loadKeytar()
      await keytar.setPassword('steamlauncher', `${user}:${steamID}`, password)
    } catch (e) {
      return { success: false, error: 'Failed to store password in keychain' }
    }
  }
  configService.saveConfig()
  BrowserWindow.getAllWindows().forEach(win => {
    win.webContents.send('config-updated')
  })
  return { success: true }
})

ipcMain.handle('save-game-order', async (_event, steamIDs: number[]) => {
  const config = configService.getConfig()
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
    .sort(configService.compareByOrder)
  for (const game of remaining) {
    game.order = order++
  }

  configService.saveConfig()
  const visible = configService.getVisibleGamesSorted()
  steamStarters = visible.map(game => new SteamStarter(game.user, game.steamID, 'steam'))
  BrowserWindow.getAllWindows().forEach(win => {
    win.webContents.send('games-loaded', visible)
    win.webContents.send('config-updated')
  })
})

ipcMain.handle('get-stored-password', async (event, steamID: number, user: string) => {
  try {
    if (typeof steamID !== 'number' || !Number.isInteger(steamID) || steamID <= 0) {
      return { success: false, error: 'Invalid steamID' }
    }
    if (typeof user !== 'string' || user.length === 0) {
      return { success: false, error: 'Invalid user' }
    }
    const keytar = loadKeytar()
    const account = `${user}:${steamID}`
    const password = await keytar.getPassword('steamlauncher', account)
    if (!password) return { success: false, error: 'No password set' }
    return { success: true, password }
  } catch (e) {
    return { success: false, error: 'Failed to retrieve password' }
  }
})

ipcMain.handle('toggle-hidden', async (event, steamID: number) => {
  const config = configService.getConfig()
  if (typeof steamID !== 'number' || !Number.isInteger(steamID) || steamID <= 0) {
    return { success: false, error: 'Invalid steamID' }
  }
  const index = config.steamApps.findIndex(g => g.steamID === steamID)
  if (index === -1) {
    return { success: false, error: 'Game not found' }
  }
  const game = config.steamApps[index]
  game.hidden = !game.hidden
  configService.saveConfig()
  const updatedGames = await steamService.fetchGames()
  steamStarters = updatedGames.map(g => new SteamStarter(g.user, g.steamID, 'steam'))
  mainWindow?.webContents.send('games-loaded', updatedGames)
  BrowserWindow.getAllWindows().forEach(win => {
    win.webContents.send('config-updated')
  })
  return { success: true }
})

ipcMain.handle('get-all-games', () => {
  return configService.getConfig().steamApps
})

ipcMain.handle('open-settings', async () => {
  createSettingsWindow()
})

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
    BrowserWindow.getAllWindows().forEach(win => win.webContents.send('launching-started', index))
    const game = getGameForVisibleIndex(index)
    if (game) {
      await steamService.applyResolutionIfConfigured(game)
    }
    const result = await starter.executeSteamOnly()
    const procName = process.platform === 'win32' ? 'steam.exe' : 'steam'
    if (result.success) {
      const start = Date.now()
      const timeoutMs = 120000
      const initialDelayMs = 4000
      const cmd = buildPgrepCmd(procName)
      const tick = () => {
        if (Date.now() - start > timeoutMs) {
          BrowserWindow.getAllWindows().forEach(win => win.webContents.send('launching-stopped', index))
          return
        }
        exec(cmd, (err, stdout) => {
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

ipcMain.handle('update-game', async (event, steamID: number) => {
  return updateService.updateGame(steamID)
})

ipcMain.handle('submit-steam-guard', async (event, steamID: number, code: string) => {
  return updateService.submitSteamGuard(steamID, code)
})

ipcMain.handle('cancel-update', async (event, steamID: number) => {
  return updateService.cancelUpdate(steamID)
})

ipcMain.handle('get-app-version', () => {
  return app.getVersion()
})

ipcMain.handle('refresh-games', async () => {
  const games = await steamService.fetchGames()
  steamStarters = games.map(game => new SteamStarter(game.user, game.steamID, 'steam'))
  BrowserWindow.getAllWindows().forEach(win => win.webContents.send('games-loaded', games))
  steamService.triggerBackgroundUpdateChecks(true)
  return { success: true, count: games.length }
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    if (!tray) {
      app.quit()
    }
  }
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow()
  }
})

app.on('will-quit', () => {
  globalShortcut.unregisterAll()
})

app.on('before-quit', () => {
  isQuitting = true
})
