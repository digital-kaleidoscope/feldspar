// Port of packages/python/port/safe_data.py: crash-resistant typed access to parsed JSON.
//
// Every getter takes one path or a list of candidate paths and returns the first that
// coerces to the requested type; if none does, it records one error and returns the
// default. Nothing throws, so an unexpected export shape degrades into had-errors rows
// instead of a failed donation. Differences from Python, all due to JSON in JS having a
// single number type: getInt accepts any integral number (Python rejects 3.0 in lists),
// and getStr renders 1.0 as "1".
//
// A path is a dotted string ("user.name", "items.0.id") or an array of literal segments
// (["user.name"] is one key containing a dot). To pass several candidates, pass an array
// of paths: getStr(["user.name", "account.fullName"]).

export type Path = string | readonly string[]
export type Candidates = string | readonly Path[]
type ErrorRecord = [path: string, expected: string, actual: unknown, reason: string]
type ErrorHook = (...error: ErrorRecord) => void

interface Root { errors: ErrorRecord[] }

type Coerce = (value: unknown) => [true, unknown] | [false]

let errorHook: ErrorHook | null = null

const isDict = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

export class SafeData {
  private constructor (
    private readonly _raw: unknown,
    private readonly _path: string,
    private readonly root: Root,
    private readonly poisoned = false
  ) {}

  static setErrorHook (hook: ErrorHook | null): void {
    errorHook = hook
  }

  // Parse JSON text or bytes. Malformed input yields an empty SafeData with hadErrors().
  static parseJson (source: string | Uint8Array): SafeData {
    const root: Root = { errors: [] }
    try {
      const text = typeof source === 'string' ? source : new TextDecoder().decode(source)
      return new SafeData(JSON.parse(text), '', root)
    } catch (error) {
      const record: ErrorRecord = ['', 'json', '<source>', `parse failed: ${String(error)}`]
      root.errors.push(record)
      errorHook?.(...record)
      return new SafeData(null, '', root, true)
    }
  }

  static wrap (obj: unknown): SafeData {
    return new SafeData(obj, '', { errors: [] })
  }

  raw (): unknown {
    return this._raw
  }

  get path (): string {
    return this._path
  }

  hadErrors (): boolean {
    return this.root.errors.length > 0
  }

  getErrors (): ErrorRecord[] {
    return [...this.root.errors]
  }

  // Iterate a list node: one SafeData per element.
  * [Symbol.iterator] (): Iterator<SafeData> {
    if (!Array.isArray(this._raw)) return
    for (let i = 0; i < this._raw.length; i++) {
      yield new SafeData(this._raw[i], join(this._path, String(i)), this.root)
    }
  }

  get length (): number {
    if (Array.isArray(this._raw)) return this._raw.length
    if (isDict(this._raw)) return Object.keys(this._raw).length
    return 0
  }

  getStr (keys?: Candidates, fallback = ''): string {
    return this.resolveScalar(keys, 'str', coerceStr, fallback) as string
  }

  getInt (keys?: Candidates, fallback = 0): number {
    return this.resolveScalar(keys, 'int', coerceInt, fallback) as number
  }

  getFloat (keys?: Candidates, fallback = 0): number {
    return this.resolveScalar(keys, 'float', coerceFloat, fallback) as number
  }

  getBool (keys?: Candidates, fallback = false): boolean {
    return this.resolveScalar(keys, 'bool', coerceBool, fallback) as boolean
  }

  // A list node, for polymorphic lists; iterate it for one SafeData per element.
  getList (keys?: Candidates, fallback?: SafeData): SafeData {
    return this.resolveContainer(keys, 'list', Array.isArray, [], fallback)
  }

  getDict (keys?: Candidates, fallback?: SafeData): SafeData {
    return this.resolveContainer(keys, 'dict', isDict, {}, fallback)
  }

  // A homogeneous list; elements of the wrong type are dropped and each drop recorded.
  getListOf (type: 'SafeData', key?: Path, fallback?: SafeData[]): SafeData[]
  getListOf (type: 'str', key?: Path, fallback?: string[]): string[]
  getListOf (type: 'int' | 'float', key?: Path, fallback?: number[]): number[]
  getListOf (type: 'bool', key?: Path, fallback?: boolean[]): boolean[]
  getListOf (type: 'str' | 'int' | 'float' | 'bool' | 'SafeData', key?: Path, fallback: unknown[] = []): unknown[] {
    let container: unknown = this._raw
    let fullPath = this._path
    if (key !== undefined) {
      const [ok, value, path] = this.navigate(key)
      fullPath = path
      if (!ok) {
        this.error(fullPath, 'list', null, 'missing or unreachable')
        return [...fallback]
      }
      container = value
    }
    if (!Array.isArray(container)) {
      this.error(fullPath, 'list', container, 'not a list')
      return [...fallback]
    }
    const out: unknown[] = []
    container.forEach((element, i) => {
      const elementPath = fullPath ? `${fullPath}[${i}]` : `[${i}]`
      if (type === 'SafeData') {
        if (isDict(element)) out.push(new SafeData(element, join(fullPath, String(i)), this.root))
        else this.error(elementPath, 'SafeData', element, 'element is not a dict')
      } else if (type === 'bool') {
        if (typeof element === 'boolean') out.push(element)
        else this.error(elementPath, 'bool', element, 'element is not a bool')
      } else if (typeof element === 'boolean') {
        this.error(elementPath, type, element, 'bool not accepted for this list type')
      } else if (
        (type === 'int' && Number.isInteger(element)) ||
        (type === 'float' && typeof element === 'number') ||
        (type === 'str' && typeof element === 'string')
      ) {
        out.push(element)
      } else {
        this.error(elementPath, type, element, 'element type mismatch')
      }
    })
    return out
  }

