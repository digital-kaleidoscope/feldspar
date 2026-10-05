// TikTok export → categories. PLACEHOLDER FIELD LIST: these are the categories and columns
// the datadonation-metl fork extracted, ported as they were; the study's final list is not
// decided yet. Each extractor declares the paths it reads; nothing else in the export (following
// list, IPs, device ids, GPS, autofill, messages, ...) is read, and when a large export is
// streamed, nothing else is even kept in memory.

import { Category } from '../port/category'
import type { Cell } from '../port/data_frame'
import type { ParsedExport } from '../port/files'
import { translatable as t } from '../port/props'
import type { SafeData } from '../port/safe_data'

type Item = Record<string, unknown>
const isItem = (value: unknown): value is Item => typeof value === 'object' && value !== null && !Array.isArray(value)

// Exports have used "Activity"/"Your Activity" and other renamed sections over time.
const ACTIVITY = ['Your Activity', 'Activity']

const under = (roots: string[], ...rest: string[]): string[][] => roots.map((root) => [root, ...rest])

// A field by its exported name, tolerating all-lowercase variants.
function field (item: Item, name: string): unknown {
  return item[name] ?? item[name.toLowerCase()]
}

const str = (value: unknown): string => (typeof value === 'string' ? value : typeof value === 'number' ? String(value) : '')

// A row of the named fields; null if the item lacks any of the `required` ones.
function fields (names: string[], required: string[] = names): (item: unknown) => Cell[] | null {
  const requiredAt = required.map((name) => names.indexOf(name))
  return (item) => {
    if (!isItem(item)) return null
    const cells = names.map((name) => str(field(item, name)))
    return requiredAt.every((i) => cells[i] !== '') ? cells : null
  }
}

// ISO 8601 week of a "YYYY-MM-DD ..." date, as Python's isocalendar(): [ISO year, week].
function isoWeek (date: string): [number, number] | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(date)
  if (m === null) return null
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])))
  if (Number.isNaN(d.getTime())) return null
  const day = d.getUTCDay() || 7
  d.setUTCDate(d.getUTCDate() + 4 - day) // Thursday of this ISO week decides its year
  const yearStart = Date.UTC(d.getUTCFullYear(), 0, 1)
  return [d.getUTCFullYear(), Math.ceil(((d.getTime() - yearStart) / 86400000 + 1) / 7)]
}

// A category made of one list in the export, one row per item. Rows are produced item by item,
// so a streamed parse never holds the items themselves.
export interface ListExtractor {
  kind: 'list'
  label: string // for the progress message
  // Candidate locations, tried in order; exports have moved and renamed sections over time.
  paths: string[][]
  row: (item: unknown) => Cell[] | null
  category: (rows: Cell[][]) => Category
}

// A category built from other parts of the export (single values, maps).
export interface DocumentExtractor {
  kind: 'document'
  label: string
  paths: string[][]
  extract: (data: SafeData, paths: string[][]) => Category | Promise<Category>
}

export type Extractor = ListExtractor | DocumentExtractor

