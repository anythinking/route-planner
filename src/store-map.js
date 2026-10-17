// DB 행 ↔ 화면 객체 (순수 함수 — 테스트는 여기만 본다). 화면은 camelCase·ms 시각을 쓴다.
export const rowToProject = (r, photos = []) => ({
  id: r.id, name: r.name, city: r.city, hash: r.hash || '', shopping: r.shopping || [], packing: r.packing || {}, photos,
  ownerId: r.user_id, visibility: r.visibility || 'private', edits: r.edits || {}, lastEditedBy: r.last_edited_by || null,
  createdAt: Date.parse(r.created_at), updatedAt: Date.parse(r.updated_at),
});
export const rowToPhoto = (r, url = null) => ({
  id: r.id, path: r.path, url, lat: r.lat, lng: r.lng, placeId: r.place_id, note: r.note || '',
  takenAt: r.taken_at ? Date.parse(r.taken_at) : null, createdAt: Date.parse(r.created_at),
});
