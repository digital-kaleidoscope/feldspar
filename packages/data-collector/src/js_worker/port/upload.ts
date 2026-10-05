// Sending a donation in pieces (docs/data-donation-upload-plan.md in kaleidoscope-internal-ops).
//
// Each piece is an ordinary Feldspar donate command, keyed `donation/<id>/<category>/<index>`,
// and the manifest goes last as `donation/<id>/manifest`. Feldspar hands donate commands to the
// host without waiting, so the host reports each upload's outcome back over a BroadcastChannel
// named after the donation (see src/host/upload_host.ts). At most `window` pieces are awaiting
// that report at once, which bounds memory however large the donation is. A piece that fails
// is sent again (same key, so the server stores it once); after `attempts` failures in a row the
// participant is asked whether to keep trying. The donation is complete only once the host
// confirms the manifest.

import { parseChoices, type Category } from './category'
import { donate, type Command, type Payload } from './props'

export interface UploadOptions {
  platform: string
  // Which script produced the data, recorded in the manifest.
  script: string
  maxPieceChars?: number
  window?: number
  attempts?: number
  ackTimeoutMs?: number
}

export interface UploadPages {
  progress: (percent: number) => Command
  // Asks whether to keep trying; PayloadTrue means yes.
  failed: () => Command
}

type Ack = { ok: true } | { ok: false, error: string }

export const ackChannelName = (donationId: string): string => `feldspar-upload-${donationId}`

class AckChannel {
  private readonly channel: BroadcastChannel
  private readonly waiting = new Map<string, (ack: Ack) => void>()

  constructor (donationId: string) {
    this.channel = new BroadcastChannel(ackChannelName(donationId))
    this.channel.onmessage = (event: MessageEvent<{ key: string } & Ack>) => {
      const { key, ...ack } = event.data
      this.waiting.get(key)?.(ack)
      this.waiting.delete(key)
    }
  }

  // Register before sending, so a quick answer isn't missed. A resend replaces the wait.
  expect (key: string, timeoutMs: number): Promise<Ack> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        if (this.waiting.get(key) === done) this.waiting.delete(key)
        resolve({ ok: false, error: 'no answer from the host' })
      }, timeoutMs)
      const done = (ack: Ack): void => { clearTimeout(timer); resolve(ack) }
      this.waiting.set(key, done)
    })
  }

  close (): void {
    this.channel.close()
  }
}

interface Piece { key: string, body: string, rows: number, ack: Promise<Ack>, failures: number }

// Sends the donation; returns whether the host confirmed all of it.
export async function * uploadDonation (
  categories: Category[],
  choicesJson: string,
  { platform, script, maxPieceChars = 4_000_000, window = 2, attempts = 3, ackTimeoutMs = 60_000 }: UploadOptions,
  pages: UploadPages
): AsyncGenerator<Command, boolean, Payload> {
  const donationId = crypto.randomUUID()
  const choices = parseChoices(categories, choicesJson)
  const channel = new AckChannel(donationId)
  const envelope = (fields: Record<string, unknown>): string =>
    JSON.stringify({ donation_id: donationId, platform, ...fields })

  const summaries = new Map(categories.map((c) => [c.id, c.summary(choices.get(c.id) ?? { included: true, deleted: [] })]))
  const totalRows = [...summaries.values()].reduce((sum, s) => sum + s.donated_rows, 0)
  const pieceCounts = new Map<string, number>()
  let sentRows = 0
  let shown = -1
  const percent = (): number => (totalRows === 0 ? 100 : Math.floor(100 * sentRows / totalRows))

  function send (key: string, body: string, rows: number): { command: Command, piece: Piece } {
    const piece = { key, body, rows, ack: channel.expect(key, ackTimeoutMs), failures: 0 }
    return { command: donate(key, body), piece }
  }

  // Wait for one piece's outcome, resending it as needed. False if the participant gives up.
  async function * settle (piece: Piece): AsyncGenerator<Command, boolean, Payload> {
    while (true) {
      const ack = await piece.ack
      if (ack.ok) return true
      piece.failures++
      if (piece.failures >= attempts) {
        const answer = yield pages.failed()
        if (answer.__type__ !== 'PayloadTrue') return false
        piece.failures = 0
        shown = percent()
        yield pages.progress(shown) // back from the question to the progress page
      } else {
        await new Promise((resolve) => setTimeout(resolve, 500 * 2 ** piece.failures))
      }
      piece.ack = channel.expect(piece.key, ackTimeoutMs)
      yield donate(piece.key, piece.body)
    }
  }

  function * progress (): Generator<Command> {
    if (percent() !== shown) {
      shown = percent()
      yield pages.progress(shown)
    }
  }

  try {
    yield * progress()
    const inFlight: Piece[] = []
    for (const category of categories) {
      let index = 0
      for (const { json, rows } of category.pieces(choices.get(category.id) ?? { included: true, deleted: [] }, maxPieceChars)) {
        const key = `donation/${donationId}/${category.id}/${index}`
        // The rows are spliced in as already-serialized JSON rather than re-stringified.
        const body = envelope({ kind: 'piece', category: category.id, index }).slice(0, -1) + `,"rows":${json}}`
        const { command, piece } = send(key, body, rows)
        yield command
        inFlight.push(piece)
        index++
        while (inFlight.length >= window) {
          const oldest = inFlight.shift() as Piece
          if (!(yield * settle(oldest))) return false
          sentRows += oldest.rows
          yield * progress()
        }
      }
      pieceCounts.set(category.id, index)
    }
    while (inFlight.length > 0) {
      const oldest = inFlight.shift() as Piece
      if (!(yield * settle(oldest))) return false
      sentRows += oldest.rows
      yield * progress()
    }

    const manifest = envelope({
      kind: 'manifest',
      script,
      categories: Object.fromEntries(categories.map((c) => [c.id, { ...summaries.get(c.id), pieces: pieceCounts.get(c.id) ?? 0 }]))
    })
    const { command, piece } = send(`donation/${donationId}/manifest`, manifest, 0)
    yield command
    return yield * settle(piece)
  } finally {
    channel.close()
  }
}
