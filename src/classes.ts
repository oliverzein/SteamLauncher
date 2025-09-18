import { spawn, ChildProcess } from 'child_process'
import path from 'node:path'
import { createRequire } from 'node:module'

// ##############
// Classes
// ##############

interface ExecutionResult {
  success: boolean
  pid?: number
  error?: string
}

interface AppConfig {
  executablePath: string
  executableArgs: string[]
}

class AppStarter {
  executablePath: string
  executableArgs: string[]

  constructor(executablePath: string, executableArgs: string[]) {
    this.executablePath = executablePath
    this.executableArgs = executableArgs
  }

  execute(): Promise<ExecutionResult> {
    return new Promise((resolve, reject) => {
      try {
        const child: ChildProcess = spawn(this.executablePath, this.executableArgs, {
          stdio: 'ignore'
        })
        resolve({ success: true, pid: child.pid })
      } catch (error) {
        console.error('Failed to start executable:', error)
        reject({ success: false, error: (error as Error).message })
      }
    })
  }
}

class SteamStarter extends AppStarter {
  user: string
  steamID: number

  constructor(user: string, steamID: number, executablePath: string) {
    // will populate args at execute time once password is fetched from keytar
    super(executablePath, [])
    this.user = user
    this.steamID = steamID
  }

  async execute(): Promise<ExecutionResult> {
    try {
      // Load keytar at runtime with fallback to unpacked path in production
      let keytar: { getPassword: (service: string, account: string) => Promise<string | null> }
      try {
        const require = createRequire(__filename)
        keytar = require('keytar')
      } catch {
        try {
          const altUnpacked = path.join(process.resourcesPath, 'app.asar.unpacked', 'node_modules', 'keytar')
          const require = createRequire(__filename)
          keytar = require(altUnpacked)
        } catch {
          try {
            const altResources = path.join(process.resourcesPath, 'keytar')
            const require = createRequire(__filename)
            keytar = require(altResources)
          } catch {
            const altNodeModules = path.join(process.resourcesPath, 'node_modules', 'keytar')
            const require = createRequire(__filename)
            keytar = require(altNodeModules)
          }
        }
      }
      const account = `${this.user}:${this.steamID}`
      const password = await keytar.getPassword('steamlauncher', account)
      if (!password) {
        return { success: false, error: 'No password stored for this game/user. Please configure credentials.' }
      }
      this.executableArgs = ['-login', this.user, password, '-applaunch', this.steamID.toString()]
      const child: ChildProcess = spawn(this.executablePath, this.executableArgs, { stdio: 'ignore' })
      return { success: true, pid: child.pid }
    } catch (error) {
      console.error('Failed to start executable:', error)
      return { success: false, error: (error as Error).message }
    }
  }

  // Start Steam for this account without launching the game (omit -applaunch)
  async executeSteamOnly(): Promise<ExecutionResult> {
    try {
      // Load keytar at runtime with fallback to unpacked path in production
      let keytar: { getPassword: (service: string, account: string) => Promise<string | null> }
      try {
        const require = createRequire(__filename)
        keytar = require('keytar')
      } catch {
        try {
          const altUnpacked = path.join(process.resourcesPath, 'app.asar.unpacked', 'node_modules', 'keytar')
          const require = createRequire(__filename)
          keytar = require(altUnpacked)
        } catch {
          try {
            const altResources = path.join(process.resourcesPath, 'keytar')
            const require = createRequire(__filename)
            keytar = require(altResources)
          } catch {
            const altNodeModules = path.join(process.resourcesPath, 'node_modules', 'keytar')
            const require = createRequire(__filename)
            keytar = require(altNodeModules)
          }
        }
      }
      const account = `${this.user}:${this.steamID}`
      const password = await keytar.getPassword('steamlauncher', account)
      if (!password) {
        return { success: false, error: 'No password stored for this game/user. Please configure credentials.' }
      }
      this.executableArgs = ['-login', this.user, password]
      const child: ChildProcess = spawn(this.executablePath, this.executableArgs, { stdio: 'ignore' })
      return { success: true, pid: child.pid }
    } catch (error) {
      console.error('Failed to start Steam only:', error)
      return { success: false, error: (error as Error).message }
    }
  }
}

// ##############
// Interfaces
// ##############

interface Game {
  name: string
  icon?: string
  user: string
  steamID: number
  hidden?: boolean
  processName?: string
  resolution?: string
}

interface Config {
  compatdataPaths: string[]
  steamApps: Game[]
  startMinimized?: boolean
}

// ##############
// Exports
// ##############

export { AppStarter, SteamStarter, ExecutionResult, AppConfig, Game, Config }
