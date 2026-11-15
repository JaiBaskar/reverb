import {
  type GeoJSONSource,
  type MapGeoJSONFeature,
  Map as MapLibreMap,
  Popup,
  setWorkerUrl,
} from 'maplibre-gl'
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url'
import { useEffect, useRef, useState } from 'react'
import type { CatalogPoints } from '../../types'
import type { NoiseReport } from '../noise/types'
import { NoiseLegend } from './NoiseLegend'
import { addNoiseLayers, addRiskLayer, setNoiseData, setNoiseFilter, setRiskData, setRiskVisible } from './noiseLayers'
import type { NoiseRisk } from '../risk/types'

// MapLibre resolves its worker next to its own bundle, which Vite moves; point it at the real file.
setWorkerUrl(workerUrl)

const EMPTY: CatalogPoints = { type: 'FeatureCollection', features: [] }

interface Props {
  points: CatalogPoints | null
  selected: { sid: string; lon: number; lat: number } | null
  flyTo: { lon: number; lat: number; zoom: number; key: number } | null
  onSelect: (sid: string) => void
  noise: NoiseReport | null
  /** The open property's surroundings: its heat is the only noise heat drawn. */
  risk?: NoiseRisk | null
  riskState?: 'idle' | 'loading' | 'ready' | 'error'
  /** A listing card under the pointer; its pin is highlighted. */
  hovered?: string | null
}

