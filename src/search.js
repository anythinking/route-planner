// 장소 검색 — OSM Nominatim(키 없음, 초당 1회). 도시 중심 주변 상자 안에서만 찾는다.
export function searchUrl(q, center, bbox = null) {
  const [lat, lng] = center, dLat = 0.15, dLng = 0.25;
  const [s, n, w, e] = bbox || [lat - dLat, lat + dLat, lng - dLng, lng + dLng];   // latMin,latMax,lngMin,lngMax
  const p = new URLSearchParams({ q, format: 'jsonv2', limit: '6', bounded: '1', 'accept-language': 'ko',
    viewbox: [w, n, e, s].join(',') });
  return `https://nominatim.openstreetmap.org/search?${p}`;
}

// Nominatim 결과 한 건 → { name, detail, lat, lng, type }. 이름의 ~ | 는 해시 구분자라 뺀다.
export function toCandidate(r) {
  const parts = String(r.display_name || '').split(',').map(s => s.trim());
  const clean = s => s.replace(/[~|]/g, ' ').replace(/\s+/g, ' ').trim();
  return { name: clean(parts[0] || ''), detail: parts.slice(1, 3).join(', '), lat: Number(r.lat), lng: Number(r.lon), type: r.type || '' };
}

// 위키데이터 — 한국어 이름으로 찾는다(OSM은 한국어 표기가 거의 없다). 좌표(P625)가 도시 상자 안인 것만.
const WD = 'https://www.wikidata.org/w/api.php';
export const inBox = (lat, lng, b) => !b || (lat >= b[0] && lat <= b[1] && lng >= b[2] && lng <= b[3]);
export function toCandidateWd(e, lang = 'ko') {
  const c = e?.claims?.P625?.[0]?.mainsnak?.datavalue?.value; if (!c) return null;
  const name = (e.labels?.[lang]?.value || e.labels?.en?.value || '').replace(/[~|]/g, ' ').trim();
  return name ? { name, detail: e.descriptions?.[lang]?.value || e.descriptions?.en?.value || '', lat: c.latitude, lng: c.longitude, type: 'wikidata' } : null;
}
export async function searchWikidata(q, bbox = null, lang = 'ko') {
  const s = await (await fetch(`${WD}?${new URLSearchParams({ action: 'wbsearchentities', search: q, language: lang, uselang: lang, limit: '12', format: 'json', origin: '*' })}`)).json();
  const ids = (s.search || []).map(x => x.id); if (!ids.length) return [];
  const g = await (await fetch(`${WD}?${new URLSearchParams({ action: 'wbgetentities', ids: ids.join('|'), props: 'labels|descriptions|claims', languages: `${lang}|en`, format: 'json', origin: '*' })}`)).json();
  return ids.map(id => toCandidateWd(g.entities?.[id], lang)).filter(c => c && inBox(c.lat, c.lng, bbox));
}
// 상자 밖으로 흘러간 중심 근처 상자(bbox 없을 때)는 Nominatim 쪽 규칙 그대로
export async function search(q, center, bbox = null) {
  let out = [], osmErr = null;
  try {
    const r = await fetch(searchUrl(q, center, bbox), { headers: { Accept: 'application/json' } });
    if (!r.ok) throw new Error(r.status);
    out = (await r.json()).map(toCandidate).filter(c => c.name && Number.isFinite(c.lat) && Number.isFinite(c.lng));
  } catch (e) { osmErr = e; }   // OSM이 막혀도(429·403) 위키데이터는 시도한다
  if (!out.length || /[가-힣]/.test(q)) {   // 한국어거나 OSM이 비면 위키데이터로 한 번 더
    try { const wd = await searchWikidata(q, bbox); for (const c of wd) if (!out.some(o => Math.hypot(o.lat - c.lat, o.lng - c.lng) < 0.002)) out.push(c); osmErr = null; }
    catch (e) { if (osmErr) throw osmErr; }
  }
  if (osmErr && !out.length) throw osmErr;
  return out;
}
