// A stand-in host for the demo app (built with VITE_DEMO_HOST=1): it answers Feldspar's
// "app-loaded" with a bridge, and "uploads" donation pieces by checking and counting them,
// after a delay, failing some on purpose. Query parameters: ?latency=<ms> (default 30),
// ?failRate=<0..1> (default 0). What arrived is kept on window.demoHost for tests.

import { attachUploadHost } from './upload_host'

interface Received {
  pieces: Record<string, { pieces: number, rows: number, indexes: number[] }>
  duplicates: number
  maxPieceChars: number
  failuresInjected: number
  manifest: Record<string, unknown> | null
  donationIds: string[]
  errors: string[]
  exit: unknown
}

declare global {
  interface Window { demoHost: Received }
}

export function installDemoHost (): void {
  const params = new URLSearchParams(window.location.search)
  const latency = Number(params.get('latency') ?? 30)
  const failRate = Number(params.get('failRate') ?? 0)
  const received: Received = { pieces: {}, duplicates: 0, maxPieceChars: 0, failuresInjected: 0, manifest: null, donationIds: [], errors: [], exit: null }
  window.demoHost = received
  const stored = new Set<string>()

  const send = async (key: string, body: string): Promise<void> => {
    await new Promise((resolve) => setTimeout(resolve, latency))
    if (Math.random() < failRate) {
      received.failuresInjected++
      throw new Error('injected failure')
    }
    // Checked like the server would: valid JSON, matching key and envelope.
    const piece = JSON.parse(body)
    if (!received.donationIds.includes(piece.donation_id)) received.donationIds.push(piece.donation_id)
    if (!key.startsWith(`donation/${piece.donation_id}/`)) received.errors.push(`key/envelope mismatch: ${key}`)
    if (stored.has(key)) { received.duplicates++; return } // a resend of something stored: store once
    stored.add(key)
    if (piece.kind === 'manifest') {
      received.manifest = piece
      return
    }
    received.maxPieceChars = Math.max(received.maxPieceChars, body.length)
    const tally = received.pieces[piece.category] ??= { pieces: 0, rows: 0, indexes: [] }
    tally.pieces++
    tally.rows += piece.rows.length
    tally.indexes.push(piece.index)
  }

  let attached = false
  window.addEventListener('message', (event) => {
    if (event.data?.action !== 'app-loaded' || attached) return
    attached = true
    const channel = new MessageChannel()
    attachUploadHost(channel.port1, send, (command) => {
      if ((command as { __type__?: string })?.__type__ === 'CommandSystemExit') received.exit = command
    })
    window.postMessage({ action: 'live-init', locale: 'en' }, '*', [channel.port2])
  })
}
