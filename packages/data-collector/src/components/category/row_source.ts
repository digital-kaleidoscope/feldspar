// Page side of js_worker/port/row_channel.ts: asks the worker for pages of a category's rows.

import { useEffect, useRef } from 'react'
import type { RowView } from './types'

type Response = { requestId: number, total: number, rows: RowView[] } | { requestId: number, error: string }

let nextRequestId = 1

export function useRowSource (channelName: string): (categoryId: string, offset: number, limit: number, search: string) => Promise<{ total: number, rows: RowView[] }> {
  const state = useRef<{ channel: BroadcastChannel, pending: Map<number, (r: Response) => void> } | null>(null)

  useEffect(() => () => {
    state.current?.channel.close()
    state.current = null
  }, [channelName])

  return async (categoryId, offset, limit, search) => {
    if (state.current === null) {
      const channel = new BroadcastChannel(channelName)
      const pending = new Map<number, (r: Response) => void>()
      channel.onmessage = (event: MessageEvent<Response>) => {
        pending.get(event.data.requestId)?.(event.data)
        pending.delete(event.data.requestId)
      }
      state.current = { channel, pending }
    }
    const { channel, pending } = state.current
    const requestId = nextRequestId++
    const response = await new Promise<Response>((resolve) => {
      pending.set(requestId, resolve)
      channel.postMessage({ requestId, categoryId, offset, limit, search })
    })
    if ('error' in response) throw new Error(response.error)
    return response
  }
}
