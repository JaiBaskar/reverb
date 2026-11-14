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
