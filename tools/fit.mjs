#!/usr/bin/env node
// How much text fits where. For every text field of every scene type this draws the scene with longer and longer text, in every
// named frame and every look, and records the longest that still looks as designed: the layout check finds no problem, the type is
// no more than a tenth smaller than with a few words, the text has not wrapped onto another line or been cut off by its box, and it
// keeps clear of the frame's edge. The result is kit/fit.json, which the writer and the docs quote.
//   node tools/fit.mjs               measure the kit's looks and rewrite kit/fit.json (about a minute; needs a browser and ffmpeg)
//   node tools/fit.mjs --pack=<id>   measure the looks of a pack and write its own fit.json
//   node tools/fit.mjs --check       measure and compare with the recorded table; exits 1 when the looks have drifted from it
// Run it again after changing type sizes or layouts in kit/.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { makePlan } from '../src/plan.mjs';
import { openPage, writePage } from '../src/render.mjs';
import { BUILTIN_STYLES, listPacks } from '../src/packs.mjs';
import { FORMATS } from '../src/spec.mjs';
import { KIT } from '../src/util.mjs';

const packId = process.argv.find((a) => a.startsWith('--pack='))?.slice(7), pack = packId ? listPacks().find((p) => p.id === packId) : null;
if (packId && !pack) { console.error(`no pack is called "${packId}"`); process.exit(1); }
const STYLES = pack ? pack.styles.map((s) => s.name) : BUILTIN_STYLES;      // the looks measured in this run
const SHRINK = .9;                                           // type may shrink this far and still count as fitting
// ordinary words in two languages; the stricter of the two decides
const WORDS = ['Smart reminders for every plant and a care guide that adapts to the season all year round today', 'Tuyển công nhân sản xuất chế độ đầy đủ đi làm ngay gần nhà bạn không mất bất kỳ khoản phí nào hết nhé'];
const cut = (full, n) => { const sample = (full + ' ').repeat(Math.ceil(n / full.length) + 1); let s = sample.slice(0, n); if (s.endsWith(' ')) s = s.slice(0, -1) + 'a'; return s; };
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAkAAAAUCAIAAADQu4ACAAAAF0lEQVR42mPUqIhiwAGYGHCDUbmRKQcATsgBIi1V5UoAAAAASUVORK5CYII=', 'base64');      // a small portrait picture

