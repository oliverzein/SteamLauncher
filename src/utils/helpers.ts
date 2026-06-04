import { exec } from 'child_process'
import path from 'node:path'
import * as fs from 'fs'
import * as https from 'https'
import * as http from 'http'

export function waitForDevServer(urlStr: string, overallTimeoutMs = 10000, retryIntervalMs = 200): Promise<void> {
  return new Promise((resolve, reject) => {
    const start = Date.now()
    const attempt = () => {
      try {
        const u = new URL(urlStr)
        const getter = u.protocol === 'https:' ? https.get : http.get
        const req = getter(urlStr, (res) => {
          if (res.statusCode && res.statusCode < 500) {
            res.resume()
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

export function run(cmd: string): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    exec(cmd, (error, stdout, stderr) => {
      resolve({ code: error ? (error as { code?: number }).code ?? 1 : 0, stdout: stdout ?? '', stderr: stderr ?? '' })
    })
  })
}

export function buildPgrepCmd(raw: string): string {
  const name = path.basename(raw)
  const escaped = name.replace(/'/g, "'\\''")
  return `pgrep -fi '${escaped}'`
}

function resolveAsset(...segments: string[]): string {
  const devPath = path.join(__dirname, '..', '..', 'assets', ...segments)
  const prodPath = path.join(process.resourcesPath, 'assets', ...segments)
  return fs.existsSync(devPath) ? devPath : prodPath
}

export function getAppIconPath(): string | undefined {
  const pngPath = resolveAsset('app-icon.png')
  if (fs.existsSync(pngPath)) return pngPath
  const altPng = resolveAsset('icon.png')
  if (fs.existsSync(altPng)) return altPng
  return undefined
}