/** All CoStar properties with a Matterport scan, clustered; click to select. */
export function PropertyMap({ points, selected, flyTo, onSelect, noise, risk = null, riskState = 'idle', hovered = null }: Props) {
  const [heatOn, setHeatOn] = useState(true)
  const [enabled, setEnabled] = useState<string[] | null>(null)
  const el = useRef<HTMLDivElement>(null)
  const map = useRef<MapLibreMap | null>(null)
  const loaded = useRef(false)
  const pointsRef = useRef<CatalogPoints | null>(points)
  const onSelectRef = useRef(onSelect)
  useEffect(() => {
    pointsRef.current = points
    onSelectRef.current = onSelect
  })

  useEffect(() => {
    if (!el.current) return
    const m = new MapLibreMap({
      container: el.current,
      // Light, keyless vector basemap (OpenFreeMap "positron", OpenStreetMap data).
      style: 'https://tiles.openfreemap.org/styles/positron',
      attributionControl: { compact: true, customAttribution: 'Properties: CoStar' },
      center: [-118.3171, 34.0935],
      zoom: 14,
    })
    map.current = m
    // MapLibre only sizes its canvas at creation; follow layout changes (stacked <-> side by side).
    const ro = new ResizeObserver(() => m.resize())
    ro.observe(el.current)

    m.on('load', () => {
      m.addSource('catalog', {
        type: 'geojson',
        data: pointsRef.current ?? EMPTY,
        cluster: true,
        clusterRadius: 40,
        clusterMaxZoom: 14,
      })
      m.addSource('selected', { type: 'geojson', data: EMPTY })
      m.addLayer({
        id: 'clusters',
        type: 'circle',
        source: 'catalog',
        filter: ['has', 'point_count'],
        paint: {
          'circle-color': '#111114',
          'circle-opacity': 0.85,
          'circle-stroke-color': '#fff',
          'circle-stroke-width': 1.5,
          'circle-radius': ['step', ['get', 'point_count'], 12, 20, 16, 100, 22, 500, 30],
        },
      })
      m.addLayer({
        id: 'points',
        type: 'circle',
        source: 'catalog',
        filter: ['!', ['has', 'point_count']],
        paint: {
          'circle-color': '#2563eb',
          'circle-radius': 6,
          'circle-stroke-color': '#fff',
          'circle-stroke-width': 1.5,
        },
      })
      m.addLayer({
        id: 'selected',
        type: 'circle',
        source: 'selected',
        paint: {
          'circle-radius': 12,
          'circle-color': 'rgba(0,0,0,0)',
          'circle-stroke-color': '#111114',
          'circle-stroke-width': 3,
        },
      })
      m.addSource('hover', { type: 'geojson', data: EMPTY })
      m.addLayer({
        id: 'hover',
        type: 'circle',
        source: 'hover',
        paint: { 'circle-radius': 9, 'circle-color': '#111114', 'circle-stroke-color': '#fff', 'circle-stroke-width': 2 },
      })
      addRiskLayer(m, 'clusters')
      addNoiseLayers(m, 'clusters')
      loaded.current = true


      m.on('click', 'clusters', async (e) => {
        const f = e.features?.[0] as MapGeoJSONFeature | undefined
        if (!f) return
        const src = m.getSource('catalog') as GeoJSONSource
        const zoom = await src.getClusterExpansionZoom(f.properties.cluster_id as number)
        const [lon, lat] = (f.geometry as unknown as { coordinates: [number, number] }).coordinates
        m.easeTo({ center: [lon, lat], zoom })
      })
      m.on('click', 'points', (e) => {
        const sid = e.features?.[0]?.properties.sid as string | undefined
        if (sid) onSelectRef.current(sid)
      })
      // Hover a property for its address and type before clicking.
      const hover = new Popup({ closeButton: false, closeOnClick: false, offset: 10, className: 'reverb-hover' })
      m.on('mousemove', 'points', (e) => {
        const p = e.features?.[0]?.properties
        if (!p) return
        const esc = (v: unknown) => String(v ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)
        hover
          .setLngLat(e.lngLat)
          .setHTML(
            `<div style="color:#111;font:12px system-ui"><b>${esc(p.label)}</b><br/>${esc(p.type)}</div>`,
          )
          .addTo(m)
      })
      m.on('mouseleave', 'points', () => hover.remove())
      for (const layer of ['clusters', 'points']) {
        m.on('mouseenter', layer, () => (m.getCanvas().style.cursor = 'pointer'))
        m.on('mouseleave', layer, () => (m.getCanvas().style.cursor = ''))
      }
    })
    return () => {
      ro.disconnect()
      m.remove()
      map.current = null
      loaded.current = false
    }
  }, [])

  useEffect(() => {
    const m = map.current
    if (!m) return
    const apply = () => (m.getSource('catalog') as GeoJSONSource | undefined)?.setData(points ?? EMPTY)
    if (loaded.current) apply()
    else m.once('load', apply)
  }, [points])

  useEffect(() => {
    const m = map.current
    if (!m) return
    const apply = () => {
      ;(m.getSource('selected') as GeoJSONSource | undefined)?.setData(
        selected
          ? {
              type: 'FeatureCollection',
              features: [
                {
                  type: 'Feature',
                  properties: {},
                  geometry: { type: 'Point', coordinates: [selected.lon, selected.lat] },
                },
              ],
            }
          : EMPTY,
      )
      if (selected) m.easeTo({ center: [selected.lon, selected.lat], zoom: Math.max(m.getZoom(), 15) })
    }
    if (loaded.current) apply()
    else m.once('load', apply)
  }, [selected])

  useEffect(() => {
    const m = map.current
    if (!m) return
    const apply = () => setNoiseData(m, noise)
    if (loaded.current) apply()
    else m.once('load', apply)
  }, [noise])

  useEffect(() => {
    const m = map.current
    if (!m) return
    const apply = () => {
      setRiskData(m, risk?.heat ?? null)
      setRiskVisible(m, heatOn)
    }
    if (loaded.current) apply()
    else m.once('load', apply)
  }, [risk, heatOn])

  const shown = enabled ?? (noise?.exposure ?? []).map((e) => e.category)
  useEffect(() => {
    const m = map.current
    if (!m) return
    const apply = () => setNoiseFilter(m, shown)
    if (loaded.current) apply()
    else m.once('load', apply)
  }, [shown.join(',')]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const m = map.current
    if (!m || !loaded.current) return
    const f = hovered ? points?.features.find((x) => x.properties.sid === hovered) : undefined
    ;(m.getSource('hover') as GeoJSONSource | undefined)?.setData(f ? { type: 'FeatureCollection', features: [f] } : EMPTY)
  }, [hovered, points])

  useEffect(() => {
    if (flyTo) map.current?.flyTo({ center: [flyTo.lon, flyTo.lat], zoom: flyTo.zoom })
  }, [flyTo])

  return (
    <div className="relative h-full w-full">
      <div ref={el} className="h-full w-full" data-testid="map" />
      {noise?.status === 'ok' && <NoiseLegend report={noise} enabled={shown} onChange={setEnabled} />}
      {selected && (
        <div className="pointer-events-none absolute left-1/2 top-3 z-10 flex -translate-x-1/2 gap-2" data-testid="area-status">
          <button
            onClick={() => setHeatOn((v) => !v)}
            className="pointer-events-auto flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border border-line bg-paper px-3 text-[13px] font-semibold shadow-sm"
            data-testid="heat-toggle"
            title="Loud neighbours around this home (roads, rail, venues, airports…), from OpenStreetMap. Relative, not decibels."
          >
            <span className={`h-2.5 w-2.5 rounded-full ${heatOn ? 'bg-bad' : 'bg-line'}`} />
            Noise {heatOn ? 'on' : 'off'}
          </button>
          {heatOn && riskState === 'loading' && (
            <span className="flex h-8 items-center whitespace-nowrap rounded-full bg-paper px-3 text-[13px] text-mute shadow-sm" data-testid="area-loading">
              Mapping noise around this home…
            </span>
          )}
          {heatOn && riskState === 'error' && (
            <span className="flex h-8 items-center whitespace-nowrap rounded-full bg-paper px-3 text-[13px] text-mute shadow-sm">Noise map unavailable right now</span>
          )}
        </div>
      )}
    </div>
  )
}
