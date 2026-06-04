import { app } from 'electron'
import path from 'node:path'
import * as fs from 'fs'
import { Config, Game } from '../classes'

class ConfigService {
  private config: Config = {
    compatdataPaths: ['~/.local/share/Steam/steamapps/compatdata/'],
    steamApps: [],
    startMinimized: false,
  }

  public getConfig(): Config {
    return this.config
  }

  public setConfig(newConfig: Config): void {
    this.config = newConfig
  }

  public loadConfig(): void {
    try {
      const configPath = path.join(app.getPath('userData'), 'config.json')
      if (fs.existsSync(configPath)) {
        const data = fs.readFileSync(configPath, 'utf8')
        const parsed = JSON.parse(data)
        if (parsed.compatdataPath && !parsed.compatdataPaths) {
          parsed.compatdataPaths = [parsed.compatdataPath]
          delete parsed.compatdataPath
        }
        this.config = { ...this.config, ...parsed }
        this.reindexGameOrders()
        this.saveConfig()
      }
    } catch (error) {
      console.error('Failed to load config:', error)
    }
  }

  public saveConfig(newConfig?: Partial<Config>): void {
    if (newConfig) {
      this.config = { ...this.config, ...newConfig }
    }
    try {
      const configPath = path.join(app.getPath('userData'), 'config.json')
      const sanitized = {
        ...this.config,
        steamApps: this.config.steamApps.map(g => ({
          name: g.name,
          icon: g.icon,
          user: g.user,
          steamID: g.steamID,
          hidden: g.hidden ?? false,
          processName: g.processName,
          resolution: g.resolution,
          notes: g.notes,
          order: typeof g.order === 'number' ? g.order : undefined,
          updateAvailable: g.updateAvailable,
          lastUpdateCheck: g.lastUpdateCheck,
        })),
      }
      fs.writeFileSync(configPath, JSON.stringify(sanitized, null, 2))
    } catch (error) {
      const VERBOSE = !!process.env.SL_VERBOSE
      if (VERBOSE) console.error('Failed to save config:', error)
    }
  }

  public compareByOrder = (a: Game, b: Game): number => {
    const ao = typeof a.order === 'number' ? a.order : Number.MAX_SAFE_INTEGER
    const bo = typeof b.order === 'number' ? b.order : Number.MAX_SAFE_INTEGER
    if (ao !== bo) return ao - bo
    return a.name.localeCompare(b.name)
  }

  public getNextOrderValue(): number {
    let max = -1
    for (const game of this.config.steamApps) {
      if (typeof game.order === 'number' && game.order > max) {
        max = game.order
      }
    }
    return max + 1
  }

  public reindexGameOrders(): void {
    const sorted = [...this.config.steamApps].sort(this.compareByOrder)
    sorted.forEach((game, index) => {
      game.order = index
    })
  }

  public getVisibleGamesSorted(): Game[] {
    return this.config.steamApps.filter(game => !game.hidden).sort(this.compareByOrder)
  }
}

export const configService = new ConfigService()
