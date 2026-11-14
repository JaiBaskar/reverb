import { useEffect, useState } from 'react'

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

/** The property's Matterport scan as an interactive 3D model (Showcase), or why it cannot be shown. */
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
  const error = state.sid === sid ? state.error : undefined

  return (
    <div className="overflow-hidden rounded-lg border border-zinc-800 bg-black" data-testid="model-viewer">
      <div className="flex items-center justify-between gap-2 bg-zinc-950 px-3 py-1.5 text-xs">
        <span className="font-medium text-zinc-200">3D model</span>
        <span className="text-zinc-500">
          Matterport scan {sid}
          {info?.available && (
            <>
              {' · '}
              <a
                className="text-sky-400 hover:underline"
                href={`https://my.matterport.com/show/?m=${sid}`}
                target="_blank"
                rel="noreferrer"
              >
                open full screen
              </a>
            </>
          )}
        </span>
      </div>
      <div className="relative aspect-video w-full">
        {info?.available && info.embed_url ? (
          <iframe
            key={sid}
            title={`Matterport 3D model ${sid}`}
            src={info.embed_url}
            className="absolute inset-0 h-full w-full"
            allow="fullscreen; xr-spatial-tracking"
            allowFullScreen
            data-testid="model-iframe"
          />
        ) : (
          <div className="absolute inset-0 grid place-items-center px-6 text-center text-xs text-zinc-400">
            {error
              ? `Could not check the 3D model (${error}).`
              : info
                ? `No 3D model to show: ${info.reason} Room acoustics still work from the dimensions.`
                : 'Loading the 3D model…'}
          </div>
        )}
      </div>
    </div>
  )
}
