// BASE arm: verbatim copy of the inline handleOpenUrlInBuiltInBrowser body from
// packages/desktop/apps/electron/src/renderer/App.tsx @ 63a8ed4338f8 (baseRefOid).
// The only adaptations are injection seams that replace closed-over variables:
//   window.electronAPI?.browserPane  ->  opts.browserPaneApi
//   handleOpenUrlExternal(url)       ->  opts.openExternal(url)
// Classification expressions and control flow are byte-identical to base.
import { DEFAULT_DOCKED_BROWSER_INSTANCE_ID } from './src/renderer/atoms/browser-pane'

export const IMPL_NAME = 'base'

export interface ImplOptions {
  browserPaneApi?: any
  isChannelAvailable?: (channel: string) => boolean // unused: base has no probe
  openExternal: (url: string) => void
}

export async function impl(url: string, opts: ImplOptions): Promise<void> {
  const handleOpenUrlExternal = opts.openExternal
  const open = async () => {
    const trimmedUrl = url.trim()
    const hasExplicitScheme = /^[a-z][a-z0-9+.-]*:/i.test(trimmedUrl)
    const hasSchemeSeparator = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmedUrl)
    const hostPattern =
      /^(localhost|\d{1,3}(?:\.\d{1,3}){3}|[\w-]+(?:\.[\w-]+)+)(?::\d+)?(?:\/|$)/i
    const looksLikeHost = hostPattern.test(trimmedUrl)
    const shouldUseBuiltInBrowser = hasSchemeSeparator
      ? /^https?:\/\//i.test(trimmedUrl)
      : !hasExplicitScheme || looksLikeHost

    if (!shouldUseBuiltInBrowser) {
      handleOpenUrlExternal(url)
      return
    }

    let instanceId: string | null = null
    try {
      const browserPaneApi = opts.browserPaneApi
      if (!browserPaneApi) {
        handleOpenUrlExternal(url)
        return
      }

      instanceId = await browserPaneApi.create({
        id: DEFAULT_DOCKED_BROWSER_INSTANCE_ID,
        show: true,
        presentation: 'docked',
      })
      await browserPaneApi.navigate(instanceId, trimmedUrl)
      await browserPaneApi.focus(instanceId)
    } catch (error) {
      if (instanceId) {
        console.warn(
          '[App] Failed to finish opening URL in built-in browser:',
          error,
        )
        return
      }

      console.warn(
        '[App] Failed to open URL in built-in browser, falling back to default browser:',
        error,
      )
      handleOpenUrlExternal(url)
    }
  }

  await open()
}
