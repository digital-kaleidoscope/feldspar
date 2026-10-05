// Random-access zip reading straight from the participant's File: only the central
// directory and the entries a script asks for are read, and decompression uses the
// browser's native DecompressionStream. Nothing is copied into a virtual filesystem.

import { breather } from './progress'
import { BlobReader, TextWriter, Uint8ArrayWriter, ZipReader, configure, type Entry, type FileEntry } from '@zip.js/zip.js'

// We already run inside a worker; zip.js should not spawn more.
configure({ useWebWorkers: false })

export interface ZipInfo {
  filename: string
  compressedSize: number
  size: number
  directory: boolean
}

// zip.js awaits its progress callback, so it doubles as the place to let progress pages through.
function progressWithBreaks (report: (fraction: number) => void): (loaded: number, total: number) => Promise<void> {
  const breathe = breather()
  return async (loaded, total) => {
    report(total > 0 ? loaded / total : 1)
    await breathe()
  }
}

export class Zip {
  private constructor (
    private readonly reader: ZipReader<Blob>,
    private readonly entries: Entry[]
  ) {}

  // Rejects (like Python's zipfile.BadZipFile) if the file is not a readable zip.
  static async open (file: Blob): Promise<Zip> {
    const reader = new ZipReader(new BlobReader(file))
    return new Zip(reader, await reader.getEntries())
  }

  // Like zipfile.infolist(): every entry, directories included, in archive order.
  infolist (): ZipInfo[] {
    return this.entries.map((entry) => ({
      filename: entry.filename,
      compressedSize: entry.compressedSize,
      size: entry.uncompressedSize,
      directory: entry.directory
    }))
  }

  namelist (): string[] {
    return this.entries.map((entry) => entry.filename)
  }

  private file (name: string): FileEntry {
    const entry = this.entries.find((e) => e.filename === name)
    if (entry === undefined || entry.directory) throw new Error(`No file named ${name} in zip`)
    return entry
  }

  async readText (name: string, report?: (fraction: number) => void): Promise<string> {
    return await this.file(name).getData(new TextWriter(), {
      onprogress: report && progressWithBreaks(report)
    })
  }

  // Uncompressed size of an entry.
  size (name: string): number {
    return this.file(name).uncompressedSize
  }

  // Decompress an entry chunk by chunk, without holding all of it.
  async readStream (name: string, onChunk: (chunk: Uint8Array) => void, report?: (fraction: number) => void): Promise<void> {
    await this.file(name).getData(new WritableStream<Uint8Array>({ write: (chunk) => onChunk(chunk) }), {
      onprogress: report && progressWithBreaks(report)
    })
  }

  async readBytes (name: string): Promise<Uint8Array> {
    return await this.file(name).getData(new Uint8ArrayWriter())
  }

  async close (): Promise<void> {
    await this.reader.close()
  }
}
