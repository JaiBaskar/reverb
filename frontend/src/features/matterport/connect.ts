import type { BundleWindow, MpSdk } from './sdkTypes'

export type Variant = 'bundle' | 'embed'

export const SDK_KEY: string = import.meta.env.VITE_MATTERPORT_SDK_KEY ?? ''
const BUNDLE_BASE = '/matterport-bundle'
const EMBED_SCRIPT = 'https://static.matterport.com/showcase-sdk/latest.js'
const CONNECT_TIMEOUT_MS = 30_000

let bundleCheck: Promise<boolean> | null = null

/**
 * Is the self-hosted Bundle SDK installed (npm run setup:matterport)? Checks version.txt
 * because the dev server answers unknown .html paths with the app's index.html.
 */
export function bundleAvailable(): Promise<boolean> {
  bundleCheck ??= fetch(`${BUNDLE_BASE}/version.txt`)
    .then(async (r) => r.ok && /^\d+\.\d+/.test(await r.text()))
    .catch(() => false)
  return bundleCheck
}

export function iframeSrc(variant: Variant, sid: string): string {
  const q = new URLSearchParams({ m: sid, play: '1', applicationKey: SDK_KEY })
  if (variant === 'bundle') return `${BUNDLE_BASE}/showcase.html?${q}`
  q.set('qs', '1')
  return `https://my.matterport.com/show?${q}`
}

let embedScript: Promise<void> | null = null
function loadEmbedScript(): Promise<void> {
  embedScript ??= new Promise((resolve, reject) => {
    const s = document.createElement('script')
    s.src = EMBED_SCRIPT
    s.onload = () => resolve()
    s.onerror = () => {
      embedScript = null
      reject(new Error('Could not load the Matterport Embed SDK script'))
    }
    document.head.appendChild(s)
  })
  return embedScript
}

function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${what} timed out after ${ms / 1000} s`)), ms)
    p.then(
      (v) => (clearTimeout(t), resolve(v)),
      (e) => (clearTimeout(t), reject(e)),
    )
  })
}

export async function connectSdk(variant: Variant, iframe: HTMLIFrameElement): Promise<MpSdk> {
  if (!SDK_KEY) throw new Error('MATTERPORT_SDK_KEY is not set in the repo-root .env')
  if (variant === 'bundle') {
    const w = iframe.contentWindow as unknown as BundleWindow | null
    if (!w?.MP_SDK) throw new Error('Matterport bundle did not expose MP_SDK')
    return withTimeout(w.MP_SDK.connect(iframe.contentWindow), CONNECT_TIMEOUT_MS, 'Matterport SDK connection')
  }
  await loadEmbedScript()
  if (!window.MP_SDK) throw new Error('Matterport Embed SDK script did not define MP_SDK')
  return withTimeout(window.MP_SDK.connect(iframe, SDK_KEY, ''), CONNECT_TIMEOUT_MS, 'Matterport SDK connection')
}

/**
 * Workaround (verified on bundle 26.5.4 with zvKHR9DHNjJ): the self-hosted showcase stays in
 * appphase.loading and keeps its loading screen up, although the 3D view, navigation and SDK
 * events all work underneath. Once the SDK reports a real view mode we hide that screen.
 * Same-origin only, so this never touches the my.matterport.com embed.
 */
export function revealBundleView(iframe: HTMLIFrameElement) {
  try {
    const el = iframe.contentDocument?.getElementById('loading-gui')
    if (el) el.style.display = 'none'
  } catch {
    /* cross-origin: nothing to do */
  }
}
