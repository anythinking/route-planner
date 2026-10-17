// 저장소 — 계정·여행(프로젝트)·살 것·사진. 화면은 이 인터페이스만 쓴다.
//   user() · signIn(opts) · signOut() · updateUser({name, prefs, password})
//   listProjects() · getProject(id) · createProject({name, city, hash}) · updateProject(id, patch) · deleteProject(id)
//   addPhoto(pid, {dataUrl|url, lat, lng, placeId, note}) · updatePhoto(pid, phid, patch) · deletePhoto(pid, phid)
// LocalStore는 브라우저 안에만 남는다(이 기기, 이 브라우저). Supabase 구현이 들어오면 같은 메서드로 갈아끼운다.

const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

export class LocalStore {
  constructor(storage = globalThis.localStorage) { this.s = storage; this.kind = 'local'; }
  _get(k, def) { try { const v = this.s.getItem(k); return v == null ? def : JSON.parse(v); } catch { return def; } }
  _set(k, v) { this.s.setItem(k, JSON.stringify(v)); }
  _key() { return 'rp.projects.local'; }

  async user() { return this._get('rp.user', null); }
  async signIn({ name }) { const u = { id: 'local', name: String(name || '').trim().slice(0, 40) || '나' }; this._set('rp.user', u); return u; }
  async signOut() { this.s.removeItem('rp.user'); }
  // { name?, prefs?, password? } — 로컬은 비밀번호가 없다
  async updateUser(patch) {
    const u = await this.user(); if (!u) return null;
    const next = { ...u }; if (patch.name != null) next.name = String(patch.name).trim().slice(0, 40) || u.name; if (patch.prefs) next.prefs = { ...(u.prefs || {}), ...patch.prefs };
    this._set('rp.user', next); return next;
  }

  async listProjects() { return this._get(this._key(), []).sort((a, b) => b.updatedAt - a.updatedAt); }
  async getProject(id) { return this._get(this._key(), []).find(p => p.id === id) || null; }
  async createProject({ name, city, hash }) {
    const now = Date.now();
    const p = { id: uid(), name: String(name || '').slice(0, 60) || '이름 없는 여행', city, hash: hash || '', shopping: [], packing: {}, photos: [], ownerId: 'local', visibility: 'private', edits: {}, createdAt: now, updatedAt: now };
    this._set(this._key(), [...this._get(this._key(), []), p]); return p;
  }
  async updateProject(id, patch) {
    const all = this._get(this._key(), []); const i = all.findIndex(p => p.id === id); if (i < 0) return null;
    all[i] = { ...all[i], ...patch, id, updatedAt: Date.now() }; this._set(this._key(), all); return all[i];
  }
  // 공유 — 브라우저 저장엔 다른 사람이 없다
  async myId() { return 'local'; }
  async listMembers() { return []; }
  async createInvite() { return null; }
  async acceptInvite() { throw new Error('브라우저 저장에선 초대를 못 받는다'); }
  async removeMember() {}
  async listPublic() { return []; }
  async deleteProject(id) { this._set(this._key(), this._get(this._key(), []).filter(p => p.id !== id)); }

  async addPhoto(pid, ph) {
    const p = await this.getProject(pid); if (!p) return null;
    const rec = { id: uid(), takenAt: null, ...ph, createdAt: Date.now() };
    await this.updateProject(pid, { photos: [...p.photos, rec] }); return rec;
  }
  async updatePhoto(pid, phid, patch) {
    const p = await this.getProject(pid); if (!p) return null;
    await this.updateProject(pid, { photos: p.photos.map(x => x.id === phid ? { ...x, ...patch, id: phid } : x) });
  }
  async deletePhoto(pid, phid) {
    const p = await this.getProject(pid); if (!p) return;
    await this.updateProject(pid, { photos: p.photos.filter(x => x.id !== phid) });
  }
}
