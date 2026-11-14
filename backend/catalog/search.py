from catalog.models import CatalogEntry, SearchResult


def _haystack(e: CatalogEntry) -> str:
    return " ".join(
        str(x) for x in (e.address, e.city, e.state, e.postcode, e.name, e.type_label, e.sid) if x
    ).lower()


def search(
    index: list[CatalogEntry],
    q: str = "",
    city: str | None = None,
    kind: str | None = None,
    demo_sids: set[str] | None = None,
    limit: int = 50,
) -> SearchResult:
    demo_sids = demo_sids or set()
    tokens = q.lower().split()
    hits = []
    for e in index:
        if city and (e.city or "").lower() != city.lower():
            continue
        if kind and e.kind != kind:
            continue
        hay = _haystack(e)
        if all(t in hay for t in tokens):
            demo = bool(demo_sids & set(e.model_ids))
            hits.append(e.model_copy(update={"demo_pick": demo}) if demo else e)
    hits.sort(key=lambda e: (not e.demo_pick, e.city or "", e.address))
    return SearchResult(total=len(hits), results=hits[:limit])
