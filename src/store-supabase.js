// Supabase 저장소 — store.js 인터페이스를 그대로 구현한다. 표·버킷은 docs/supabase.md.
import { SUPABASE } from './config.js';

const { createClient } = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.49.1/+esm');

import { rowToProject, rowToPhoto } from './store-map.js';
const dataUrlToBlob = async d => (await fetch(d)).blob();

export class SupabaseStore {
  constructor() {
    this.kind = 'supabase';
    this.sb = createClient(SUPABASE.url, SUPABASE.anonKey);
    this.sb.auth.onAuthStateChange(() => this.onChange?.());
  }
  async _uid() { const { data } = await this.sb.auth.getUser(); return data.user?.id || null; }

  async user() {
    const { data } = await this.sb.auth.getUser(); const u = data.user; if (!u) return null;
    return { id: u.id, name: u.user_metadata?.full_name || u.email?.split('@')[0] || '나', email: u.email };
  }
  // { email } → 매직 링크 메일, { provider: 'google' } → OAuth
  async signIn({ email, provider }) {
    const redirect = location.href.split('#')[0] + '#tab=mine';
    if (provider) { const { error } = await this.sb.auth.signInWithOAuth({ provider, options: { redirectTo: redirect } }); if (error) throw error; return null; }
    const { error } = await this.sb.auth.signInWithOtp({ email, options: { emailRedirectTo: redirect } }); if (error) throw error;
    return { sent: true };
  }
  async signOut() { await this.sb.auth.signOut(); }

  async listProjects() {
    const { data, error } = await this.sb.from('projects').select('*, photos(id)').order('updated_at', { ascending: false }); if (error) throw error;
    return data.map(r => rowToProject(r, (r.photos || []).map(x => ({ id: x.id }))));
  }
  async getProject(id) {
    const { data: r, error } = await this.sb.from('projects').select('*').eq('id', id).maybeSingle(); if (error) throw error; if (!r) return null;
    const { data: ph } = await this.sb.from('photos').select('*').eq('project_id', id).order('created_at');
    const paths = (ph || []).map(x => x.path);
    const urls = paths.length ? (await this.sb.storage.from('photos').createSignedUrls(paths, 3600)).data || [] : [];
    return rowToProject(r, (ph || []).map((x, i) => rowToPhoto(x, urls[i]?.signedUrl || null)));
  }
  async createProject({ name, city, hash }) {
    const user_id = await this._uid(); if (!user_id) throw new Error('로그인 필요');
    const { data, error } = await this.sb.from('projects').insert({ user_id, name: String(name || '').slice(0, 60) || '이름 없는 여행', city, hash: hash || '' }).select().single(); if (error) throw error;
    return rowToProject(data);
  }
  async updateProject(id, patch) {
    const row = { updated_at: new Date().toISOString() };
    for (const k of ['name', 'city', 'hash', 'shopping']) if (k in patch) row[k] = patch[k];
    const { error } = await this.sb.from('projects').update(row).eq('id', id); if (error) throw error;
    return this.getProject(id);
  }
  async deleteProject(id) {
    const uid = await this._uid();
    const { data: files } = await this.sb.storage.from('photos').list(`${uid}/${id}`);
    if (files?.length) await this.sb.storage.from('photos').remove(files.map(f => `${uid}/${id}/${f.name}`));
    const { error } = await this.sb.from('projects').delete().eq('id', id); if (error) throw error;
  }

  async addPhoto(pid, { dataUrl, lat, lng, placeId, note, takenAt }) {
    const user_id = await this._uid(); if (!user_id) throw new Error('로그인 필요');
    const id = crypto.randomUUID(), path = `${user_id}/${pid}/${id}.jpg`;
    const up = await this.sb.storage.from('photos').upload(path, await dataUrlToBlob(dataUrl), { contentType: 'image/jpeg' }); if (up.error) throw up.error;
    const { data, error } = await this.sb.from('photos').insert({ id, project_id: pid, user_id, path, lat, lng, place_id: placeId, note: note || '', taken_at: takenAt ? new Date(takenAt).toISOString() : null }).select().single();
    if (error) { await this.sb.storage.from('photos').remove([path]); throw error; }
    await this.sb.from('projects').update({ updated_at: new Date().toISOString() }).eq('id', pid);
    return rowToPhoto(data);
  }
  async updatePhoto(pid, phid, patch) {
    const row = {}; if ('placeId' in patch) row.place_id = patch.placeId; if ('note' in patch) row.note = patch.note;
    const { error } = await this.sb.from('photos').update(row).eq('id', phid); if (error) throw error;
  }
  async deletePhoto(pid, phid) {
    const { data: r } = await this.sb.from('photos').select('path').eq('id', phid).maybeSingle();
    if (r?.path) await this.sb.storage.from('photos').remove([r.path]);
    const { error } = await this.sb.from('photos').delete().eq('id', phid); if (error) throw error;
  }
}
