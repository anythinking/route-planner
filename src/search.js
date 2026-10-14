// 장소 검색 — OSM Nominatim(키 없음, 초당 1회). 도시 중심 주변 상자 안에서만 찾는다.
export function searchUrl(q, center) {
  const [lat, lng] = center, dLat = 0.15, dLng = 0.25;
  const p = new URLSearchParams({ q, format: 'jsonv2', limit: '6', bounded: '1', 'accept-language': 'ko',
    viewbox: [lng - dLng, lat + dLat, lng + dLng, lat - dLat].join(',') });
  return `https://nominatim.openstreetmap.org/search?${p}`;
}

// Nominatim 결과 한 건 → { name, detail, lat, lng, type }. 이름의 ~ | 는 해시 구분자라 뺀다.
export function toCandidate(r) {
  const parts = String(r.display_name || '').split(',').map(s => s.trim());
  const clean = s => s.replace(/[~|]/g, ' ').replace(/\s+/g, ' ').trim();
  return { name: clean(parts[0] || ''), detail: parts.slice(1, 3).join(', '), lat: Number(r.lat), lng: Number(r.lon), type: r.type || '' };
}

export async function search(q, center) {
  const r = await fetch(searchUrl(q, center), { headers: { Accept: 'application/json' } });
  if (!r.ok) throw new Error(r.status);
  return (await r.json()).map(toCandidate).filter(c => c.name && Number.isFinite(c.lat) && Number.isFinite(c.lng));
}
