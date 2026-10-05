// Progress while long work runs. A script can only show something by yielding a page, and
// it can't yield from inside a callback, so track() runs the work in the background and
// yields a progress page each time the reported percentage moves. Feldspar's progress
// prompt answers immediately, so this never waits on the participant.

import type { Command, Payload } from './props'

export type Report = (fraction: number) => void

export async function * track<T> (
  work: (report: Report) => Promise<T>,
  render: (percent: number) => Command
): AsyncGenerator<Command, T, Payload> {
  let latest = 0
  let shown = -1
  let finished = false
  let wake: (() => void) | null = null
  const nudge = (): void => { wake?.(); wake = null }

  const outcome = work((fraction) => {
    latest = Math.max(latest, Math.min(100, Math.floor(fraction * 100)))
    nudge()
  }).finally(() => { finished = true; nudge() })
  outcome.catch(() => {}) // rethrown below; don't report it as unhandled meanwhile

  while (!finished) {
    if (latest > shown) {
      shown = latest
      yield render(shown)
    } else {
      await new Promise<void>((resolve) => { wake = resolve })
    }
  }
  return await outcome
}

// Long reads can run without ever returning to the event loop, which holds back the
// progress pages track() is waiting to show. Await the returned function in such a loop:
// it gives the event loop a turn at most every `ms` milliseconds.
export function breather (ms = 50): () => Promise<void> {
  let last = Date.now()
  return async () => {
    if (Date.now() - last < ms) return
    await new Promise((resolve) => setTimeout(resolve, 0))
    last = Date.now()
  }
}
