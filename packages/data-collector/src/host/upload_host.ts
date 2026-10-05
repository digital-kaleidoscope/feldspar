// Page side of the piecewise donation upload (js_worker/port/upload.ts). The host page holds
// the end of Feldspar's bridge (the MessagePort it hands over with "live-init"); this receives
// the donate commands on it, uploads each piece with `send`, and reports the outcome back to
// the worker over the donation's BroadcastChannel. One attempt per message: the worker decides
// about retries. The study site will use this with a `send` that POSTs to its own server route.

const DONATION_KEY = /^donation\/([0-9a-f-]{36})\/(?:manifest|[a-z0-9_]+\/\d+)$/

export type Send = (key: string, body: string) => Promise<void>

export function attachUploadHost (port: MessagePort, send: Send, onOther: (command: unknown) => void = () => {}): () => void {
  const channels = new Map<string, BroadcastChannel>()
  const channelFor = (donationId: string): BroadcastChannel => {
    let channel = channels.get(donationId)
    if (channel === undefined) {
      channel = new BroadcastChannel(`feldspar-upload-${donationId}`)
      channels.set(donationId, channel)
    }
    return channel
  }

  port.onmessage = (event: MessageEvent) => {
    const command = event.data
    const match = command?.__type__ === 'CommandSystemDonate' ? DONATION_KEY.exec(command.key) : null
    if (match === null) {
      onOther(command)
      return
    }
    const channel = channelFor(match[1])
    send(command.key, command.json_string).then(
      () => channel.postMessage({ key: command.key, ok: true }),
      (error) => channel.postMessage({ key: command.key, ok: false, error: String(error) })
    )
  }

  return () => {
    port.onmessage = null
    channels.forEach((channel) => channel.close())
  }
}
