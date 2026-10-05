// Reading an uploaded export, whether it is the JSON itself or a zip containing it.
//
// Two ways to parse, with the same result:
// - whole: the browser's JSON.parse. Fastest, but holds the whole file and everything in it
//   (a ~300 MB TikTok export: about 1.2 GiB).
// - streamed: only the paths a script declares are kept, and items of declared lists are
//   turned into rows as they are parsed. Memory grows with what the script keeps rather than
//   with the file, at roughly twice the time.
// Streaming is used when the file is large and the device's memory doesn't comfortably fit a
// whole parse (or the browser doesn't say how much it has).

import { JSONParser } from '@streamparser/json'
import type { Cell } from './data_frame'
import { breather, type Report } from './progress'
import { SafeData } from './safe_data'
import { Zip } from './zip'

// A list-shaped part of the export, turned into rows item by item.
export interface ListSpec {
  // Candidate locations, tried in order: the first holding any rows wins.
  paths: string[][]
  // The row for one item, or null to skip it.
  row: (item: unknown) => Cell[] | null
}

export interface ReadJsonOptions {
  // In a zip, which entry is the export.
  pick: (name: string) => boolean
  // Other paths the script reads (literal key segments); everything else is skipped when streaming.
  paths: string[][]
  lists: ListSpec[]
  // Force a mode (tests, benchmarks); otherwise chosen by size and device memory.
  mode?: 'whole' | 'stream'
}

export interface ParsedExport {
  // The export (pruned to `paths` when streamed).
  data: SafeData
  // Rows of each ListSpec, in order.
  rows: Cell[][][]
}

const MIN_STREAM_BYTES = 50 * 1024 * 1024
// A whole parse peaks at about four times the file size; allow it a quarter of device memory.
const WHOLE_PARSE_FACTOR = 4
const DEVICE_SHARE = 0.25

export function shouldStream (bytes: number, deviceMemoryGiB: number | undefined = (self.navigator as { deviceMemory?: number } | undefined)?.deviceMemory): boolean {
  if (bytes <= MIN_STREAM_BYTES) return false
  // Only Chromium browsers report device memory (rounded, at most 8 GiB). Without it, play safe.
  if (deviceMemoryGiB === undefined) return true
  return bytes * WHOLE_PARSE_FACTOR > deviceMemoryGiB * 2 ** 30 * DEVICE_SHARE
}

const isZip = async (file: Blob): Promise<boolean> => {
  const magic = new Uint8Array(await file.slice(0, 4).arrayBuffer())
  return magic[0] === 0x50 && magic[1] === 0x4b && (magic[2] === 3 || magic[2] === 5) // "PK\x03\x04" or empty "PK\x05\x06"
}

// Rejects if the file isn't readable JSON (or a zip with a matching entry).
export async function readJson (file: Blob, options: ReadJsonOptions, report: Report = () => {}): Promise<ParsedExport> {
  const stream = (bytes: number): boolean => options.mode === 'stream' || (options.mode === undefined && shouldStream(bytes))
  if (await isZip(file)) {
    const zip = await Zip.open(file)
    try {
      const name = zip.namelist().find(options.pick)
      if (name === undefined) throw new Error('No matching JSON file in the zip')
      if (stream(zip.size(name))) {
        const parser = streamingParser(options)
        await zip.readStream(name, (chunk) => parser.write(chunk), report)
        return parser.result()
      }
      return parseWhole(await zip.readText(name, report), options)
    } finally {
      await zip.close()
    }
  }
  if (stream(file.size)) {
    const parser = streamingParser(options)
    await readChunks(file, (chunk) => parser.write(chunk), report)
    return parser.result()
  }
  const decoder = new TextDecoder('utf-8')
  const parts: string[] = []
  await readChunks(file, (chunk) => { parts.push(decoder.decode(chunk, { stream: true })) }, report)
  parts.push(decoder.decode())
  return parseWhole(parts.join(''), options)
}

async function readChunks (file: Blob, onChunk: (chunk: Uint8Array) => void, report: Report): Promise<void> {
  const reader = file.stream().getReader()
  let read = 0
  const breathe = breather()
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    onChunk(value)
    read += value.byteLength
    report(file.size > 0 ? read / file.size : 1)
    await breathe()
  }
}

