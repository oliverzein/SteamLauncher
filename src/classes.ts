import { spawn, ChildProcess } from 'child_process'

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
          stdio: 'inherit'
        })
        console.log(`Started executable: ${this.executablePath} with args: ${this.executableArgs.join(' ')}`)
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
  password: string
  steamID?: number

  constructor(user: string, password: string, steamID: number | null, executablePath: string) {
    const executableArgs: string[] = ['-login', user, password]
    if (steamID != null) {
      executableArgs.push('-applaunch', steamID.toString())
    }
    super(executablePath, executableArgs)
    this.user = user
    this.password = password
    if (steamID != null) {
      this.steamID = steamID
    }
  }
}

export { AppStarter, SteamStarter, ExecutionResult, AppConfig }