// In display order.
export const EXTRACTORS: Extractor[] = [
  {
    kind: 'list',
    label: 'watch history',
    paths: [
      ...under(ACTIVITY, 'Watch History', 'VideoList'),
      ...under(ACTIVITY, 'Video Browsing History', 'VideoList')
    ],
    row: fields(['Date', 'Link']),
    category: (rows) => new Category('watch_history', t({ en: 'Watch history', nl: 'Kijkgeschiedenis' }), ['Date', 'Link'], rows, {
      summary: t({ en: '{count} videos watched between {from} and {to}', nl: '{count} video’s bekeken tussen {from} en {to}' }),
      dateColumn: 'Date'
    })
  },
  {
    kind: 'list',
    label: 'likes',
    paths: [
      ...under(ACTIVITY, 'Like List', 'ItemFavoriteList'),
      ...under(['Likes and Favorites'], 'Like List', 'ItemFavoriteList')
    ],
    row: fields(['Date', 'Link']),
    category: (rows) => new Category('likes', t({ en: 'Likes', nl: 'Likes' }), ['Date', 'Link'], rows, {
      summary: t({ en: '{count} videos liked between {from} and {to}', nl: '{count} video’s geliket tussen {from} en {to}' }),
      dateColumn: 'Date'
    })
  },
  {
    kind: 'list',
    label: 'shares',
    paths: under(ACTIVITY, 'Share History', 'ShareHistoryList'),
    row: fields(['Date', 'SharedContent', 'Link', 'Method'], ['Date', 'Link']),
    category: (rows) => new Category('shares', t({ en: 'Shares', nl: 'Gedeeld' }), ['Date', 'SharedContent', 'Link', 'Method'], rows, {
      summary: t({ en: '{count} things shared between {from} and {to}', nl: '{count} keer iets gedeeld tussen {from} en {to}' }),
      dateColumn: 'Date'
    })
  },
  {
    kind: 'list',
    label: 'logins',
    paths: under(ACTIVITY, 'Login History', 'LoginHistoryList'),
    // Only date, device model and network type: no IP, carrier or device ids.
    row: fields(['Date', 'DeviceModel', 'NetworkType']),
    category: (rows) => new Category('logins', t({ en: 'Login history', nl: 'Inloggeschiedenis' }), ['Date', 'Device', 'Network'], rows, {
      summary: t({ en: '{count} logins between {from} and {to}', nl: '{count} keer ingelogd tussen {from} en {to}' }),
      dateColumn: 'Date'
    })
  },
  {
    kind: 'list',
    label: 'posted videos',
    paths: [['Video', 'Videos', 'VideoList'], ['Post', 'Posts', 'VideoList']],
    // De-identified: ISO year and week of each post (as the old fork reported them), and its
    // like count; no links or content.
    row: (item) => {
      if (!isItem(item)) return null
      const week = isoWeek(str(field(item, 'Date')))
      if (week === null) return null
      const likes = parseInt(str(field(item, 'Likes')), 10)
      return [week[0], week[1], Number.isNaN(likes) ? 0 : likes]
    },
    category: (rows) => new Category('uploads', t({ en: 'Posted videos (year, week and likes only)', nl: 'Geplaatste video’s (alleen jaar, week en likes)' }), ['Year', 'Week', 'Likes'], rows, {
      summary: t({ en: '{count} videos posted', nl: '{count} video’s geplaatst' })
    })
  },
  {
    kind: 'list',
    label: 'purchases',
    paths: [
      ...under(ACTIVITY, 'Purchases', 'BuyGifts', 'BuyGifts'),
      ...under(ACTIVITY, 'Purchases', 'BuyGifts'),
      ...under(ACTIVITY, 'Purchase History', 'BuyGifts')
    ],
    row: fields(['Date', 'Value']),
    category: (rows) => new Category('purchases', t({ en: 'Gift purchases', nl: 'Gekochte cadeaus' }), ['Date', 'Value'], rows, {
      summary: t({ en: '{count} gift purchases between {from} and {to}', nl: '{count} cadeaus gekocht tussen {from} en {to}' }),
      dateColumn: 'Date'
    })
  },
  {
    kind: 'document',
    label: 'activity summary',
    paths: under(ACTIVITY, 'Activity Summary', 'ActivitySummaryMap'),
    // TikTok's own lifetime counters, minus its explanatory note.
    extract: (data, paths) => {
      const map = data.getDict(paths).raw()
      const entries = isItem(map) ? Object.entries(map).filter(([key]) => key.toLowerCase() !== 'note') : []
      const row: Cell[] = entries.map(([, value]) => (typeof value === 'number' || typeof value === 'string' ? value : null))
      return new Category('activity_summary', t({ en: 'Activity summary', nl: 'Activiteitssamenvatting' }), entries.map(([key]) => key), row.length > 0 ? [row] : [], {
        summary: t({ en: 'TikTok’s own totals for your account', nl: 'De totalen die TikTok zelf voor je account bijhoudt' })
      })
    }
  },
  {
    kind: 'document',
    label: 'account identifier',
    paths: [
      ['Profile And Settings', 'Profile Info', 'ProfileMap', 'userName'],
      ['Profile', 'Profile Information', 'ProfileMap', 'userName'],
      ['Profile', 'Profile Info', 'ProfileMap', 'userName']
    ],
    // SHA-256 of the username, hex, as the old fork computed it.
    extract: async (data, paths) => {
      const username = data.getStr(paths, '')
      const rows: Cell[][] = []
      if (username !== '') {
        const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(username))
        rows.push([[...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')])
      }
      return new Category('id', t({ en: 'Account identifier (one-way hash of your username)', nl: 'Accountcode (onomkeerbare hash van je gebruikersnaam)' }), ['Hashed username'], rows, {
        summary: t({ en: 'A code derived from your username; your username itself is not shared', nl: 'Een code afgeleid van je gebruikersnaam; je gebruikersnaam zelf wordt niet gedeeld' })
      })
    }
  }
]

const LISTS = EXTRACTORS.filter((e): e is ListExtractor => e.kind === 'list')

// What to ask readJson for.
export const READ_OPTIONS = {
  paths: EXTRACTORS.flatMap((e) => (e.kind === 'document' ? e.paths : [])),
  lists: LISTS.map(({ paths, row }) => ({ paths, row }))
}

// Build each category from a parsed export, in display order; `onStep` before each.
export async function extractAll ({ data, rows }: ParsedExport, onStep: (label: string, index: number) => void = () => {}): Promise<Category[]> {
  const categories: Category[] = []
  for (const [i, extractor] of EXTRACTORS.entries()) {
    onStep(extractor.label, i)
    categories.push(extractor.kind === 'list'
      ? extractor.category(rows[LISTS.indexOf(extractor)])
      : await extractor.extract(data, extractor.paths))
  }
  return categories
}