const BASE = {
  footage: { type: 'footage', duration: 5, media: 'media/x.png', label: 'Label', title: ['Short', 'title'], sub: 'Sub', chip: 'Chip' },
  card: { type: 'card', duration: 5, media: 'media/x.png', label: 'Label', title: ['Short', 'title'], caption: 'Cap', stat: { badge: '24h', heading: 'Heading', sub: 'Sub' } },
  list: { type: 'list', duration: 5, label: 'Label', title: ['Short', 'title'], items: [{ text: 'Row one', sub: 'Sub' }, { text: 'Row two', sub: 'Sub' }, { text: 'Row three', sub: 'Sub' }] },
  phone: { type: 'phone', duration: 5, screens: ['media/x.png'], label: 'Label', title: ['Short', 'title'], callouts: [{ text: 'Call', side: 'right', y: .3 }, { text: 'Call', side: 'left', y: .5 }] },
  chat: { type: 'chat', duration: 9, label: 'Label', title: ['Short', 'title'], messages: [{ from: 'them', text: 'Hi' }, { from: 'us', text: 'Hello' }],
    contact: { kicker: 'Phone', button: 'Call', number: ['0900', '000', '000'], sub: 'Sub' }, footer: { name: 'Name', line: 'Line' } },
  offer: { type: 'offer', duration: 5, label: 'Label', title: ['Short', 'title'], price: '-20%', was: '100k', terms: 'Terms', code: 'CODE' },
  photos: { type: 'photos', duration: 5, label: 'Label', title: ['Short', 'title'], photos: [{ src: 'media/x.png', caption: 'Cap' }, { src: 'media/x.png', caption: 'Cap' }, { src: 'media/x.png', caption: 'Cap' }] },
  quote: { type: 'quote', duration: 9, label: 'Label', quote: 'Short words.', name: 'Name', role: 'Role', stars: 5 },
  end: { type: 'end', duration: 5, name: 'Name', tagline: 'Tagline', cta: 'Go', badges: ['One', 'Two'], url: 'example.com' },
};
const LINE = [6, 8, 10, 12, 14, 16, 18, 20, 22, 24, 26, 28, 32], SHORT = [6, 10, 12, 14, 16, 18, 20, 22, 24, 26, 28, 30, 34, 38, 42, 48], LONG = [8, 16, 24, 32, 40, 48, 56, 64, 72, 80, 100, 130];
// [field, lengths to try, how to put a text of that length into the scene, { lines: how many lines it may take, width: the widest it may get (design px) }]
const FIELDS = {
  footage: [['label', SHORT, (s, t) => { s.label = t; }], ['title', LINE, (s, t) => { s.title = [t, t]; }], ['sub', LONG, (s, t) => { s.sub = t; }], ['chip', SHORT, (s, t) => { s.chip = t; }, { width: 640 }]],
  card: [['label', SHORT, (s, t) => { s.label = t; }], ['title', LINE, (s, t) => { s.title = [t, t]; }], ['caption', SHORT, (s, t) => { s.caption = t; }],
    ['stat.badge', [2, 3, 4, 5, 6], (s, t) => { s.stat.badge = t; }, { shrink: .6 }], ['stat.heading', SHORT, (s, t) => { s.stat.heading = t; }], ['stat.sub', SHORT, (s, t) => { s.stat.sub = t; }]],
  list: [['label', SHORT, (s, t) => { s.label = t; }], ['title', LINE, (s, t) => { s.title = [t, t]; }], ['items.text', SHORT, (s, t) => { for (const it of s.items) it.text = t; }], ['items.sub', LONG, (s, t) => { for (const it of s.items) it.sub = t; }]],
  phone: [['label', SHORT, (s, t) => { s.label = t; }], ['title', LINE, (s, t) => { s.title = [t, t]; }], ['callouts.text', SHORT, (s, t) => { for (const c of s.callouts) c.text = t; }, { width: 460 }]],
  chat: [['label', SHORT, (s, t) => { s.label = t; }], ['title', LINE, (s, t) => { s.title = [t, t]; }], ['messages.text', LONG, (s, t) => { for (const m of s.messages) m.text = t; }, { lines: 3 }],
    ['contact.kicker', SHORT, (s, t) => { s.contact.kicker = t; }], ['contact.button', SHORT, (s, t) => { s.contact.button = t; }], ['contact.sub', SHORT, (s, t) => { s.contact.sub = t; }],
    ['footer.name', SHORT, (s, t) => { s.footer.name = t; }], ['footer.line', LONG, (s, t) => { s.footer.line = t; }]],
  offer: [['label', SHORT, (s, t) => { s.label = t; }], ['title', LINE, (s, t) => { s.title = [t, t]; }], ['price', [3, 4, 5, 6, 7, 8, 10, 12, 14], (s, t) => { s.price = t; }], ['was', SHORT, (s, t) => { s.was = t; }],
    ['terms', LONG, (s, t) => { s.terms = t; }], ['code', SHORT, (s, t) => { s.code = t; }]],
  photos: [['label', SHORT, (s, t) => { s.label = t; }], ['title', LINE, (s, t) => { s.title = [t, t]; }], ['caption', SHORT, (s, t) => { for (const p of s.photos) p.caption = t; }]],
  quote: [['label', SHORT, (s, t) => { s.label = t; }], ['quote', [16, 40, 60, 80, 100, 120, 140, 160, 200, 240], (s, t) => { s.quote = t; }, { lines: 7, shrink: .8 }], ['name', SHORT, (s, t) => { s.name = t; }], ['role', LONG, (s, t) => { s.role = t; }]],
  end: [['name', LINE, (s, t) => { s.name = t; }], ['tagline', LONG, (s, t) => { s.tagline = t; }], ['cta', SHORT, (s, t) => { s.cta = t; }], ['badges', SHORT, (s, t) => { s.badges = [t, t]; }], ['url', SHORT, (s, t) => { s.url = t; }]],
};
// Where measuring alone would allow more than the design means to hold (a button is a word or two, a title three lines at most),
// the smaller number stands.
const CAPS = { 'offer.label': 30, 'photos.label': 30, 'quote.label': 30, 'offer.code': 16, 'offer.was': 14, 'photos.caption': 24, 'quote.name': 28, 'quote.role': 40, 'footage.label': 30, 'card.label': 30, 'list.label': 30, 'phone.label': 30, 'chat.label': 30, 'card.caption': 36, 'chat.contact.kicker': 16, 'chat.contact.button': 14, 'chat.contact.sub': 40,
  'chat.footer.name': 30, 'chat.footer.line': 48, 'end.badges': 14, 'end.url': 32, 'footage.title.lines': 3, 'list.items.count': 5 };
