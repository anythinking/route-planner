// 구글 지도 타임라인(기기 내보내기 JSON) → 도시별 여행 플랜. 순수 함수 — 파일은 브라우저 밖으로 안 나간다.
//   parseVisits(json) → [{ date, start, end, mins, lat, lng }]   (현지 날짜·분)
//   buildTrips(visits, index, cityData) → [{ city, dt, d, t, e, s, p, m, u, o, unnamed }]
const km = (a, b) => Math.hypot((a.lat - b.lat) * 111.32, (a.lng - b.lng) * 111.32 * Math.cos(a.lat * Math.PI / 180));
const geo = s => { const [lat, lng] = String(s).replace('geo:', '').split(',').map(Number); return { lat, lng }; };
// "2026-10-04T11:03:00.000+01:00" → 그 시각대 그대로의 날짜와 분
const local = iso => ({ date: iso.slice(0, 10), min: Number(iso.slice(11, 13)) * 60 + Number(iso.slice(14, 16)) });

export function parseVisits(json) {
  const segs = Array.isArray(json) ? json : json?.semanticSegments || [];
  const out = [];
  for (const s of segs) {
    const loc = s.visit?.topCandidate?.placeLocation; if (!loc || !s.startTime || !s.endTime) continue;
    const a = local(s.startTime), b = local(s.endTime);
    const mins = Math.round((Date.parse(s.endTime) - Date.parse(s.startTime)) / 60000);
    out.push({ date: a.date, start: a.min, end: b.date === a.date ? b.min : 1440, mins, ...geo(loc) });
  }
  out.sort((x, y) => x.date.localeCompare(y.date) || x.start - y.start);
  // 같은 자리(120m 안)가 겹치거나 이어지면 하나로
  const merged = [];
  for (const v of out) {
    const last = merged[merged.length - 1];
    if (last && last.date === v.date && km(last, v) < 0.12 && v.start <= last.end + 5) { last.end = Math.max(last.end, v.end); last.mins = Math.max(last.mins, v.mins, last.end - last.start); continue; }
    merged.push({ ...v });
  }
  return merged;
}

const inBox = (p, b) => p.lat >= b[0] && p.lat <= b[1] && p.lng >= b[2] && p.lng <= b[3];

export function buildTrips(visits, index, cityData, { matchKm = 0.25, minStop = 15, minAway = 30 } = {}) {
  const cityOf = v => Object.entries(index.cities).find(([, c]) => inBox(v, c.bbox))?.[0] || null;
  // 날마다 주인 도시 = 그날 도시 안에 머문 시간이 가장 긴 도시
  const byDate = new Map();
  for (const v of visits) { if (!byDate.has(v.date)) byDate.set(v.date, []); byDate.get(v.date).push(v); }
  const dayCity = new Map();
  for (const [date, vs] of byDate) {
    const tally = {}; for (const v of vs) { const c = cityOf(v); if (c) tally[c] = (tally[c] || 0) + v.mins; }
    const best = Object.entries(tally).sort((a, b) => b[1] - a[1])[0]; if (best) dayCity.set(date, best[0]);
  }
  const trips = [];
  for (const city of new Set(dayCity.values())) {
    const dates = [...dayCity].filter(([, c]) => c === city).map(([d]) => d).sort();
    const vs = visits.filter(v => dates.includes(v.date) && (cityOf(v) === city || cityOf(v) === null));
    // 숙소 = 저녁 늦게 시작하거나 300분 넘게 머문 도시 안 지점 중 가장 자주 나온 곳
    const nights = vs.filter(v => cityOf(v) === city && (v.mins >= 300 || v.start >= 20 * 60 && v.mins >= 120));
    let hotel = null, hotelN = 0;
    for (const n of nights) { const k = nights.filter(m => km(m, n) < 0.2).length; if (k > hotelN) { hotel = n; hotelN = k; } }
    const isHotel = v => hotel && km(v, hotel) < 0.2;
    // 도시에 처음 들어온 뒤 ~ 마지막으로 나가기 전 사이의 바깥 방문만 당일치기로 친다 (공항·출발지는 그 밖이다)
    const inIdx = vs.map((v, i) => cityOf(v) === city ? i : -1).filter(i => i >= 0);
    const firstIn = inIdx[0], lastIn = inIdx[inIdx.length - 1];
    const ctr = { lat: (index.cities[city].bbox[0] + index.cities[city].bbox[1]) / 2, lng: (index.cities[city].bbox[2] + index.cities[city].bbox[3]) / 2 };
    const places = cityData[city]?.places || [];
    const p = {}, u = [], o = dates.map(() => []), seen = new Set(), firstAt = dates.map(() => null);
    let t = 1440, e = 0;
    for (const [i, v] of vs.entries()) {
      if (isHotel(v)) continue;
      const out = cityOf(v) === null;
      if (out && (i < firstIn || i > lastIn || v.mins < minAway || km(v, ctr) > 200)) continue;   // 도착·출발 공항, 스쳐 간 곳, 너무 먼 곳은 뺀다
      if (!out && v.mins < minStop) continue;
      const di = dates.indexOf(v.date);
      const near = out ? null : places.map(pl => [pl, km(v, pl)]).sort((a, b) => a[1] - b[1])[0];
      let id;
      if (near && near[1] <= matchKm) {
        const pl = near[0]; id = pl.id; if (seen.has(id)) continue;
        p[id] = pl.opts.map((x, i) => [i, Math.abs(x.min - v.mins)]).sort((a, b) => a[1] - b[1])[0][0];   // 실제 머문 시간에 가장 가까운 선택지
      } else {
        id = `u${u.length}`; u.push({ name: '', lat: +v.lat.toFixed(5), lng: +v.lng.toFixed(5), min: Math.max(5, Math.min(600, v.mins)), at: `${v.date} ${String(Math.floor(v.start / 60)).padStart(2, '0')}:${String(v.start % 60).padStart(2, '0')}` });
      }
      seen.add(id); o[di].push(id); if (firstAt[di] == null) firstAt[di] = v.start;
      t = Math.min(t, v.start); e = Math.max(e, Math.min(1440, v.start + v.mins));
    }
    if (!o.some(d => d.length)) continue;
    t = Math.max(0, Math.floor(t / 30) * 30 - 30); e = Math.min(1440, Math.ceil(e / 30) * 30); if (e <= t + 60) e = Math.min(1440, t + 600);
    // 날마다 실제로 첫 장소에 닿은 시각에 맞춰 출발 시각을 둔다 — 시간표가 실제와 비슷하게 나온다
    const ds = {}; firstAt.forEach((m, i) => { if (m != null) ds[i] = { t: Math.max(0, Math.floor((m - 20) / 10) * 10), e: 1440 }; });
    trips.push({ city, dt: dates[0], d: dates.length, t, e, s: hotel ? { lat: +hotel.lat.toFixed(5), lng: +hotel.lng.toFixed(5) } : null, p, m: [], u, o, ds, dates });
  }
  return trips;
}
