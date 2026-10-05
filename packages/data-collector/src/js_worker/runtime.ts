// JavaScript replacement for public/py_worker.js. It speaks the same message protocol to
// WorkerProcessingEngine (initialise / firstRunCycle / nextRunCycle in; initialiseDone /
// runCycleDone / error / workerLog out), so the framework is unchanged. A worker entry
// point calls runScript() with its donation flow.

import type { Command, Payload, Script, ScriptContext } from './port/props'
import { SafeData } from './port/safe_data'

type LogLevel = 'debug' | 'info' | 'warn' | 'error'

// Logs go to the engine's logger, which forwards them to the host like Python's logging does.
export const logger = Object.fromEntries(
  (['debug', 'info', 'warn', 'error'] as LogLevel[]).map((level) => [
    level,
    (message: string) => self.postMessage({ eventType: 'workerLog', level, message })
  ])
) as Record<LogLevel, (message: string) => void>

SafeData.setErrorHook((path, expected, actual, reason) => {
  const shown = JSON.stringify(actual) ?? String(actual)
  logger.warn(`safedata: ${path || '<root>'} expected ${expected}, got ${shown.length > 80 ? shown.slice(0, 77) + '...' : shown} (${reason})`)
})

const payloadDecoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true })

export function runScript (script: Script): void {
  let flow: AsyncGenerator<Command, void, Payload>

  async function runCycle (payload: Payload | undefined): Promise<void> {
    try {
      // The first next() starts the flow; its argument is discarded, as in Python.
      const { value, done } = await flow.next(payload as Payload)
      const command: Command = done === true ? { __type__: 'CommandSystemExit', code: 0, info: 'End of script' } : value
      self.postMessage({ eventType: 'runCycleDone', scriptEvent: command })
    } catch (error) {
      self.postMessage({
        eventType: 'error',
        error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
        stack: error instanceof Error ? error.stack ?? '' : ''
      })
    }
  }

  self.onmessage = (event: MessageEvent) => {
    const { eventType } = event.data
    switch (eventType) {
      case 'initialise':
        // Nothing to load: this is where Pyodide would download and boot.
        self.postMessage({ eventType: 'initialiseDone' })
        break

      case 'firstRunCycle':
        flow = script(event.data.data as ScriptContext)
        void runCycle(undefined)
        break

      case 'nextRunCycle': {
        // The engine transfers string payloads as UTF-8 bytes.
        const { payload } = event.data
        if (payload.value instanceof Uint8Array) payload.value = payloadDecoder.decode(payload.value)
        void runCycle(payload)
        break
      }

      default:
        logger.warn(`[JsWorker] Received unsupported event: ${eventType}`)
    }
  }
}
