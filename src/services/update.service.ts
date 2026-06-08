import { app, BrowserWindow } from 'electron'
import { spawn, execSync, ChildProcess } from 'child_process'
import path from 'node:path'
import * as fs from 'fs'
import * as os from 'os'
import { configService } from './config.service'
import { steamService } from './steam.service'
import { loadKeytar } from '../classes'

interface UpdateSession {
  steamID: number
  child: ChildProcess
  user: string
  loginState?: 'SPAWNED' | 'LOGGING_IN' | 'AWAITING_2FA' | 'UPDATING'
}

class UpdateService {
  private activeUpdates = new Map<number, UpdateSession>()
  private VERBOSE = !!process.env.SL_VERBOSE
  private vlog = (...args: unknown[]) => { if (this.VERBOSE) console.log('[verbose]', ...args) }

  public getActiveUpdates(): Map<number, UpdateSession> {
    return this.activeUpdates
  }

  private async getStoredPasswordForUpdate(steamID: number, user: string): Promise<string | null> {
    try {
      const keytar = loadKeytar()
      const account = `${user}:${steamID}`
      return await keytar.getPassword('steamlauncher', account)
    } catch (e) {
      if (this.VERBOSE) console.error('Failed to retrieve password for update:', e)
      return null
    }
  }

  public async updateGame(steamID: number): Promise<{ success: boolean; error?: string }> {
    try {
      // Check if steamcmd is installed
      try {
        const checkCmd = process.platform === 'win32' ? 'where steamcmd' : 'which steamcmd'
        execSync(checkCmd, { stdio: 'ignore' })
      } catch {
        return { success: false, error: 'SteamCMD was not found on your system. Please install "steamcmd" to enable game updates.' }
      }

      if (this.activeUpdates.has(steamID)) {
        return { success: false, error: 'Update already in progress for this game' }
      }
      const config = configService.getConfig()
      const game = config.steamApps.find(g => g.steamID === steamID)
      if (!game) {
        return { success: false, error: 'Game not found in configuration' }
      }

      let acfPath: string | null = null
      let steamappsDir: string | null = null
      for (const cp of config.compatdataPaths) {
        const fullPath = cp.replace('~', os.homedir())
        const sAppsDir = path.resolve(fullPath, '..')
        const checkPath = path.join(sAppsDir, `appmanifest_${steamID}.acf`)
        if (fs.existsSync(checkPath)) {
          acfPath = checkPath
          steamappsDir = sAppsDir
          break
        }
      }

      if (!acfPath || !steamappsDir) {
        return { success: false, error: 'Could not locate appmanifest file for game' }
      }
      const targetAppsDir = steamappsDir

      const content = fs.readFileSync(acfPath, 'utf8')
      const match = content.match(/^\s*"installdir"\s*"([^"]+)"/mi)
      if (!match) {
        return { success: false, error: 'Could not parse installdir from appmanifest file' }
      }
      const installdir = match[1]
      const gamePath = path.join(targetAppsDir, 'common', installdir)

      const password = await this.getStoredPasswordForUpdate(steamID, game.user)
      if (!password) {
        return { success: false, error: 'No password stored for this game account. Please configure credentials.' }
      }

      const logPath = path.join(app.getPath('userData'), `steamcmd_update_${steamID}.log`)
      try {
        fs.writeFileSync(logPath, `=== SteamCMD Update Log for ${game.name} (AppID ${steamID}) ===\nStarted: ${new Date().toISOString()}\nPath: ${gamePath}\nUser: ${game.user}\nLocal buildID: ${steamService.getLocalBuildID(steamID) || 'Unknown'}\n\n`)
      } catch (logErr) {
        console.error('Failed to create update log file:', logErr)
      }

      console.log(`[SteamLauncher Update ${steamID}] Spawning steamcmd. Log file: ${logPath}`)
      BrowserWindow.getAllWindows().forEach(win => {
        win.webContents.send('update-progress', { steamID, status: 'checking', progress: 0, bytesDownloaded: 0, bytesTotal: 0 })
      })

      const tempHome = path.join(app.getPath('userData'), 'steamcmd_home')
      const isolatedAppsDir = path.join(tempHome, '.steam', 'steamcmd', 'steamapps')
      try {
        fs.mkdirSync(isolatedAppsDir, { recursive: true })

        // Verlinke echte steamcmd-Systemdateien (außer steamapps), damit der Wrapper funktioniert
        const realSteamcmdDir = path.join(os.homedir(), '.steam', 'steamcmd')
        const tempSteamcmdDir = path.join(tempHome, '.steam', 'steamcmd')
        if (fs.existsSync(realSteamcmdDir)) {
          const items = fs.readdirSync(realSteamcmdDir)
          for (const item of items) {
            if (item !== 'steamapps') {
              const srcItem = path.join(realSteamcmdDir, item)
              const destItem = path.join(tempSteamcmdDir, item)
              try {
                if (fs.existsSync(destItem) || fs.lstatSync(destItem).isSymbolicLink()) {
                  fs.unlinkSync(destItem)
                }
              } catch (e) {
                // Ignorieren
              }
              try {
                fs.symlinkSync(srcItem, destItem)
              } catch (symErr) {
                console.error(`Fehler beim Verlinken von steamcmd-Systemdatei ${item}:`, symErr)
              }
            }
          }
        }

        const isolatedCommon = path.join(isolatedAppsDir, 'common')
        const targetCommon = path.join(targetAppsDir, 'common')
        if (fs.existsSync(isolatedCommon) || fs.lstatSync(isolatedCommon).isSymbolicLink()) {
          try {
            fs.unlinkSync(isolatedCommon)
          } catch {
            fs.rmSync(isolatedCommon, { recursive: true, force: true })
          }
        }
        fs.symlinkSync(targetCommon, isolatedCommon, 'dir')

        const files = fs.readdirSync(targetAppsDir)
        for (const file of files) {
          if (file.endsWith('.acf') && file.startsWith('appmanifest_')) {
            const srcAcf = path.join(targetAppsDir, file)
            const destAcf = path.join(isolatedAppsDir, file)
            try {
              if (fs.existsSync(destAcf) || fs.lstatSync(destAcf).isSymbolicLink()) {
                fs.unlinkSync(destAcf)
              }
              fs.copyFileSync(srcAcf, destAcf)
            } catch (copyErr) {
              console.error(`Failed to copy manifest ${file}:`, copyErr)
            }
          }
        }
      } catch (err) {
        console.error('Failed to setup isolated SteamCMD library:', err)
      }

      const child = spawn('steamcmd', [], {
        env: {
          ...process.env,
          HOME: tempHome
        },
        detached: true
      })

      const session: UpdateSession = { steamID, child, user: game.user, loginState: 'SPAWNED' }
      this.activeUpdates.set(steamID, session)

      const escapeSteamcmdArg = (arg: string): string => {
        return '"' + arg.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"'
      }

      const escapedUser = escapeSteamcmdArg(game.user)
      const escapedPassword = escapeSteamcmdArg(password)

      if (child.stdin) {
        child.stdin.write(`login ${escapedUser} ${escapedPassword}\n`)
        session.loginState = 'LOGGING_IN'
      }

      let accumulatedStdout = ''
      let guardPrompted = false
      const recentLines: string[] = []

      const appendToLog = (text: string) => {
        try {
          fs.appendFileSync(logPath, text)
        } catch (e) {
          console.error('Failed appending to update log:', e)
        }
      }

      child.stdout.on('data', (data: Buffer) => {
        const chunk = data.toString()
        accumulatedStdout += chunk
        appendToLog(chunk)

        if (this.VERBOSE) process.stdout.write(`[steamcmd ${steamID}] ${chunk}`)

        if (session.loginState === 'LOGGING_IN' && !guardPrompted && (
          accumulatedStdout.includes('Steam Guard code') ||
          accumulatedStdout.includes('Two-factor code') ||
          accumulatedStdout.includes('Google Authenticator code') ||
          accumulatedStdout.includes('Enter code:') ||
          accumulatedStdout.includes('Enter the current')
        )) {
          guardPrompted = true
          session.loginState = 'AWAITING_2FA'
          BrowserWindow.getAllWindows().forEach(win => {
            win.webContents.send('steam-guard-required', { steamID, user: game.user })
            win.webContents.send('update-progress', { steamID, status: '2fa', progress: 0, bytesDownloaded: 0, bytesTotal: 0 })
          })
        }

        const hasUserInfo = accumulatedStdout.includes('Waiting for user info...')
        const hasUserInfoSuccess = hasUserInfo && (
          accumulatedStdout.indexOf('OK', accumulatedStdout.indexOf('Waiting for user info...')) !== -1 ||
          accumulatedStdout.indexOf('Steam>', accumulatedStdout.indexOf('Waiting for user info...')) !== -1
        )
        const hasLoggedIn = accumulatedStdout.includes('Logged in OK') || accumulatedStdout.includes('Logged in') || accumulatedStdout.includes('Success!')

        if ((session.loginState === 'LOGGING_IN' || session.loginState === 'AWAITING_2FA') && (
          hasUserInfoSuccess || hasLoggedIn
        )) {
          session.loginState = 'UPDATING'
          if (this.VERBOSE) this.vlog(`SteamCMD Login Success. Initiating app_update ${steamID}`)
          if (child.stdin) {
            child.stdin.write(`app_update ${steamID} validate\n`)
            child.stdin.write('quit\n')
          }
        }

        if ((session.loginState === 'LOGGING_IN' || session.loginState === 'AWAITING_2FA') && (
          accumulatedStdout.includes('FAILED with result code') ||
          accumulatedStdout.includes('Login Failed') ||
          accumulatedStdout.includes('Password invalid')
        )) {
          if (this.VERBOSE) this.vlog(`SteamCMD Login Failed for ${game.user}`)
          child.kill()
        }

        const lines = chunk.split('\n')
        for (const line of lines) {
          const trimmed = line.trim()
          if (trimmed) {
            recentLines.push(trimmed)
            if (recentLines.length > 15) {
              recentLines.shift()
            }
          }

          const progressRegex = /progress:\s+([\d.]+)\s+\((\d+)\s+\/\s+(\d+)\)/
          const match = line.match(progressRegex)
          if (match) {
            const progress = parseFloat(match[1])
            const bytesDownloaded = parseInt(match[2], 10)
            const bytesTotal = parseInt(match[3], 10)

            let status = 'updating'
            if (line.toLowerCase().includes('download')) {
              status = 'downloading'
            } else if (line.toLowerCase().includes('verify') || line.toLowerCase().includes('validate')) {
              status = 'validating'
            } else if (line.toLowerCase().includes('preallocat')) {
              status = 'preallocating'
            }

            BrowserWindow.getAllWindows().forEach(win => {
              win.webContents.send('update-progress', { steamID, status, progress, bytesDownloaded, bytesTotal })
            })
          }
        }
      })

      child.stderr.on('data', (data: Buffer) => {
        const chunk = data.toString()
        appendToLog(chunk)
        console.error(`[steamcmd ${steamID} stderr] ${chunk}`)

        const lines = chunk.split('\n')
        for (const line of lines) {
          const trimmed = line.trim()
          if (trimmed) {
            recentLines.push(`[stderr] ${trimmed}`)
            if (recentLines.length > 15) {
              recentLines.shift()
            }
          }
        }
      })

      child.on('error', (err: Error) => {
        const errMsg = `Failed to start steamcmd process: ${err.message}`
        appendToLog(`\nERROR: ${errMsg}\n`)
        console.error(`[steamcmd ${steamID} error]`, err)
        this.activeUpdates.delete(steamID)
        BrowserWindow.getAllWindows().forEach(win => {
          win.webContents.send('update-progress', { steamID, status: 'failed', progress: 0, bytesDownloaded: 0, bytesTotal: 0, error: `${errMsg}\n\nFull log: ${logPath}` })
        })
      })

      child.on('close', async (code: number) => {
        const endMsg = `Process exited with code ${code}`
        appendToLog(`\n${endMsg}\n`)
        console.log(`[steamcmd ${steamID}] ${endMsg}`)
        this.activeUpdates.delete(steamID)

        const isolatedAppsDir = path.join(tempHome, '.steam', 'steamcmd', 'steamapps')
        const isolatedAcf = path.join(isolatedAppsDir, `appmanifest_${steamID}.acf`)

        const lowerStdout = accumulatedStdout.toLowerCase()
        let updateSuccess = lowerStdout.includes(`success! app '${steamID}'`)

        if (!updateSuccess && fs.existsSync(isolatedAcf)) {
          const destAcf = path.join(targetAppsDir, `appmanifest_${steamID}.acf`)
          if (!fs.existsSync(destAcf)) {
            updateSuccess = true
          } else {
            try {
              const srcContent = fs.readFileSync(isolatedAcf, 'utf8')
              const destContent = fs.readFileSync(destAcf, 'utf8')
              const srcMatch = srcContent.match(/^\s*"buildid"\s*"(\d+)"/mi)
              const destMatch = destContent.match(/^\s*"buildid"\s*"(\d+)"/mi)
              if (srcMatch && destMatch) {
                updateSuccess = srcMatch[1] !== destMatch[1]
              } else {
                updateSuccess = srcContent !== destContent
              }
            } catch (e) {
              updateSuccess = true
            }
          }
        }

        if (fs.existsSync(isolatedAppsDir)) {
          try {
            if (updateSuccess) {
              appendToLog(`Syncing updated manifest files from isolated staging library...\n`)
              const files = fs.readdirSync(isolatedAppsDir)
              for (const file of files) {
                if (file === `appmanifest_${steamID}.acf`) {
                  const srcAcf = path.join(isolatedAppsDir, file)
                  const destAcf = path.join(targetAppsDir, file)
                  let shouldCopy = false
                  if (!fs.existsSync(destAcf)) {
                    shouldCopy = true
                  } else {
                    const srcContent = fs.readFileSync(srcAcf, 'utf8')
                    const destContent = fs.readFileSync(destAcf, 'utf8')
                    if (srcContent !== destContent) {
                      shouldCopy = true
                    }
                  }
                  if (shouldCopy) {
                    fs.copyFileSync(srcAcf, destAcf)
                    appendToLog(`Synced manifest: ${file}\n`)
                  }
                }
              }
            } else {
              appendToLog(`Discarding isolated manifest sync (update failed or cancelled).\n`)
            }

            fs.rmSync(isolatedAppsDir, { recursive: true, force: true })
            appendToLog(`Cleaned up isolated steamapps directory.\n`)
          } catch (syncErr) {
            const syncErrMsg = `Failed to sync manifest files: ${(syncErr as Error).message}`
            console.error(syncErrMsg)
            appendToLog(`ERROR: ${syncErrMsg}\n`)
          }
        }

        await steamService.checkGameUpdate(steamID, true)
        const gameAfterCheck = configService.getConfig().steamApps.find(g => g.steamID === steamID)
        if (gameAfterCheck && updateSuccess) {
          gameAfterCheck.updateAvailable = false
          gameAfterCheck.lastUpdateCheck = Date.now()
          configService.saveConfig()
        }
        const success = gameAfterCheck ? !gameAfterCheck.updateAvailable : false

        appendToLog(`Post-update verification: success=${success}, localBuildID=${steamService.getLocalBuildID(steamID) || 'Unknown'}\n`)

        if (success) {
          if (code !== 0 && code !== 139) {
            appendToLog(`Warning: Process exited with non-zero code ${code}, but manifest was updated successfully.\n`)
          }
          BrowserWindow.getAllWindows().forEach(win => {
            win.webContents.send('update-progress', { steamID, status: 'completed', progress: 100, bytesDownloaded: 0, bytesTotal: 0 })
            win.webContents.send('games-loaded', (steamService as any).getVisibleGamesSorted ? (steamService as any).getVisibleGamesSorted() : configService.getVisibleGamesSorted())
          })
        } else {
          const preview = recentLines.join('\n')
          const errorMsg = `Process exited with code ${code}. Update verification failed.\n\nLast output:\n${preview}\n\nFull log: ${logPath}`
          console.error(`[SteamLauncher Update ${steamID} failed] ${errorMsg}`)
          BrowserWindow.getAllWindows().forEach(win => {
            win.webContents.send('update-progress', { steamID, status: 'failed', progress: 0, bytesDownloaded: 0, bytesTotal: 0, error: errorMsg })
          })
        }
      })

      return { success: true }
    } catch (error) {
      if (this.VERBOSE) console.error(`Failed to trigger update for AppID ${steamID}:`, error)
      return { success: false, error: (error as Error).message }
    }
  }

  public async submitSteamGuard(steamID: number, code: string): Promise<{ success: boolean; error?: string }> {
    const session = this.activeUpdates.get(steamID)
    if (session && session.child && session.child.stdin) {
      if (this.VERBOSE) this.vlog(`Submitting Steam Guard code for ${steamID}`)
      session.loginState = 'LOGGING_IN'
      session.child.stdin.write(code + '\n')
      return { success: true }
    }
    return { success: false, error: 'No active update session found' }
  }

  public async cancelUpdate(steamID: number): Promise<{ success: boolean; error?: string }> {
    const session = this.activeUpdates.get(steamID)
    if (session) {
      if (this.VERBOSE) this.vlog(`Cancelling update for ${steamID}`)
      if (session.child) {
        try {
          process.kill(-session.child.pid, 'SIGTERM')
        } catch (err) {
          session.child.kill()
        }
      }
      this.activeUpdates.delete(steamID)
      return { success: true }
    }
    return { success: false, error: 'No active update session found' }
  }
}

export const updateService = new UpdateService()
