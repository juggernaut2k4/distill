/**
 * AUD-01: Custom Next.js server with WebSocket support for audio relay mode.
 *
 * Only needed when MEETING_BOT_AUDIO_MODE=relay. Adds a WebSocket upgrade
 * handler at /api/audio-relay — all other requests pass through to Next.js.
 *
 * Browser mode: use `next dev` / `next start` as normal (Vercel compatible).
 * Relay mode:   use `npm run dev:relay` / `npm run start:relay` (requires
 *               a persistent server — Railway, Render, fly.io, or any VPS).
 */

import { createServer } from 'http'
import { parse } from 'url'
import next from 'next'
import { WebSocketServer } from 'ws'
import { handleAudioRelay } from './lib/voice/relay-handler'

const dev = process.env.NODE_ENV !== 'production'
const port = parseInt(process.env.PORT ?? '3000', 10)

const app = next({ dev })
const handle = app.getRequestHandler()

app.prepare().then(() => {
  const httpServer = createServer((req, res) => {
    const parsedUrl = parse(req.url!, true)
    handle(req, res, parsedUrl)
  })

  // WebSocket server — handles inbound Attendee audio connections
  const wss = new WebSocketServer({ noServer: true })

  httpServer.on('upgrade', (req, socket, head) => {
    const { pathname } = parse(req.url ?? '', true)

    if (pathname === '/api/audio-relay') {
      wss.handleUpgrade(req, socket, head, (ws) => {
        // handleAudioRelay is async — fire-and-forget; errors are caught inside
        handleAudioRelay(ws, req).catch((err: unknown) => {
          console.error('[server] Unhandled relay error:', err)
          if (ws.readyState === ws.OPEN) ws.close(1011, 'Internal relay error')
        })
      })
    } else {
      // Not our WebSocket path — reject upgrade
      socket.write('HTTP/1.1 404 Not Found\r\n\r\n')
      socket.destroy()
    }
  })

  httpServer.listen(port, () => {
    console.log(`> Custom server ready on http://localhost:${port} (relay mode)`)
    console.log(`> Audio relay endpoint: ws://localhost:${port}/api/audio-relay`)
  })
})
