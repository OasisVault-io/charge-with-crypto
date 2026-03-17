import { existsSync, readFileSync } from 'node:fs'
import {
  type IncomingMessage,
  type OutgoingHttpHeaders,
  type ServerResponse,
} from 'node:http'
import { extname } from 'node:path'

const mimeByExt: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
}

function sendJson(
  res: ServerResponse,
  statusCode: number,
  data: unknown,
  headers: OutgoingHttpHeaders = {},
): void {
  const body = JSON.stringify(data)
  res.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
    ...headers,
  })
  res.end(body)
}

function sendText(res: ServerResponse, statusCode: number, text: string): void {
  res.writeHead(statusCode, { 'content-type': 'text/plain; charset=utf-8' })
  res.end(text)
}

function sendFile(res: ServerResponse, filePath: string): boolean {
  if (!existsSync(filePath)) return false
  const ext = extname(filePath).toLowerCase()
  const mime = mimeByExt[ext] || 'application/octet-stream'
  const content = readFileSync(filePath)
  res.writeHead(200, {
    'content-type': mime,
    'content-length': content.length,
    'cache-control': ext === '.html' ? 'no-store' : 'public, max-age=3600',
  })
  res.end(content)
  return true
}

function parseJsonBody<T = Record<string, unknown>>(
  req: IncomingMessage,
  { maxBytes = 262144 }: { maxBytes?: number } = {},
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const chunks: Buffer[] = []
    let total = 0
    let done = false
    const fail = (err: Error) => {
      if (done) return
      done = true
      reject(err)
      req.destroy()
    }
    req.on('data', (chunk) => {
      if (done) return
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      total += buffer.length
      if (total > maxBytes) {
        fail(new Error('Request body too large'))
        return
      }
      chunks.push(buffer)
    })
    req.on('end', () => {
      if (done) return
      const raw = Buffer.concat(chunks).toString('utf8')
      if (!raw) return resolve({} as T)
      try {
        done = true
        resolve(JSON.parse(raw) as T)
      } catch {
        reject(new Error('Invalid JSON body'))
      }
    })
    req.on('error', (err: Error) => {
      if (done) return
      reject(err)
    })
  })
}

export { sendJson, sendText, sendFile, parseJsonBody }
