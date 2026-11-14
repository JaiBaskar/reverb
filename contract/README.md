# Contract

JSON shapes shared by backend and frontend. Fixtures are real API responses; build against them before the other side lands.

- `Field`: `{ value: number | null, provenance: "verified" | "estimated" | "assumed" | "missing", note?: string }`
- `Property`: see `fixtures/properties.json` (from `GET /properties`)
- `Room`: see `fixtures/rooms_zvKHR9DHNjJ.json` (from `GET /properties/{sid}/rooms`)

Source of truth for A1 shapes: `backend/properties/models.py`. Later phases add `AcousticReport` (A2), `IrResponse` (A3), `NoiseReport` (B1). Changing a shape = own commit, announce it.
