import { spawn, ChildProcess } from 'child_process'
import path from 'node:path'
import { createRequire } from 'node:module'

function loadKeytar(): any {
  const req = createRequire(__filename)
  try {
    return req('keytar')
  } catch {
    try {
      const altUnpacked = path.join(process.resourcesPath, 'app.asar.unpacked', 'node_modules', 'keytar')
      return req(altUnpacked)
    } catch {
      try {
        const altResources = path.join(process.resourcesPath, 'keytar')
        return req(altResources)
      } catch {
        const altNodeModules = path.join(process.resourcesPath, 'node_modules', 'keytar')
        return req(altNodeModules)
      }
    }
  }
}

// ##############
// Classes
// ##############

interface ExecutionResult {
  success: boolean
  pid?: number
  error?: string
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

  // fallow-ignore-next-line unused-class-member
  async execute(): Promise<ExecutionResult> {
    try {
      const keytar = loadKeytar()
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
  // fallow-ignore-next-line unused-class-member
  async executeSteamOnly(): Promise<ExecutionResult> {
    try {
      const keytar = loadKeytar()
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
  notes?: string
  order?: number
  updateAvailable?: boolean
  lastUpdateCheck?: number
}

interface Config {
  compatdataPaths: string[]
  steamApps: Game[]
  startMinimized?: boolean
}

// ##############
// Exports
// ##############

export { SteamStarter, Game, Config, loadKeytar }
