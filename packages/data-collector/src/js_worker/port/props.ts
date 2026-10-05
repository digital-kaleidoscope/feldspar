// TypeScript counterpart of packages/python/port/api/props.py and commands.py.
// Each builder returns the same plain object that the Python class's toDict() produces,
// so the React side cannot tell which worker sent it.

import type { Category } from './category'
import { DataFrame } from './data_frame'

export type Translations = Record<string, string>
export interface Translatable { translations: Translations }

export const translatable = (translations: Translations): Translatable => ({ translations })

export const header = (title: Translatable) => ({ __type__: 'PropsUIHeader', title })

export const promptConfirm = (text: Translatable, ok: Translatable, cancel?: Translatable) => ({
  __type__: 'PropsUIPromptConfirm',
  text,
  ok,
  ...(cancel !== undefined && { cancel })
})

export const promptFileInput = (description: Translatable, extensions: string) => ({
  __type__: 'PropsUIPromptFileInput',
  description,
  extensions
})

// Without a percentage, no bar is shown (just the message).
export const promptProgress = (description: Translatable, message: string, percentage?: number) => ({
  __type__: 'PropsUIPromptProgress',
  description,
  message,
  ...(percentage !== undefined && { percentage })
})

export const promptText = (text: Translatable, title: Translatable | null = null) => ({
  __type__: 'PropsUIPromptText',
  title,
  text
})

export const promptRadioInput = (title: Translatable, description: Translatable, items: Array<{ id: number, value: string }>) => ({
  __type__: 'PropsUIPromptRadioInput',
  title,
  description,
  items
})

export interface ConsentFormTableOptions {
  description?: Translatable
  // Maximum rows shown and donated; null for no limit. Same default as Python.
  dataFrameMaxSize?: number | null
  headers?: Record<string, Translatable>
  columnWidths?: Record<string, number>
}

export function consentFormTable (
  id: string,
  number: number,
  title: Translatable,
  dataFrame: DataFrame,
  { description, dataFrameMaxSize = 10000, headers, columnWidths }: ConsentFormTableOptions = {}
) {
  if (dataFrameMaxSize !== null) {
    const max = Math.max(1, dataFrameMaxSize)
    if (dataFrame.length > max) dataFrame = dataFrame.head(max)
  }
  for (const [column, width] of Object.entries(columnWidths ?? {})) {
    if (!(width > 0)) throw new RangeError(`columnWidths[${column}] must be positive, got ${width}`)
  }
  return {
    __type__: 'PropsUIPromptConsentFormTable',
    id,
    number,
    title,
    ...(description && { description }),
    data_frame: dataFrame.toJson(),
    ...(headers && Object.keys(headers).length > 0 && { headers }),
    ...(columnWidths && Object.keys(columnWidths).length > 0 && { column_widths: columnWidths })
  }
}

// A category's consent card: summary, example rows, exclude, and on-demand row inspection
// over `channel` (see row_channel.ts). Rendered by the data-collector's CategoryFactory.
export function categoryCard (category: Category, channel: string) {
  const { description, summary, headers } = category.options
  return {
    __type__: 'PropsUIPromptCategory',
    id: category.id,
    title: category.title,
    ...(description && { description }),
    ...(summary && { summary }),
    columns: category.columns,
    ...(headers && { headers }),
    rowCount: category.rows.length,
    dateRange: category.dateRange(),
    examples: category.examples(),
    channel
  }
}

export const dataSubmissionButtons = (donateQuestion: Translatable | null = null, donateButton: Translatable | null = null) => ({
  __type__: 'PropsUIDataSubmissionButtons',
  donateQuestion,
  donateButton,
  waiting: false
})

export const pageDataSubmission = (platform: string, pageHeader: ReturnType<typeof header>, body: object | object[]) => ({
  __type__: 'PropsUIPageDataSubmission',
  platform,
  header: pageHeader,
  body: Array.isArray(body) ? body : [body]
})

export const pageEnd = () => ({ __type__: 'PropsUIPageEnd' })

// Commands

export type Command =
  | { __type__: 'CommandUIRender', page: object }
  | { __type__: 'CommandSystemDonate', key: string, json_string: string }
  | { __type__: 'CommandSystemExit', code: number, info: string }

export const render = (page: object): Command => ({ __type__: 'CommandUIRender', page })
export const donate = (key: string, jsonString: string): Command => ({ __type__: 'CommandSystemDonate', key, json_string: jsonString })
export const exit = (code: number, info: string): Command => ({ __type__: 'CommandSystemExit', code, info })

// What the UI sends back for each command
export type Payload =
  | { __type__: 'PayloadVoid', value: undefined }
  | { __type__: 'PayloadTrue', value: true }
  | { __type__: 'PayloadFalse', value: false }
  | { __type__: 'PayloadError', value: string }
  | { __type__: 'PayloadString', value: string }
  | { __type__: 'PayloadFile', value: File }
  | { __type__: 'PayloadJSON', value: string }

export interface ScriptContext { sessionId: string, locale: string }

// A donation flow: yield a command, receive the participant's response.
export type Script = (context: ScriptContext) => AsyncGenerator<Command, void, Payload>
