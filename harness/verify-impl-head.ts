// HEAD arm: the real module added by PR #8594.
import { openUrlInBuiltInBrowser } from './src/renderer/components/app-shell/open-url-in-built-in-browser'

export const IMPL_NAME = 'head'

export interface ImplOptions {
  browserPaneApi?: any
  isChannelAvailable?: (channel: string) => boolean
  openExternal: (url: string) => void
}

export async function impl(url: string, opts: ImplOptions): Promise<void> {
  await openUrlInBuiltInBrowser(url, opts)
}
