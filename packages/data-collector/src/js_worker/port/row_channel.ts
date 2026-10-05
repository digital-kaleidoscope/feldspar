// Serves pages of category rows to the consent page while it is shown, so participants can
// inspect every row without the rows ever being copied to the page wholesale. Feldspar's
// script protocol is strictly one command, one response, so this runs beside it on a
// BroadcastChannel whose name is unique to this session.

import type { Category } from './category'

export interface RowRequest { requestId: number, categoryId: string, offset: number, limit: number, search?: string }
export type RowResponse =
  | { requestId: number, total: number, rows: Array<{ id: number, cells: unknown[] }> }
  | { requestId: number, error: string }

const MAX_PAGE = 500

export class RowChannel {
  readonly name = `feldspar-rows-${crypto.randomUUID()}`
  private readonly channel = new BroadcastChannel(this.name)

  constructor (categories: Category[]) {
    const byId = new Map(categories.map((category) => [category.id, category]))
    this.channel.onmessage = (event: MessageEvent<RowRequest>) => {
      const { requestId, categoryId, offset, limit, search } = event.data
      const category = byId.get(categoryId)
      if (category === undefined) {
        this.channel.postMessage({ requestId, error: `unknown category ${categoryId}` } satisfies RowResponse)
        return
      }
      const page = category.page(Math.max(0, offset | 0), Math.min(MAX_PAGE, Math.max(1, limit | 0)), search)
      this.channel.postMessage({ requestId, ...page } satisfies RowResponse)
    }
  }

  close (): void {
    this.channel.close()
  }
}
