// The board: the canvas laid out for the eye — the cast with their faces and voices, the places, and each cut as its shots in
// order: first frame, who speaks, the line. One HTML page (out/<name>-board.html) and one picture of it (…-board.jpg), so a person
// or an agent can look at a whole episode before a single clip is paid for, and see afterwards what is made and what is not.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { idOf } from './flow.mjs';
import { openPage } from '../render.mjs';
import { mkdir } from '../util.mjs';

const esc = (t) => String(t ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const STATE = { ready: '', held: 'held', own: 'yours', make: 'to make', wait: 'waiting', stuck: 'stuck' };

// `rows` is what look() returned; `cuts` the cut nodes to lay out (all of them when left out)
export function boardHtml(flow, rows, { title = 'Songbe', cuts = null } = {}) {
  const row = new Map(rows.map((r) => [r.id, r])), nodes = flow.nodes, tall = (flow.format || 'tall') === 'tall';
  const pic = (id, cls = '') => { const r = row.get(id), n = nodes[id]; if (!n) return '';
    const img = r?.file && n.kind === 'picture' ? `<img src="${esc(pathToFileURL(r.file).href)}">` : `<div class="none">${esc(STATE[r?.state] || 'to make')}</div>`;
    return `<div class="pic ${cls}">${img}</div>`; };
  const tag = (id) => { const r = row.get(id); return r && STATE[r.state] ? `<span class="tag ${r.state}">${esc(STATE[r.state])}</span>` : ''; };
  const people = Object.entries(nodes).filter(([, n]) => n.kind === 'person'), places = Object.entries(nodes).filter(([, n]) => n.kind === 'place');
  const cast = people.map(([id, p]) => `<div class="who">${pic(`${id}-face`, 'face')}${pic(`${id}-sheet`, 'sheet')}<div class="cap"><b>${esc(p.name)}</b>${p.voice?.voice ? ` · voice ${esc(p.voice.voice)}` : ''}<br><span>${esc(p.wardrobe || p.look || '')}</span></div></div>`).join('');
  const sets = places.map(([id, p]) => `<div class="place">${pic(`${id}-plate`, 'plate')}<div class="cap"><b>${esc(p.name)}</b></div></div>`).join('');
  const films = Object.entries(nodes).filter(([id, n]) => n.kind === 'cut' && (!cuts || cuts.includes(id))).map(([id, c]) => {
    const made = row.get(id), shots = (c.shots || []).map((s, i) => { const cid = idOf(typeof s === 'string' ? s : s.clip), clip = nodes[cid] || {}, line = clip.voice ? nodes[idOf(clip.voice)] : null, speaker = line?.who ? nodes[idOf(line.who)]?.name : null, r = row.get(cid);
      const words = String(clip.prompt || '').replace(/@[a-z0-9-]+/g, '').replace(/\s+/g, ' ').trim();
      return `<div class="shot">${clip.frame ? pic(idOf(clip.frame), 'frame') : '<div class="pic frame"><div class="none">no frame</div></div>'}<div class="meta"><b>${i + 1}</b> <i>${esc(cid)}</i> ${r?.state === 'ready' || r?.state === 'held' ? '<span class="tag done">clip ✓</span>' : `<span class="tag">${esc(STATE[r?.state] || 'to make')}</span>`}${clip.model ? ` <span class="tag model">${esc(clip.model)}</span>` : ''}</div>`
        + `<div class="act">${esc(words.slice(0, 190))}${words.length > 190 ? '…' : ''}</div>${line ? `<div class="line${clip.heard ? ' off' : ''}"><b>${esc(speaker || '')}${clip.heard ? ' (off screen)' : ''}:</b> ${esc(line.text)}</div>` : ''}</div>`; }).join('');
    const frames = new Set((c.shots || []).map((s) => idOf(nodes[idOf(typeof s === 'string' ? s : s.clip)]?.frame))), wide = Object.entries(nodes).filter(([pid, p]) => p.kind === 'picture' && c.group && p.group === c.group && !frames.has(pid));
    const scenes = wide.map(([pid, p]) => `<div class="scene">${pic(pid, 'plate')}<div class="cap"><b>${esc(p.label || pid)}</b></div></div>`).join('');
    return `<section><h2>${esc(c.label || id)} ${made?.state === 'ready' ? '<span class="tag done">cut ✓</span>' : tag(id)}</h2>${scenes ? `<div class="places">${scenes}</div><br>` : ''}<div class="shots">${shots}</div></section>`; }).join('');
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>
*{box-sizing:border-box}html,body{margin:0;background:#111316;color:#e9ecf1;font:15px/1.4 system-ui,"Segoe UI",Roboto,Arial,sans-serif}
main{width:1600px;padding:36px 40px 48px}h1{font-size:30px;margin:0 0 4px}h2{font-size:20px;margin:34px 0 14px;font-weight:650}.sub{color:#8f98a6;margin-bottom:8px}
.cast,.places,.shots{display:flex;flex-wrap:wrap;gap:16px}.who{display:grid;grid-template-columns:132px 312px;gap:8px;width:452px}.who .cap{grid-column:1/3}.place,.scene{width:330px}
.pic{background:#1b1f25;border-radius:8px;overflow:hidden;position:relative}.pic img{width:100%;height:100%;object-fit:cover;display:block}
.face{height:176px}.sheet{height:176px}.plate{height:186px}.frame{width:100%;aspect-ratio:${tall ? '9/16' : '16/9'}}
.none{position:absolute;inset:0;display:grid;place-items:center;color:#5d6673;font-size:13px}.cap{color:#c5ccd6;font-size:13.5px}.cap span{color:#8f98a6;font-size:12.5px}
.shot{width:${tall ? 202 : 364}px}.meta{margin-top:7px;font-size:12.5px;color:#8f98a6}.meta b{color:#fff;font-size:15px;margin-right:2px}.meta i{font-style:normal}
.act{font-size:12.5px;color:#aab2bd;margin-top:4px}.line{margin-top:6px;font-size:13.5px;color:#fff;background:#1d2530;border-left:3px solid #6ea8ff;padding:5px 8px;border-radius:0 6px 6px 0}.line.off{border-left-color:#c9a23a}
.line b{color:#9cc3ff;font-weight:600}.tag{display:inline-block;font-size:11px;padding:1px 7px;border-radius:99px;background:#2a3038;color:#aab2bd;vertical-align:middle}.tag.done{background:#173a28;color:#7be0a4}.tag.model{background:#2b2440;color:#c5b3ff}.tag.stuck{background:#472222;color:#ff9c9c}
</style></head><body><main><h1>${esc(title)}</h1><div class="sub">${people.length} in the cast · ${places.length} place${places.length === 1 ? '' : 's'} · ${rows.filter((r) => r.state === 'ready' || r.state === 'held').length} of ${rows.filter((r) => r.state !== 'words').length} pieces made</div>
${cast ? `<h2>Cast</h2><div class="cast">${cast}</div>` : ''}${sets ? `<h2>Places</h2><div class="places">${sets}</div>` : ''}${films}</main>
<script>window.SB = { draw: async () => {} }; window.ready = Promise.all([...document.images].map((i) => i.decode().catch(() => {}))).then(() => 0);</script></body></html>`;
}

// writes the page and a picture of it; returns { html, jpg }
export async function board(dir, flow, rows, { name = 'board', title, cuts = null } = {}) {
  const out = mkdir(path.join(dir, 'out')), html = path.join(out, `${name}.html`), jpg = path.join(out, `${name}.jpg`);
  fs.writeFileSync(html, boardHtml(flow, rows, { title, cuts }));
  let page = await openPage(html, [1600, 900]), height = 900;
  try { height = Math.min(16000, Math.max(600, await page.evaluate('document.querySelector("main").offsetHeight'))); } finally { await page.close(); }
  page = await openPage(html, [1600, height]);
  try { fs.writeFileSync(jpg, await page.shot(0, 88)); } finally { await page.close(); }
  return { html, jpg };
}
