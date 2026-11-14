import { LngLatBounds, Map as MapLibreMap, Marker, setWorkerUrl } from 'maplibre-gl'
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url'
import { useEffect, useRef } from 'react'
import type { Property } from '../../types'

// MapLibre resolves its worker next to its own bundle, which Vite moves; point it at the real file.
setWorkerUrl(workerUrl)

interface Props {
  properties: Property[]
  selected: string | null
  onSelect: (sid: string) => void
}

export function PropertyMap({ properties, selected, onSelect }: Props) {
  const el = useRef<HTMLDivElement>(null)
  const map = useRef<MapLibreMap | null>(null)
  const markers = useRef<globalThis.Map<string, HTMLDivElement>>(new globalThis.Map())

  useEffect(() => {
    if (!el.current || map.current) return
    const located = properties.filter((p) => p.lat != null && p.lon != null)
    const m = new MapLibreMap({
      container: el.current,
      style: {
        version: 8,
        sources: {
          osm: {
            type: 'raster',
            tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
            tileSize: 256,
            attribution: '© OpenStreetMap contributors',
          },
        },
        layers: [{ id: 'osm', type: 'raster', source: 'osm' }],
      },
      center: located.length ? [located[0].lon!, located[0].lat!] : [-118.3, 34.09],
      zoom: 16,
    })
    map.current = m
    const dots = markers.current
    // MapLibre only sizes its canvas at creation; follow layout changes (stacked <-> side by side).
    const ro = new ResizeObserver(() => m.resize())
    ro.observe(el.current)
    located.forEach((p) => {
      const dot = document.createElement('div')
      dot.dataset.sid = p.sid
      dot.title = p.name
      dot.style.cssText =
        'width:16px;height:16px;border-radius:50%;border:2px solid #fff;cursor:pointer;background:#2563eb'
      dot.onclick = () => onSelect(p.sid)
      markers.current.set(p.sid, dot)
      new Marker({ element: dot }).setLngLat([p.lon!, p.lat!]).addTo(m)
    })
    if (located.length > 1) {
      const b = new LngLatBounds()
      located.forEach((p) => b.extend([p.lon!, p.lat!]))
      m.fitBounds(b, { padding: 60, maxZoom: 17, animate: false })
    }
    return () => {
      ro.disconnect()
      m.remove()
      map.current = null
      dots.clear()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [properties])

  useEffect(() => {
    markers.current.forEach((dot, sid) => {
      dot.style.background = sid === selected ? '#f59e0b' : '#2563eb'
      dot.style.transform = sid === selected ? 'scale(1.4)' : 'none'
    })
    const p = properties.find((x) => x.sid === selected)
    if (p?.lat != null && p.lon != null) map.current?.easeTo({ center: [p.lon, p.lat], duration: 400 })
  }, [selected, properties])

  return <div ref={el} className="h-full w-full" data-testid="map" />
}
