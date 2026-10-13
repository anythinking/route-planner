// innerHTML에 들어가는 사용자·외부 문자열은 전부 이걸 거친다. note(큐레이션, <b>만 허용)만 예외.
const MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = v => (v == null ? '' : String(v)).replace(/[&<>"']/g, ch => MAP[ch]);
