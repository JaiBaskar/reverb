import { useEffect, useState } from 'react'
import { fetchFurniture } from '../../api'
import type { FurnitureCatalog } from '../../types'

let catalogPromise: Promise<FurnitureCatalog> | null = null
export function useFurnitureCatalog() {
  const [cat, setCat] = useState<FurnitureCatalog | null>(null)
  useEffect(() => {
    let live = true
    catalogPromise ??= fetchFurniture()
    catalogPromise.then((c) => live && setCat(c)).catch(() => (catalogPromise = null))
    return () => {
      live = false
    }
  }, [])
  return cat
}
