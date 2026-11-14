import { LngLatBounds, Map as MapLibreMap, Marker, Popup } from 'maplibre-gl'
import { useEffect, useRef } from 'react'
import { CATEGORY_COLOR } from './colors'
import type { NoiseReport } from './types'

/** Small map of the property and its nearby noise sources (nearest point of each feature). */
export function NoiseMap({ report }: { report: NoiseReport }) {
  const el = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!el.current) return
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
      center: [report.lon, report.lat],
      zoom: 15,
    })
    // Worker URL is set once in PropertyMap; follow container resizes like it does.
    const ro = new ResizeObserver(() => m.resize())
    ro.observe(el.current)
    const home = document.createElement('div')
    home.title = 'Property'
    home.style.cssText =
      'width:14px;height:14px;border-radius:3px;border:2px solid #fff;background:#f59e0b'
    new Marker({ element: home }).setLngLat([report.lon, report.lat]).addTo(m)

    const bounds = new LngLatBounds([report.lon, report.lat], [report.lon, report.lat])
    report.sources.forEach((s) => {
      const dot = document.createElement('div')
      dot.dataset.testid = 'noise-marker'
      dot.style.cssText = `width:10px;height:10px;border-radius:50%;border:1.5px solid #fff;background:${
        CATEGORY_COLOR[s.category] ?? '#71717a'
      };cursor:pointer`
      const label = `${s.name ?? s.subtype} · ${Math.round(s.distance_m)} m ${s.bearing_compass}`
      dot.title = label
      new Marker({ element: dot })
        .setLngLat([s.lon, s.lat])
        .setPopup(new Popup({ offset: 8 }).setText(label))
        .addTo(m)
      if (s.distance_m <= 600) bounds.extend([s.lon, s.lat])
    })
    m.fitBounds(bounds, { padding: 30, maxZoom: 17, animate: false })
    return () => {
      ro.disconnect()
      m.remove()
    }
  }, [report])

  return <div ref={el} className="h-56 w-full rounded" data-testid="noise-map" />
}