// counts that are not lengths: how many of something a scene takes
const COUNTS = {
  'footage.title.lines': [[1, 2, 3, 4], (n) => ({ ...structuredClone(BASE.footage), title: Array(n).fill('Ten letters') })],
  'card.title.lines': [[1, 2, 3], (n) => ({ ...structuredClone(BASE.card), title: Array(n).fill('Ten letters') })],
  'list.title.lines': [[1, 2, 3], (n) => ({ ...structuredClone(BASE.list), title: Array(n).fill('Ten letters') })],
  'phone.title.lines': [[1, 2, 3], (n) => ({ ...structuredClone(BASE.phone), title: Array(n).fill('Ten letters') })],
  'chat.title.lines': [[1, 2, 3], (n) => ({ ...structuredClone(BASE.chat), title: Array(n).fill('Ten letters') })],
  'offer.title.lines': [[1, 2, 3], (n) => ({ ...structuredClone(BASE.offer), title: Array(n).fill('Ten letters') })],
  'photos.title.lines': [[1, 2, 3], (n) => ({ ...structuredClone(BASE.photos), title: Array(n).fill('Ten letters') })],
  'list.items.count': [[2, 3, 4, 5, 6], (n) => ({ ...structuredClone(BASE.list), items: Array.from({ length: n }, (_, i) => ({ text: 'Row number ' + (i + 1), sub: 'A few words more' })) })],
  'end.badges.count': [[1, 2, 3, 4], (n) => ({ ...structuredClone(BASE.end), badges: Array(n).fill('App Store') })],
};

// Every trial is one scene of one long spec. `find` is the start of its text, by which the page locates it; `first` marks the
// shortest trial of its ladder, the one the others are compared with.
const trials = [];
for (const [type, fields] of Object.entries(FIELDS)) for (const [field, lengths, put, rule = {}] of fields) for (const [w, sample] of WORDS.entries()) for (const n of lengths) {
  const scene = structuredClone(BASE[type]), text = cut(sample, n); put(scene, text);
  trials.push({ key: `${type}.${field}`, n, w, scene, find: text.slice(0, 5), rule, first: n === lengths[0] });
}
const COUNT_TEXT = { 'list.items.count': 'Row n', 'end.badges.count': 'App S' }, USUAL = { 'list.items.count': 3, 'end.badges.count': 2 };      // the count each ladder is compared with (titles: two lines)
for (const [key, [counts, make]] of Object.entries(COUNTS)) for (const n of counts) trials.push({ key, n, w: 0, scene: make(n), find: COUNT_TEXT[key] || 'Ten l', rule: { lines: 9, count: true }, first: n === (USUAL[key] || 2) });

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'songbe-fit-'));
fs.mkdirSync(path.join(dir, 'media')); fs.writeFileSync(path.join(dir, 'media', 'x.png'), PNG);
const limits = {};
try {
  for (const style of STYLES) for (const format of Object.keys(FORMATS)) {
    fs.writeFileSync(path.join(dir, 'video.json'), JSON.stringify({ format, style, voice: false, music: false, brand: { name: 'Fit' }, scenes: trials.map((t) => t.scene) }));
    const plan = await makePlan(dir, { offline: true }), page = await openPage(writePage(dir, plan), plan.size);
    try {
      // per scene: did the layout check object, and how did the trial's text come out (type size, lines, width, cut off, at the edge)
      const seen = JSON.parse(await page.evaluate(`(async (finds) => {
        const bad = new Set((await SB.lint()).filter((f) => f.level === 'problem').map((f) => f.scene - 1)), out = [];
        const stage = document.getElementById('stage').getBoundingClientRect(), k = stage.width / SB.frame.W;
        for (const [i, s] of SB.live.entries()) {
          await SB.draw(Math.max(s.sc.start + .1, (i === SB.live.length - 1 ? SB.plan.duration : s.sc.end) - .3));
          const m = { bad: bad.has(i), size: null, tall: null, lines: 0, width: 0, cut: false, edge: false, over: 0 }, walk = document.createTreeWalker(s.el, NodeFilter.SHOW_TEXT), mine = [], others = [];
          const shown = (el) => { for (let e = el; e && e !== s.el; e = e.parentElement) { const c = getComputedStyle(e); if (c.visibility === 'hidden' || c.display === 'none' || +c.opacity < .05) return false; } return true; };
          for (let n; (n = walk.nextNode());) {
            if (!n.nodeValue.trim() || !shown(n.parentElement)) continue;
            const el = n.parentElement, range = document.createRange(); range.selectNodeContents(n);
            const box = range.getBoundingClientRect(), size = parseFloat(getComputedStyle(el).fontSize);
            if (box.width < 2) continue;
            if (!n.nodeValue.includes(finds[i])) { others.push(box); continue; }
            mine.push(box);
            const rows = new Set([...range.getClientRects()].filter((r) => r.width > 1).map((r) => Math.round(r.top))).size || 1, tall = box.height / rows / k;
            m.size = m.size === null ? size : Math.min(m.size, size); m.tall = m.tall === null ? tall : Math.min(m.tall, tall);      // the type as set, and as it comes out when its block is scaled
            m.lines = Math.max(m.lines, rows);
            m.width = Math.max(m.width, Math.round(box.width / k));
            if (box.left < stage.left + 36 * k - 1 || box.right > stage.right - 36 * k + 1) m.edge = true;
            for (let a = el; a && a !== s.el; a = a.parentElement) {
              if (getComputedStyle(a).overflowX === 'visible') continue;
              const r = a.getBoundingClientRect(); if (box.right > r.right + 2 || box.left < r.left - 2) m.cut = true;
            }
          }
          // how much it lies over other words of the scene (line boxes of stacked lines touch by design; a long label reaching the text beside it does not)
          // (a text box is as tall as its font's full line, which neighbours above and below share by design: only the middle of it counts)
          const mid = (r) => ({ left: r.left, right: r.right, top: r.top + r.height * .24, bottom: r.bottom - r.height * .24 });
          for (const a of mine.map(mid)) for (const b of others.map(mid)) m.over += Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) * Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top)) / (k * k);
          out.push(m);
        }
        return JSON.stringify(out);
      })(${JSON.stringify(trials.map((t) => t.find))})`));
      const base = new Map(); trials.forEach((t, i) => { if (t.first) base.set(`${t.key}|${t.w}`, seen[i]); });
      const ok = new Map();      // "key|n" → fits, for every sample
      trials.forEach((t, i) => {
        const m = seen[i], b = base.get(`${t.key}|${t.w}`);
        const keep = t.rule.shrink || (t.rule.count ? .8 : SHRINK), least = b.size * keep, hit = !t.rule.count && m.over > b.over * 1.2 + 80;
        const fits = !m.bad && m.size !== null && m.size >= least && m.tall >= b.tall * (keep - .03) && m.lines <= (t.rule.lines || b.lines) && !m.cut && !m.edge && !hit && (!t.rule.width || m.width <= t.rule.width);
        const id = `${t.key}|${t.n}`; ok.set(id, (ok.get(id) ?? true) && fits);
        if (process.argv.includes('--why') && !fits) console.log(`    ${style} ${format} ${t.key} ${t.n}: ${m.bad ? 'layout problem ' : ''}${m.size === null ? 'text not found ' : m.size < least ? `type ${b.size}→${m.size} ` : m.tall < b.tall * (keep - .03) ? `drawn ${Math.round(b.tall)}→${Math.round(m.tall)} px tall ` : ''}${hit ? 'runs into other text ' : ''}${m.lines > (t.rule.lines || b.lines) ? `${m.lines} lines ` : ''}${m.cut ? 'cut off ' : ''}${m.edge ? 'at the edge ' : ''}${t.rule.width && m.width > t.rule.width ? `width ${m.width} ` : ''}`);
      });
      for (const key of new Set(trials.map((t) => t.key))) {
        const ns = [...new Set(trials.filter((t) => t.key === key).map((t) => t.n))].sort((a, b) => a - b);
        let best = 0; for (const n of ns) { if (ok.get(`${key}|${n}`)) best = n; else if (best) break; }      // the longest of the unbroken run that fits
        (limits[key] ??= {})[style] = Math.min(limits[key][style] ?? Infinity, best, CAPS[key] ?? Infinity);
      }
      console.log(`${style} · ${format}: ${trials.length} trials`);
    } finally { await page.close(); }
  }
} finally { fs.rmSync(dir, { recursive: true, force: true }); }

