import { app, BrowserWindow } from 'electron'
import path from 'node:path'
import * as fs from 'fs'
import * as https from 'https'
import * as os from 'os'
import { exec } from 'child_process'
import { Game } from '../classes'
import { configService } from './config.service'
import { run } from '../utils/helpers'

class SteamService {
  private VERBOSE = !!process.env.SL_VERBOSE
  private vlog = (...args: unknown[]) => { if (this.VERBOSE) console.log('[verbose]', ...args) }

  public getRunningSteamLogin(): Promise<string | null> {
    return new Promise((resolve) => {
      exec("pgrep -x -a steam", (err, stdout) => {
        if (err || !stdout) return resolve(null)
        const lines = stdout.split('\n').filter(Boolean)
        for (const line of lines) {
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

  public async ensureSteamUserOrShutdown(desiredUser: string): Promise<void> {
    try {
      const runningUser = await this.getRunningSteamLogin()
      if (!runningUser) return
      if (runningUser === desiredUser) return
      exec('steam -shutdown', () => { /* noop */ })
      const start = Date.now()
      const timeoutMs = 30000
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
      // Ignore failures
    }
  }

  public async applyResolutionIfConfigured(game: Game): Promise<void> {
    try {
      const res = game.resolution?.trim()
      if (!res) return
      const { code } = await run(`kscreen-doctor ${res}`)
      if (code !== 0) {
        // silently ignore non-zero exit
      }
    } catch (e) {
      // silently ignore resolution errors
    }
  }

  public getLocalBuildID(steamID: number): string | null {
    try {
      for (const cp of configService.getConfig().compatdataPaths) {
        const fullPath = cp.replace('~', os.homedir())
        const steamappsDir = path.resolve(fullPath, '..')
        const acfPath = path.join(steamappsDir, `appmanifest_${steamID}.acf`)
        if (fs.existsSync(acfPath)) {
          const content = fs.readFileSync(acfPath, 'utf8')
          const match = content.match(/^\s*"buildid"\s*"(\d+)"/mi)
          if (match) {
            return match[1]
          }
        }
      }
    } catch (error) {
      if (this.VERBOSE) console.error(`Failed to get local build ID for ${steamID}:`, error)
    }
    return null
  }

  public getRemoteBuildID(steamID: number): Promise<string | null> {
    return new Promise((resolve) => {
      const url = `https://api.steamcmd.net/v1/info/${steamID}`
      const req = https.get(url, (res) => {
        let data = ''
        res.on('data', (chunk) => data += chunk)
        res.on('end', () => {
          try {
            const json = JSON.parse(data)
            if (json.status === 'success' && json.data?.[steamID]?.depots?.branches?.public?.buildid) {
              const buildID = String(json.data[steamID].depots.branches.public.buildid)
              if (this.VERBOSE) this.vlog(`Fetched remote buildID ${buildID} for AppID ${steamID} from Web-API`)
              return resolve(buildID)
            }
          } catch (e) {
            if (this.VERBOSE) console.error(`Failed to parse Web-API JSON for AppID ${steamID}:`, e)
          }
          runSteamcmdFallback()
        })
      })

      req.on('error', (err) => {
        if (this.VERBOSE) console.error(`Web-API error for AppID ${steamID}:`, err)
        runSteamcmdFallback()
      })

      req.setTimeout(5000, () => {
        if (this.VERBOSE) console.warn(`Web-API timeout for AppID ${steamID}`)
        req.destroy()
        runSteamcmdFallback()
      })

      const runSteamcmdFallback = () => {
        if (this.VERBOSE) this.vlog(`Running steamcmd fallback to get remote buildID for AppID ${steamID}`)
        const cmd = `steamcmd +login anonymous +app_info_update 1 +app_info_print ${steamID} +quit`
        const tempHome = path.join(app.getPath('userData'), 'steamcmd_home')
        try {
          fs.mkdirSync(tempHome, { recursive: true })
        } catch (err) {
          // Ignore
        }
        exec(cmd, { env: { ...process.env, HOME: tempHome } }, (error, stdout) => {
          if (error) {
            if (this.VERBOSE) console.error(`SteamCMD fallback execution failed for AppID ${steamID}:`, error)
            return resolve(null)
          }
          try {
            const publicIdx = stdout.indexOf('"public"')
            if (publicIdx !== -1) {
              const afterPublic = stdout.substring(publicIdx)
              const match = afterPublic.match(/"buildid"\s*"(\d+)"/i)
              if (match) {
                const buildID = match[1]
                if (this.VERBOSE) this.vlog(`Fetched remote buildID ${buildID} for AppID ${steamID} from SteamCMD`)
                return resolve(buildID)
              }
            }
            const simpleMatch = stdout.match(/"buildid"\s*"(\d+)"/i)
            if (simpleMatch) {
              return resolve(simpleMatch[1])
            }
          } catch (e) {
            if (this.VERBOSE) console.error(`Failed to parse SteamCMD output for AppID ${steamID}:`, e)
          }
          resolve(null)
        })
      }
    })
  }

  public async checkGameUpdate(steamID: number, force = false): Promise<boolean> {
    const config = configService.getConfig()
    const game = config.steamApps.find(g => g.steamID === steamID)
    if (!game) return false

    const now = Date.now()
    const twelveHoursMs = 12 * 60 * 60 * 1000
    if (!force && game.lastUpdateCheck && (now - game.lastUpdateCheck < twelveHoursMs)) {
      if (this.VERBOSE) this.vlog(`Skipping update check for AppID ${steamID} (already checked recently)`)
      return !!game.updateAvailable
    }

    const localBuildID = this.getLocalBuildID(steamID)
    if (!localBuildID) {
      if (this.VERBOSE) this.vlog(`No local buildID found for AppID ${steamID}`)
      return false
    }

    const remoteBuildID = await this.getRemoteBuildID(steamID)
    if (!remoteBuildID) {
      if (this.VERBOSE) console.warn(`Failed to fetch remote buildID for AppID ${steamID}`)
      return !!game.updateAvailable
    }

    const updateAvailable = localBuildID !== remoteBuildID
    const oldUpdate = game.updateAvailable
    const oldCheck = game.lastUpdateCheck

    game.updateAvailable = updateAvailable
    game.lastUpdateCheck = now

    if (oldUpdate !== updateAvailable || oldCheck !== now) {
      configService.saveConfig()
    }

    if (this.VERBOSE) {
      this.vlog(`AppID ${steamID} buildID compare: Local=${localBuildID}, Remote=${remoteBuildID}. UpdateAvailable=${updateAvailable}`)
    }

    return updateAvailable
  }

  public async triggerBackgroundUpdateChecks(force = false): Promise<void> {
    if (this.VERBOSE) this.vlog(`Starting background update checks (force=${force}) for all games...`)
    const visible = configService.getVisibleGamesSorted()
    for (const game of visible) {
      try {
        await this.checkGameUpdate(game.steamID, force)
        BrowserWindow.getAllWindows().forEach(win => {
          win.webContents.send('games-loaded', configService.getVisibleGamesSorted())
        })
      } catch (e) {
        if (this.VERBOSE) console.error(`Error checking update for AppID ${game.steamID}:`, e)
      }
    }
  }

  public async fetchAppDetails(steamID: number): Promise<{ name: string; icon?: string }> {
    return new Promise((resolve) => {
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
            if (this.VERBOSE) console.error(`Failed API for steamID ${steamID}:`, e)
            resolve({ name: `Game ${steamID}` })
          }
        })
      }).on('error', (err) => {
        if (this.VERBOSE) console.error(`Failed API for steamID ${steamID}:`, err)
        resolve({ name: `Game ${steamID}` })
      })
    })
  }

  public async fetchGames(): Promise<Game[]> {
    const config = configService.getConfig()
    const games: Game[] = []
    const steamIDs = new Set<number>()

    for (const pathStr of config.compatdataPaths) {
      try {
        const fullPath = pathStr.replace('~', os.homedir())
        if (this.VERBOSE) this.vlog(`Using compatdata path: ${fullPath}`)
        const entries = fs.readdirSync(fullPath)
        if (this.VERBOSE) this.vlog(`Found ${entries.length} entries in compatdata`)

        const filteredEntries = entries.filter(entry => /^\d+$/.test(entry))
        if (this.VERBOSE) this.vlog(`Filtered steamIDs: [ ${filteredEntries.join(', ')} ]`)

        for (const entry of filteredEntries) {
          const steamID = parseInt(entry)
          if (steamID > 0 && steamID !== 1493710 && !steamIDs.has(steamID)) {
            steamIDs.add(steamID)

            let gameConfig = config.steamApps.find(g => g.steamID === steamID)
            if (!gameConfig) {
              gameConfig = {
                name: `Game ${steamID}`,
                user: 'default_user',
                steamID: steamID,
                hidden: false,
                processName: undefined,
                order: configService.getNextOrderValue(),
              }
              config.steamApps.push(gameConfig)
            }
            if (typeof gameConfig.order !== 'number') {
              gameConfig.order = configService.getNextOrderValue()
            }

            const details = await this.fetchAppDetails(steamID)
            gameConfig.name = details.name
            gameConfig.icon = details.icon

            if (!gameConfig.hidden) {
              games.push(gameConfig)
            }
          }
        }
      } catch (error) {
        if (this.VERBOSE) console.error(`Failed to read compatdata path ${pathStr}:`, error)
      }
    }

    configService.reindexGameOrders()
    games.sort(configService.compareByOrder)
    return games
  }
}

export const steamService = new SteamService()
