// 건물 발자국 → 그림자 다각형 (순수 함수). 해 고도·방위와 높이로 땅 위 그림자를 만든다.
//   ring: [[lng,lat],...] 닫힌 고리 · h: 높이(m) · sun: {altitude°, azimuth°(북 기준 시계방향)} · lat0: 위도(도)
//   돌려주는 것: 다각형 좌표 배열들 — 옮긴 발자국 1개 + 변마다 띠 1개. 해가 지평선 아래면 [].
export function shadowPolygons(ring, h, sun, lat0, maxLen = 400) {
  if (!ring || ring.length < 4 || !(sun.altitude > 2)) return [];
  const alt = sun.altitude * Math.PI / 180, th = ((sun.azimuth + 180) % 360) * Math.PI / 180;   // 그림자는 해 반대쪽
  const L = Math.min(maxLen, Math.max(3, h) / Math.tan(alt));                                  // m
  const dlat = L * Math.cos(th) / 111320, dlng = L * Math.sin(th) / (111320 * Math.cos(lat0 * Math.PI / 180));
  const moved = ring.map(([x, y]) => [x + dlng, y + dlat]);
  const out = [[moved]];
  for (let i = 0; i < ring.length - 1; i++) out.push([[ring[i], ring[i + 1], moved[i + 1], moved[i], ring[i]]]);
  return out;
}
export const shadowLength = (h, altitudeDeg) => altitudeDeg > 0 ? h / Math.tan(altitudeDeg * Math.PI / 180) : Infinity;
