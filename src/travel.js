// 두 점 사이 거리와 이동시간 추정. 라우팅 API 없이 결정적으로.
const R = 6371; // km
const toRad = d => d * Math.PI / 180;

export function distanceKm(a, b) {
  const dLat = toRad(b.lat - a.lat), dLng = toRad(b.lng - a.lng);
  const s = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

// 도보: 우회 1.3, 4.5km/h · 지하철: 접근 15분 + km당 1분 · 택시: 대기 5분 + 우회 1.5, 25km/h
// mode를 주면 강제, 'auto'면 2.0km 기준으로 도보/대중교통. pref='taxi'면 긴 구간을 지하철 대신 택시로.
export function travelMin(a, b, { mode = 'auto', pref = 'transit' } = {}) {
  const km = distanceKm(a, b);
  const walk  = () => ({ min: Math.round(km * 1.3 / 4.5 * 60), mode: 'walk',  km });
  const metro = () => ({ min: Math.round(15 + km * 1.0),       mode: 'metro', km });
  const taxi  = () => ({ min: Math.round(5 + km * 1.5 / 25 * 60), mode: 'taxi', km });
  if (mode === 'walk') return walk();
  if (mode === 'metro') return metro();
  if (mode === 'taxi') return taxi();
  if (km <= 2.0) return walk();
  return pref === 'taxi' ? taxi() : metro();
}