const file = pack ? path.join(pack.dir, 'fit.json') : path.join(KIT, 'fit.json');
const out = { note: 'Generated by tools/fit.mjs: the longest text (characters), or the most lines or rows, that still looks as designed in each place, in every named frame. Do not edit by hand.', limits };
if (process.argv.includes('--check')) {
  const was = JSON.parse(fs.readFileSync(file, 'utf8')).limits, drift = Object.keys({ ...was, ...limits }).filter((k) => JSON.stringify(was[k]) !== JSON.stringify(limits[k]));
  if (drift.length) { console.log(file + ' no longer matches what is drawn:\n' + drift.map((k) => `  ${k}: recorded ${JSON.stringify(was[k])}, measured ${JSON.stringify(limits[k])}`).join('\n')); process.exit(1); }
  console.log(file + ' matches what is drawn');
} else {
  fs.writeFileSync(file, JSON.stringify(out, null, 1).replace(/\{\n\s+([^{}]+?)\n\s+\}/g, (m, row) => '{ ' + row.replace(/\n\s+/g, ' ') + ' }') + '\n');
  console.log('wrote ' + file);
}
for (const [k, v] of Object.entries(limits)) console.log(`  ${k.padEnd(22)} ${STYLES.map((s) => `${s} ${String(v[s]).padStart(3)}`).join('   ')}`);
