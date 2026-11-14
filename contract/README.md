# Contract

JSON shapes shared by backend and frontend. Fixtures are real API responses; build against them before the other side lands.

- `Field`: `{ value: number | null, provenance: "verified" | "estimated" | "assumed" | "missing", note?: string }`
- `Property`: see `fixtures/properties.json` (from `GET /properties`)
- `Room`: see `fixtures/rooms_zvKHR9DHNjJ.json` (from `GET /properties/{sid}/rooms`)

Source of truth for A1 shapes: `backend/properties/models.py`. Later phases add `AcousticReport` (A2), `IrResponse` (A3), `NoiseReport` (B1). Changing a shape = own commit, announce it.
- `AcousticReport` (A2): `fixtures/acoustic_report_zvKHR9DHNjJ_living_room.json` (from `POST /rooms/analyze`)
- `IrResponse` (A3): `fixtures/ir_response_zvKHR9DHNjJ_living_room.json` (from `POST /rooms/ir`; the real response carries the IR as base64 float32 WAV, omitted in the fixture)
- `Comparison` (A4): `fixtures/comparison_zvKHR9DHNjJ_living_room_vs_tiled_bathroom.json` (from `POST /rooms/compare`)
- `NoiseReport` (B1): `fixtures/noise_report_zvKHR9DHNjJ.json` (from `GET /properties/{sid}/noise`; source of truth `backend/noise/models.py`). Sources from OpenStreetMap with distance/bearing to the nearest point; `exposure` levels are relative by distance, never dB. `status: "error"` means Overpass failed and `sources` is empty.
- `SuitabilityReport` (B3): `fixtures/suitability_zvKHR9DHNjJ_living_room.json` (from `POST /suitability`, whose body is an `AcousticReport`; source of truth `backend/suitability/models.py`). `level` is as modeled; `shape_level` uses only checks treatment cannot change. Qualitative, never a score or dB.
- `PropertyFacts` (B4): `fixtures/property_facts_zvKHR9DHNjJ.json` (from `GET /properties/{sid}/facts`; source of truth `backend/costar/models.py`). Fixed keys always present: construction, year_built, floors, hardwood_floors, ceiling_height_m (value null + provenance `missing` when CoStar lacks it). `material_hints` use material ids from `/materials`. `status: "unavailable"` when the kit is not downloaded or the model is not in it.
- `CatalogEntry` / `SearchResult` (discovery): `GET /catalog/search?q=&city=&kind=&limit=` and `GET /catalog/points` (GeoJSON). Built from the CoStar kit; any Matterport model id in the catalog is a valid `sid` for every `/properties/{sid}/...` endpoint.
- Room source (slice 2): `POST /rooms/analyze`, `/rooms/ir` and each side of `/rooms/compare` take `{sid, room_id}` (Matterport) OR `{sid, custom_room: {label, width_m, depth_m, height_m}}` (user-entered, validated 1-60 m sides, 1.8-15 m height). Provenance now includes `"user"`.
- Suitability (slice 5): each `Fit` adds `treatment` (Sabine panel estimate to reach the use case's target RT60) and `potential_level` (best reachable with practical treatment). `POST /suitability/compare {a, b}` returns both reports plus per-use-case `verdicts` (`better`: A/B/null, `reason`). Bass ratio is Beranek (RT125+RT250)/(RT500+RT1k) everywhere. `MaterialChoice.provenance` is `user` for surfaces the user chose.
