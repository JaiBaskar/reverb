import { useEffect, useState } from 'react'
import { thumbUrl } from '../../ui/format'

// Mirrors backend/properties/viewer.py (Viewer).
export interface ViewerInfo {
  sid: string
  available: boolean
  embed_url: string | null
  visibility: string | null
  state: string | null
  published: boolean | null
  reason: string | null
}

/** The property's Matterport scan as an interactive 3D model (Showcase); the scan photo until it loads or if it can't. */
export function ModelViewer({ sid }: { sid: string }) {
  const [state, setState] = useState<{ sid: string; info?: ViewerInfo; error?: string }>({ sid: '' })

  useEffect(() => {
    let live = true
    fetch(`/api/properties/${sid}/viewer`)
      .then((r) => (r.ok ? (r.json() as Promise<ViewerInfo>) : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((info) => live && setState({ sid, info }))
      .catch((e: Error) => live && setState({ sid, error: e.message }))
    return () => {
      live = false
    }
  }, [sid])

  const info = state.sid === sid ? state.info : undefined
  const show = info?.available && info.embed_url

  return (
    <div className="relative aspect-video w-full overflow-hidden rounded-2xl bg-soft" data-testid="model-viewer">
      {show ? (
        <iframe
          key={sid}
          title={`Matterport 3D model ${sid}`}
          src={info.embed_url!}
          className="absolute inset-0 h-full w-full"
          allow="fullscreen; xr-spatial-tracking"
          allowFullScreen
          data-testid="model-iframe"
        />
      ) : (
        <>
          <img src={thumbUrl(sid, 960)} alt="" className="absolute inset-0 h-full w-full object-cover" />
          {info && !info.available && (
            <span className="absolute bottom-2 left-2 rounded-full bg-paper px-2 py-0.5 text-xs">3D model unavailable</span>
          )}
        </>
      )}
    </div>
  )
}
