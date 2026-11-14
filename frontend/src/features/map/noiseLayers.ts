import { type ExpressionSpecification, type GeoJSONSource, type Map as MapLibreMap, Popup } from 'maplibre-gl'
import { CATEGORY_COLOR } from '../noise/colors'
import type { NoiseReport } from '../noise/types'

/** Noise-source layers on the main map: real feature geometry, coloured by category. */

const LAYERS = ['noise-fill', 'noise-outline', 'noise-line', 'noise-point'] as const
const RINGS_M = [100, 250, 500]
const EMPTY = { type: 'FeatureCollection' as const, features: [] }

const colorExpr = [
  'match',
  ['get', 'category'],
  ...Object.entries(CATEGORY_COLOR).flat(),
  '#a1a1aa',
] as unknown as ExpressionSpecification

const GEOM: Record<(typeof LAYERS)[number], unknown> = {
  'noise-fill': ['==', ['geometry-type'], 'Polygon'],
  'noise-outline': ['==', ['geometry-type'], 'Polygon'],
  'noise-line': ['match', ['geometry-type'], ['LineString', 'MultiLineString'], true, false],
  'noise-point': ['==', ['geometry-type'], 'Point'],
}

export function addNoiseLayers(m: MapLibreMap, beforeId: string) {
  m.addSource('noise', { type: 'geojson', data: EMPTY })
  m.addSource('rings', { type: 'geojson', data: EMPTY })
  m.addLayer(
    {
      id: 'rings',
      type: 'line',
      source: 'rings',
      paint: { 'line-color': '#f59e0b', 'line-width': 1, 'line-dasharray': [3, 3], 'line-opacity': 0.7 },
    },
    beforeId,
  )
  m.addLayer(
    { id: 'noise-fill', type: 'fill', source: 'noise', filter: GEOM['noise-fill'] as never, paint: { 'fill-color': colorExpr, 'fill-opacity': 0.25 } },
    beforeId,
  )
  m.addLayer(
    { id: 'noise-outline', type: 'line', source: 'noise', filter: GEOM['noise-outline'] as never, paint: { 'line-color': colorExpr, 'line-width': 1.5 } },
    beforeId,
  )
  m.addLayer(
    { id: 'noise-line', type: 'line', source: 'noise', filter: GEOM['noise-line'] as never, paint: { 'line-color': colorExpr, 'line-width': 4, 'line-opacity': 0.85 } },
    beforeId,
  )
  m.addLayer(
    {
      id: 'noise-point',
      type: 'circle',
      source: 'noise',
      filter: GEOM['noise-point'] as never,
      paint: { 'circle-color': colorExpr, 'circle-radius': 6, 'circle-stroke-color': '#fff', 'circle-stroke-width': 1 },
    },
    beforeId,
  )
  for (const id of ['noise-fill', 'noise-line', 'noise-point']) {
    m.on('click', id, (e) => {
      const p = e.features?.[0]?.properties
      if (!p) return
      new Popup({ offset: 6 }).setLngLat(e.lngLat).setHTML(popupHtml(p)).addTo(m)
    })
    m.on('mouseenter', id, () => (m.getCanvas().style.cursor = 'pointer'))
    m.on('mouseleave', id, () => (m.getCanvas().style.cursor = ''))
  }
}

const esc = (v: unknown) =>
  String(v ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)

function popupHtml(p: Record<string, unknown>): string {
  return `<div style="color:#111;font:12px system-ui;max-width:220px">
    <b>${esc(p.name || p.subtype)}</b><br/>
    ${esc(p.label)}<br/>
    Nearest point ${esc(Math.round(Number(p.distance)))} m ${esc(p.bearing)} of the property<br/>
    <a href="${esc(p.url)}" target="_blank" rel="noreferrer">OpenStreetMap ${esc(p.id)}</a><br/>
    <span style="color:#666">Mapped proximity, not measured noise.</span></div>`
}

function ring(lat: number, lon: number, r: number): [number, number][] {
  const dLat = r / 111_320
  const dLon = r / (111_320 * Math.cos((lat * Math.PI) / 180))
  return Array.from({ length: 65 }, (_, i) => {
    const a = (i / 64) * 2 * Math.PI
    return [lon + dLon * Math.cos(a), lat + dLat * Math.sin(a)]
  })
}

export function setNoiseData(m: MapLibreMap, report: NoiseReport | null) {
  const labels = Object.fromEntries((report?.exposure ?? []).map((e) => [e.category, e.label]))
  const features =
    report?.status === 'ok'
      ? report.sources.map((s) => ({
          type: 'Feature' as const,
          geometry: (s.geometry ?? { type: 'Point', coordinates: [s.lon, s.lat] }) as never,
          properties: {
            id: s.id,
            category: s.category,
            label: labels[s.category] ?? s.category,
            name: s.name ?? '',
            subtype: s.subtype,
            distance: s.distance_m,
            bearing: s.bearing_compass,
            url: s.osm_url,
          },
        }))
      : []
  ;(m.getSource('noise') as GeoJSONSource | undefined)?.setData({ type: 'FeatureCollection', features })
  ;(m.getSource('rings') as GeoJSONSource | undefined)?.setData(
    report
      ? {
          type: 'FeatureCollection',
          features: RINGS_M.map((r) => ({
            type: 'Feature' as const,
            properties: { r },
            geometry: { type: 'LineString' as const, coordinates: ring(report.lat, report.lon, r) },
          })),
        }
      : EMPTY,
  )
}

export function setNoiseFilter(m: MapLibreMap, enabled: string[]) {
  for (const id of LAYERS) {
    if (m.getLayer(id)) {
      m.setFilter(id, ['all', GEOM[id], ['in', ['get', 'category'], ['literal', enabled]]] as never)
    }
  }
}
