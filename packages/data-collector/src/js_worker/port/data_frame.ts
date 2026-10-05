// A minimal stand-in for the pandas DataFrame the Python scripts hand to consent tables.
// Only what the UI needs: named columns, rows, head(), and pandas' default to_json()
// shape ({column: {rowIndex: value}}), which TableFactory parses.

export type Cell = string | number | boolean | null

export class DataFrame {
  readonly columns: string[]
  readonly rows: Cell[][]

  constructor (rows: Array<Record<string, Cell>> | Cell[][], columns: string[]) {
    this.columns = columns
    this.rows = rows.map((row) =>
      Array.isArray(row) ? row : columns.map((column) => row[column] ?? null)
    )
  }

  get length (): number {
    return this.rows.length
  }

  head (n: number): DataFrame {
    return new DataFrame(this.rows.slice(0, n), this.columns)
  }

  // Equivalent of pandas DataFrame.to_json() with the default orient="columns".
  toJson (): string {
    const out: Record<string, Record<string, Cell>> = {}
    this.columns.forEach((column, c) => {
      const values: Record<string, Cell> = {}
      this.rows.forEach((row, r) => {
        const value = row[c]
        // pandas writes NaN/None as null
        values[r] = typeof value === 'number' && !Number.isFinite(value) ? null : value
      })
      out[column] = values
    })
    return JSON.stringify(out)
  }
}