function parseWhole (text: string, { lists }: ReadJsonOptions): ParsedExport {
  const data = SafeData.parseJson(text)
  if (data.hadErrors()) throw new Error('Not valid JSON')
  const rows = lists.map(({ paths, row }) => {
    for (const path of paths) {
      const node = SafeData.wrap(data.raw()).getList([path]).raw()
      if (!Array.isArray(node)) continue
      const out = rowsOf(node, row)
      if (out.length > 0) return out
    }
    return []
  })
  return { data, rows }
}

function rowsOf (items: unknown[], row: ListSpec['row']): Cell[][] {
  const out: Cell[][] = []
  for (const item of items) {
    const cells = row(item)
    if (cells !== null) out.push(cells)
  }
  return out
}

// Streams JSON, keeping only the selected paths (rebuilt at the same place in a new document)
// and the rows of the declared lists.
function streamingParser ({ paths, lists }: ReadJsonOptions): { write: (chunk: Uint8Array) => void, result: () => ParsedExport } {
  const selected = outermost(paths)
  const listPaths = lists.flatMap((spec, s) => spec.paths.map((path, c) => ({ path, s, c })))
  for (const path of [...selected, ...listPaths.map((l) => l.path)]) {
    if (path.some((key) => key.includes('.') || key === '*' || key === '')) throw new Error(`Can't stream path ${JSON.stringify(path)}`)
  }
  const document: Record<string, unknown> = {}
  // Rows per list spec and candidate path; the first candidate with rows wins at the end.
  const collected: Cell[][][][] = lists.map((spec) => spec.paths.map(() => []))
  // Keyed by the path joined with NUL, which can't occur in a JSON key we stream (checked above
  // for '.', and NUL would be an escaped character in any real export key).
  const listAt = new Map(listPaths.map(({ path, s, c }) => [path.join('\0'), { s, c }]))
  let failure: unknown = null

  const parser = new JSONParser({
    paths: [...selected.map((path) => '$.' + path.join('.')), ...listPaths.map(({ path }) => '$.' + path.join('.') + '.*')],
    keepStack: false
  })
  parser.onValue = ({ value, key, stack }) => {
    // Called for every list item (millions), so the lookup key is built as cheaply as possible.
    if (typeof key === 'number') {
      let joined = String(stack[1]?.key)
      for (let i = 2; i < stack.length; i++) joined += '\0' + String(stack[i].key)
      const list = listAt.get(joined)
      if (list !== undefined) {
        const cells = lists[list.s].row(value)
        if (cells !== null) collected[list.s][list.c].push(cells)
        return
      }
    }
    const keys = [...stack.slice(1).map((entry) => String(entry.key)), String(key)]
    let node = document
    for (const k of keys.slice(0, -1)) {
      if (typeof node[k] !== 'object' || node[k] === null) node[k] = {}
      node = node[k] as Record<string, unknown>
    }
    node[keys[keys.length - 1]] = value
  }
  parser.onError = (error) => { failure = error }
  return {
    write: (chunk) => {
      if (failure !== null) return
      try { parser.write(chunk) } catch (error) { failure = error }
    },
    result: () => {
      // A broken or truncated file is an error even if some paths matched before it broke.
      if (failure !== null) throw new Error(`Not valid JSON: ${String(failure)}`)
      if (!parser.isEnded) throw new Error('Not valid JSON: the file ends early')
      return {
        data: SafeData.wrap(document),
        rows: collected.map((candidates) => candidates.find((rows) => rows.length > 0) ?? [])
      }
    }
  }
}

// Drop paths inside other selected paths: with keepStack off, the parser hands an inner match
// to us and removes it from its parent, so selecting both would lose the inner one.
function outermost (paths: string[][]): string[][] {
  const unique = [...new Map(paths.map((path) => [JSON.stringify(path), path])).values()]
  return unique.filter((path) => !unique.some((other) => other.length < path.length && other.every((key, i) => key === path[i])))
}
