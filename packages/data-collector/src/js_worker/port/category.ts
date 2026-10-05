// A category is one kind of data a script extracts (watch history, searches, ...). Its rows
// stay in the worker. The consent page gets a summary with example rows; participants can
// exclude the whole category, or page through and search its rows (served over a
// RowChannel) and delete individual ones. The page reports back only those choices, and the
// donation is built from the worker's own copy of the rows (see upload.ts).

import type { Cell } from './data_frame'
import type { Translatable } from './props'

export interface CategoryOptions {
  description?: Translatable
  // Summary line; {count}, {from} and {to} are filled in by the page. Without it, a
  // generic "{count} entries between {from} and {to}" is shown.
  summary?: Translatable
  // Display labels per column; donated rows keep the column names.
  headers?: Record<string, Translatable>
  // Column whose earliest and latest values make the summary's date range. Values must
  // sort chronologically as strings (TikTok's "YYYY-MM-DD hh:mm:ss" does).
  dateColumn?: string
  examples?: number
}

export interface RowView { id: number, cells: Cell[] }

export interface Choice { included: boolean, deleted: number[] }

export class Category {
  readonly options: CategoryOptions

  constructor (
    readonly id: string,
    readonly title: Translatable,
    readonly columns: string[],
    readonly rows: Cell[][],
    options: CategoryOptions = {}
  ) {
    this.options = options
    if (options.dateColumn !== undefined && !columns.includes(options.dateColumn)) {
      throw new Error(`Category ${id}: dateColumn ${options.dateColumn} is not a column`)
    }
  }

  dateRange (): { from: string, to: string } | null {
    const c = this.options.dateColumn === undefined ? -1 : this.columns.indexOf(this.options.dateColumn)
    if (c < 0) return null
    let from: string | null = null
    let to: string | null = null
    for (const row of this.rows) {
      const value = row[c]
      if (typeof value !== 'string' || value === '') continue
      if (from === null || value < from) from = value
      if (to === null || value > to) to = value
    }
    return from !== null && to !== null ? { from, to } : null
  }

  // Evenly spread across the data (first, ..., last), so examples show its whole span.
  examples (): RowView[] {
    const n = Math.min(this.options.examples ?? 3, this.rows.length)
    if (n === 0) return []
    const ids = n === 1 ? [0] : Array.from({ length: n }, (_, i) => Math.round(i * (this.rows.length - 1) / (n - 1)))
    return [...new Set(ids)].map((id) => ({ id, cells: this.rows[id] }))
  }

  // Row ids matching a search, cached so paging through results doesn't rescan.
  private lastSearch: { query: string, ids: number[] | null } = { query: '', ids: null }

  page (offset: number, limit: number, search = ''): { total: number, rows: RowView[] } {
    const query = search.trim().toLowerCase()
    if (query === '') {
      const rows = this.rows.slice(offset, offset + limit).map((cells, i) => ({ id: offset + i, cells }))
      return { total: this.rows.length, rows }
    }
    if (this.lastSearch.query !== query || this.lastSearch.ids === null) {
      const ids: number[] = []
      this.rows.forEach((row, id) => {
        if (row.some((cell) => cell !== null && String(cell).toLowerCase().includes(query))) ids.push(id)
      })
      this.lastSearch = { query, ids }
    }
    const ids = this.lastSearch.ids ?? []
    return { total: ids.length, rows: ids.slice(offset, offset + limit).map((id) => ({ id, cells: this.rows[id] })) }
  }

  // Rows the participant left in, as JSON arrays of {column: value} records, each at most about
  // `maxChars` long (a single larger row gets an array of its own). Written straight from the
  // rows, a batch at a time, so a large category never exists as one string.
  * pieces ({ included, deleted }: Choice, maxChars: number): Generator<{ json: string, rows: number }> {
    if (!included) return
    const removed = this.validIds(deleted)
    const keys = this.columns.map((column) => JSON.stringify(column) + ':')
    const cells: string[] = new Array(keys.length)
    let batch: string[] = []
    let chars = 2
    for (let id = 0; id < this.rows.length; id++) {
      if (removed.has(id)) continue
      const row = this.rows[id]
      for (let c = 0; c < keys.length; c++) cells[c] = keys[c] + JSON.stringify(row[c] ?? null)
      const record = '{' + cells.join(',') + '}'
      if (batch.length > 0 && chars + record.length + 1 > maxChars) {
        yield { json: '[' + batch.join(',') + ']', rows: batch.length }
        batch = []
        chars = 2
      }
      batch.push(record)
      chars += record.length + 1
    }
    if (batch.length > 0) yield { json: '[' + batch.join(',') + ']', rows: batch.length }
  }

  // What the participant chose, as counts.
  summary ({ included, deleted }: Choice): { included: boolean, total_rows: number, deleted_rows: number, donated_rows: number } {
    const removed = included ? this.validIds(deleted).size : 0
    return { included, total_rows: this.rows.length, deleted_rows: removed, donated_rows: included ? this.rows.length - removed : 0 }
  }

  private validIds (ids: number[]): Set<number> {
    return new Set(ids.filter((id) => Number.isInteger(id) && id >= 0 && id < this.rows.length))
  }
}

// Participants' choices come back from the page as JSON; anything missing or malformed falls
// back to "included, nothing deleted", the state the page starts in.
export function parseChoices (categories: Category[], choicesJson: string): Map<string, Choice> {
  let raw: Record<string, Partial<Choice>> = {}
  try {
    const parsed = JSON.parse(choicesJson)
    if (parsed !== null && typeof parsed === 'object') raw = parsed
  } catch {}
  return new Map(categories.map((category) => {
    const choice = raw[category.id] ?? {}
    return [category.id, { included: choice.included !== false, deleted: Array.isArray(choice.deleted) ? choice.deleted : [] }]
  }))
}
