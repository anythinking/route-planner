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
// 차(시외): 30km를 넘는 구간 — 국도 45km/h, 우회 1.25, 승차 5분. 도시 안 택시 공식을 그대로 쓰면 세부→오슬롭(95km)이 실제의 1.7배로 나온다
// mode를 주면 강제, 'auto'면 2.0km 기준으로 도보/대중교통, 30km 넘으면 차. pref='taxi'면 긴 구간을 지하철 대신 택시로.
export const INTERCITY_KM = 30;
export function travelMin(a, b, { mode = 'auto', pref = 'transit' } = {}) {
  const km = distanceKm(a, b);
  const walk  = () => ({ min: Math.round(km * 1.3 / 4.5 * 60), mode: 'walk',  km });
  const metro = () => ({ min: Math.round(15 + km * 1.0),       mode: 'metro', km });
  const taxi  = () => ({ min: Math.round(5 + km * 1.5 / 25 * 60), mode: 'taxi', km });
  const car   = () => ({ min: Math.round(5 + km * 1.25 / 45 * 60), mode: 'car', km });
  if (mode === 'walk') return walk();
  if (mode === 'metro') return metro();
  if (mode === 'taxi') return taxi();
  if (mode === 'car') return car();
  if (km > INTERCITY_KM) return car();
  if (km <= 2.0) return walk();
  return pref === 'taxi' ? taxi() : metro();
}
