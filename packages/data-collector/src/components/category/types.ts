// Mirrors categoryCard() in js_worker/port/props.ts.

export interface Translatable { translations: Record<string, string> }
export type Cell = string | number | boolean | null
export interface RowView { id: number, cells: Cell[] }

export interface PropsUIPromptCategory {
  __type__: 'PropsUIPromptCategory'
  id: string
  title: Translatable
  description?: Translatable
  summary?: Translatable
  columns: string[]
  headers?: Record<string, Translatable>
  rowCount: number
  dateRange: { from: string, to: string } | null
  examples: RowView[]
  channel: string
}

export const isPropsUIPromptCategory = (body: unknown): body is PropsUIPromptCategory =>
  typeof body === 'object' && body !== null && (body as { __type__?: unknown }).__type__ === 'PropsUIPromptCategory'

export function translate (text: Translatable | undefined, locale: string): string {
  if (text === undefined) return ''
  const { translations } = text
  return translations[locale] ?? translations.en ?? Object.values(translations)[0] ?? ''
}
