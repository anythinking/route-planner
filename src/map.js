// 지도 — MapLibre GL + OpenFreeMap(키 없음, 벡터 타일, 건물 높이 포함) 래퍼. 화면은 이 API만 쓴다.
//   createMap(id) → { circle, html, line, clear, fitBounds, setView, onClick, resize, setSun, set3D, is3D }
import { shadowPolygons } from './shadow.js';
const STYLE = 'https://tiles.openfreemap.org/styles/liberty';   // 컬러. 'bright'·'positron'도 있다

function buildMap(containerId) {
  // 좁은 화면(휴대폰)은 지도가 화면 위 68%를 차지한다 — 한 손가락 드래그·휠은 페이지 스크롤로 두고 지도는 두 손가락·Ctrl+휠로만 움직인다
  const narrow = matchMedia('(max-width: 1000px)').matches;
  const map = new maplibregl.Map({ container: containerId, style: STYLE, center: [0, 0], zoom: 2, attributionControl: { compact: true }, maxPitch: 70,
    cooperativeGestures: narrow,
    locale: { 'CooperativeGesturesHandler.WindowsHelpText': 'Ctrl 키를 누른 채 스크롤하면 지도가 확대돼요', 'CooperativeGesturesHandler.MacHelpText': '⌘ 키를 누른 채 스크롤하면 지도가 확대돼요', 'CooperativeGesturesHandler.MobileHelpText': '두 손가락으로 지도를 움직여요',
      'NavigationControl.ZoomIn': '확대', 'NavigationControl.ZoomOut': '축소', 'NavigationControl.ResetBearing': '북쪽으로 · 기울기 초기화', 'AttributionControl.ToggleAttribution': '출처' } });
  map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-left');
  const groups = { places: [], route: [], start: [] };      // 그룹별 마커
  const lines = { places: [], route: [], start: [] };       // 그룹별 선(GeoJSON feature)
  let clickFn = null, ready = false, pending = [];
  let sunPos = null, shadowsOn = true;                       // 마지막 해 위치, 그림자 켬
  // 그림자 — 건물 발자국(벡터 타일의 building 층)을 해 반대 방향으로 h/tan(고도)만큼 밀어 만든 다각형. 줌 15.5 이상에서만.
  function updateShadows() {
    if (!ready || !map.getSource('shadows')) return;
    const empty = { type: 'FeatureCollection', features: [] };
    if (!shadowsOn || !sunPos || sunPos.altitude <= 2 || map.getZoom() < 15.5) { map.getSource('shadows').setData(empty); return; }
    const lat0 = map.getCenter().lat;
    const feats = map.querySourceFeatures('openmaptiles', { sourceLayer: 'building' });
    const out = [], seen = new Set();
    for (const f of feats) {
      if (out.length > 6000) break;
      const h = Math.max(3, f.properties.render_height || 8);
      const g = f.geometry; const polys = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];
      for (const poly of polys) {
        const ring = poly[0]; if (!ring || ring.length < 4) continue;
        const key = ring[0][0].toFixed(6) + ',' + ring[0][1].toFixed(6) + ':' + ring.length; if (seen.has(key)) continue; seen.add(key);
        for (const coords of shadowPolygons(ring, h, sunPos, lat0)) out.push({ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: coords } });
      }
    }
    map.getSource('shadows').setData({ type: 'FeatureCollection', features: out });
  }
  map.on('moveend', updateShadows);
  const whenReady = fn => ready ? fn() : pending.push(fn);
  map.on('load', () => {
    for (const g of Object.keys(lines)) {
      map.addSource('lines-' + g, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      map.addLayer({ id: 'lines-' + g, type: 'line', source: 'lines-' + g, layout: { 'line-cap': 'round' },
        paint: { 'line-color': ['get', 'color'], 'line-width': ['get', 'width'], 'line-opacity': ['get', 'opacity'], 'line-dasharray': [2, 2] } });
    }
    // 그림자 층 — 건물 발자국 아래, 땅 위
    map.addSource('shadows', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    const before = map.getLayer('building') ? 'building' : undefined;
    map.addLayer({ id: 'shadows', type: 'fill', source: 'shadows', paint: { 'fill-color': '#1a1a2e', 'fill-opacity': 0.18, 'fill-antialias': false } }, before);
    ready = true; pending.forEach(f => f()); pending = [];
    updateShadows();
  });
  map.on('error', e => console.warn('지도 오류', e?.error?.message || e));
  map.on('click', e => { if (clickFn) clickFn({ latlng: { lat: e.lngLat.lat, lng: e.lngLat.lng } }); });
  const pushLines = g => whenReady(() => map.getSource('lines-' + g)?.setData({ type: 'FeatureCollection', features: lines[g] }));

  const el = (html, title) => { const d = document.createElement('div'); d.innerHTML = html; const e = d.firstElementChild; if (title) e.title = title; return e; };
  const addMarker = (group, latlng, element, { onClick, anchor = 'center' } = {}) => {
    if (onClick) { element.style.cursor = 'pointer'; element.addEventListener('click', ev => { ev.stopPropagation(); onClick(); }); }
    const m = new maplibregl.Marker({ element, anchor }).setLngLat([latlng.lng ?? latlng[1], latlng.lat ?? latlng[0]]).addTo(map);
    groups[group].push(m); return m;
  };
  const toLngLat = p => [p.lng ?? p[1], p.lat ?? p[0]];

  return {
    map,
    // 원 마커 — Leaflet circleMarker 대응
    circle(group, latlng, { radius = 6, color = '#22201c', fillColor = '#fff', weight = 1.5, dashed = false, title = '', onClick = null } = {}) {
      const d = radius * 2;
      return addMarker(group, latlng, el(`<div style="width:${d}px;height:${d}px;border-radius:50%;background:${fillColor};border:${weight}px ${dashed ? 'dashed' : 'solid'} ${color};box-sizing:content-box"></div>`, title), { onClick });
    },
    html(group, latlng, html, { title = '', onClick = null } = {}) { return addMarker(group, latlng, el(html, title), { onClick }); },
    line(group, points, { color = '#15696c', weight = 2, opacity = 0.6 } = {}) {
      lines[group].push({ type: 'Feature', properties: { color, width: weight, opacity }, geometry: { type: 'LineString', coordinates: points.map(toLngLat) } });
      pushLines(group);
    },
    clear(group) { groups[group].forEach(m => m.remove()); groups[group] = []; lines[group] = []; pushLines(group); },
    fitBounds(points, padding = 24) {
      if (!points.length) return;
      const b = points.reduce((bb, p) => bb.extend(toLngLat(p)), new maplibregl.LngLatBounds(toLngLat(points[0]), toLngLat(points[0])));
      map.fitBounds(b, { padding, maxZoom: 15, duration: 0 });
    },
    setView(center, zoom) { map.jumpTo({ center: toLngLat(center), zoom }); },
    onClick(fn) { clickFn = fn; },
    resize() { map.resize(); },
    // 해 — 날짜·시각·위치로 빛 방향을 맞춘다. 밤이면 약하게.
    setSun(date, latlng) {
      if (!window.SunCalc) return null;
      const pos = SunCalc.getPosition(date, latlng.lat, latlng.lng);
      const az = (pos.azimuth * 180 / Math.PI + 180) % 360;            // 북 기준 시계방향
      const alt = pos.altitude * 180 / Math.PI;
      const up = alt > 0;
      sunPos = { azimuth: az, altitude: alt };
      whenReady(() => { map.setLight({ anchor: 'map', position: [1.5, az, Math.max(0, Math.min(89, 90 - alt))], intensity: up ? 0.55 : 0.1, color: up ? (alt < 10 ? '#ffd9a0' : '#ffffff') : '#8aa0c0' }); updateShadows(); });
      const t = SunCalc.getTimes(date, latlng.lat, latlng.lng);
      return { azimuth: az, altitude: alt, up, sunrise: t.sunrise, sunset: t.sunset, goldenHour: t.goldenHour, goldenHourEnd: t.goldenHourEnd };
    },
    set3D(on) { map.jumpTo({ pitch: on ? 58 : 0, bearing: on ? -17 : 0 }); whenReady(() => { if (map.getLayer('building-3d')) map.setLayoutProperty('building-3d', 'visibility', on ? 'visible' : 'none'); }); },
    is3D() { return map.getPitch() > 10; },
    setShadows(on) { shadowsOn = on; updateShadows(); },
    shadowInfo() { return { on: shadowsOn, zoomOk: map.getZoom() >= 15.5, sun: sunPos }; },
  };
}

// 지연 생성 — 홈처럼 지도가 안 보이는 화면에선 아무것도 받지 않는다. 처음 그리는 호출에서 만든다.
export function createMap(containerId) {
  let inner = null;
  const get = () => inner || (inner = buildMap(containerId));
  const pass = name => (...a) => get()[name](...a);
  return {
    get map() { return inner?.map; },
    circle: pass('circle'), html: pass('html'), line: pass('line'), fitBounds: pass('fitBounds'), setView: pass('setView'),
    onClick: pass('onClick'), setSun: pass('setSun'), set3D: pass('set3D'), setShadows: pass('setShadows'), shadowInfo: pass('shadowInfo'),
    clear: g => { if (inner) inner.clear(g); },
    resize: () => { if (inner) inner.resize(); },
    is3D: () => inner ? inner.is3D() : false,
    ready: () => !!inner,
  };
}