  // Internals

  private candidates (keys?: Candidates): Array<Path | null> {
    if (keys === undefined) return [null]
    return typeof keys === 'string' ? [keys] : [...keys]
  }

  private resolveScalar (keys: Candidates | undefined, expected: string, coerce: Coerce, fallback: unknown): unknown {
    const candidates = this.candidates(keys)
    let lastValue: unknown = null
    let lastPath = this._path
    for (const key of candidates) {
      const [ok, value, path] = key === null ? [true, this._raw, this._path] as const : this.navigate(key)
      lastValue = value
      lastPath = path
      if (!ok) continue
      const result = coerce(value)
      if (result[0]) return result[1]
    }
    const [errorPath, reason] = this.coalesceErrorInfo(candidates, lastPath)
    this.error(errorPath, expected, lastValue, reason)
    return fallback
  }

  private resolveContainer (
    keys: Candidates | undefined,
    expected: string,
    test: (value: unknown) => boolean,
    empty: unknown,
    fallback?: SafeData
  ): SafeData {
    const candidates = this.candidates(keys)
    let lastValue: unknown = null
    let lastPath = this._path
    for (const key of candidates) {
      const [ok, value, path] = key === null ? [true, this._raw, this._path] as const : this.navigate(key)
      lastValue = value
      lastPath = path
      if (ok && test(value)) return new SafeData(value, path, this.root)
    }
    const [errorPath, reason] = this.coalesceErrorInfo(candidates, lastPath)
    this.error(errorPath, expected, lastValue, reason)
    return fallback ?? new SafeData(empty, errorPath, this.root, true)
  }

  private navigate (key: Path): [ok: boolean, value: unknown, path: string] {
    let node: unknown = this._raw
    let fullPath = this._path
    for (const segment of typeof key === 'string' ? key.split('.') : key) {
      fullPath = join(fullPath, segment)
      if (isDict(node) && Object.prototype.hasOwnProperty.call(node, segment)) {
        node = node[segment]
      } else if (Array.isArray(node) && /^\d+$/.test(segment) && Number(segment) < node.length) {
        node = node[Number(segment)]
      } else {
        return [false, null, fullPath]
      }
    }
    return [true, node, fullPath]
  }

  private coalesceErrorInfo (candidates: Array<Path | null>, lastPath: string): [string, string] {
    if (candidates.length === 1) return [lastPath, 'missing or wrong type']
    const named = candidates
      .filter((key): key is Path => key !== null)
      .map((key) => (typeof key === 'string' ? key : `[${key.map((s) => `'${s}'`).join(', ')}]`))
      .join(', ')
    return [this._path || '<root>', `no candidate path matched: ${named}`]
  }

  // Poisoned nodes are fallbacks from an error already recorded higher up: stay quiet.
  private error (path: string, expected: string, actual: unknown, reason: string): void {
    if (this.poisoned) return
    const record: ErrorRecord = [path, expected, actual, reason]
    this.root.errors.push(record)
    errorHook?.(...record)
  }
}

const join = (parent: string, segment: string): string => (parent ? `${parent}.${segment}` : segment)

const coerceStr: Coerce = (value) => {
  if (typeof value === 'string') return [true, value]
  if (typeof value === 'number') return [true, String(value)]
  if (typeof value === 'boolean') return [true, value ? 'True' : 'False'] // as Python's str(bool)
  return [false]
}

const coerceInt: Coerce = (value) => {
  if (typeof value === 'number') return Number.isInteger(value) ? [true, value] : [false]
  if (typeof value === 'string' && /^\s*[+-]?\d+\s*$/.test(value)) return [true, parseInt(value, 10)]
  return [false]
}

const coerceFloat: Coerce = (value) => {
  if (typeof value === 'number') return [true, value]
  if (typeof value === 'string' && value.trim() !== '' && !Number.isNaN(Number(value))) return [true, Number(value)]
  return [false]
}

const coerceBool: Coerce = (value) => (typeof value === 'boolean' ? [true, value] : [false])
