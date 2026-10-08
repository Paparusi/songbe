// How much text each place takes, as measured on the kit itself (kit/fit.json, made by tools/fit.mjs), and a check of a spec
// against it. No browser needed: this is what tells a writer — a person, an agent, the built-in one — that a headline is too long
// before anything is drawn.
import fs from 'node:fs';
import path from 'node:path';
import { listPacks } from './packs.mjs';
import { KIT } from './util.mjs';

// the kit's table, with a column added for every look a pack has measured (its fit.json)
let table = null;
export function fitTable() {
  if (table) return table;
  table = structuredClone(JSON.parse(fs.readFileSync(path.join(KIT, 'fit.json'), 'utf8')).limits);
  for (const p of listPacks()) for (const [key, row] of Object.entries(p.fit || {})) if (table[key]) for (const [style, n] of Object.entries(row)) if (!(style in table[key]) && Number.isInteger(n)) table[key][style] = n;
  return table;
}
// the limit for one place ("list.items.text") in one look
// ("*" asks for what fits in every look: the smallest of them)
export const limitOf = (key, style = 'soft') => { const row = fitTable()[key]; return !row ? null : style === '*' ? Math.min(...Object.values(row)) : row[style] ?? row.soft ?? null; };

// what is shown of a text: without the [[highlight]] and **accent** marks, and the shown half of {spoken|shown}
export const shownLength = (text) => [...String(text).replace(/\{[^{}|]*\|([^{}]*)\}/g, '$1').replace(/\[\[|\]\]|\*\*/g, '').normalize('NFC')].length;
const lines = (v) => (Array.isArray(v) ? v : v === undefined || v === null ? [] : [v]);

// Every text of the spec that is longer than its place, as [{ at, text, length, limit }], and every list with more entries than fit.
export function tooLong(spec, style = spec?.style || 'soft') {
  const out = [];
  const text = (at, key, value) => { const limit = limitOf(key, style); if (limit === null || typeof value !== 'string') return; const length = shownLength(value); if (length > limit) out.push({ at, text: value, length, limit }); };
  const count = (at, key, n, what) => { const limit = limitOf(key, style); if (limit !== null && n > limit) out.push({ at, count: n, limit, what }); };
  (spec?.scenes || []).forEach((sc, i) => {
    if (!sc || typeof sc !== 'object') return;
    const at = `scenes[${i}]`, type = sc.type;
    text(`${at}.label`, `${type}.label`, sc.label);
    lines(sc.title).forEach((line, n, all) => text(all.length > 1 ? `${at}.title line ${n + 1}` : `${at}.title`, `${type}.title`, line));
    count(`${at}.title`, `${type}.title.lines`, lines(sc.title).length, 'lines');
    for (const f of ['sub', 'chip', 'caption', 'tagline', 'cta', 'url', 'price', 'was', 'terms', 'code', 'quote', 'role']) text(`${at}.${f}`, `${type}.${f}`, sc[f]);
    if (type === 'quote') text(`${at}.name`, 'quote.name', sc.name);
    (Array.isArray(sc.photos) ? sc.photos : []).forEach((p, n) => text(`${at}.photos[${n}].caption`, 'photos.caption', p?.caption));
    if (type === 'end') text(`${at}.name`, 'end.name', sc.name ?? spec.brand?.name);
    for (const f of ['badge', 'heading', 'sub']) text(`${at}.stat.${f}`, `${type}.stat.${f}`, sc.stat?.[f]);
    (Array.isArray(sc.items) ? sc.items : []).forEach((it, n) => { text(`${at}.items[${n}].text`, `${type}.items.text`, it?.text); text(`${at}.items[${n}].sub`, `${type}.items.sub`, it?.sub); });
    if (Array.isArray(sc.items)) count(`${at}.items`, `${type}.items.count`, sc.items.length, 'rows');
    (Array.isArray(sc.callouts) ? sc.callouts : []).forEach((c, n) => text(`${at}.callouts[${n}].text`, `${type}.callouts.text`, c?.text));
    (Array.isArray(sc.messages) ? sc.messages : []).forEach((m, n) => text(`${at}.messages[${n}].text`, `${type}.messages.text`, m?.text));
    for (const f of ['kicker', 'button', 'sub']) text(`${at}.contact.${f}`, `${type}.contact.${f}`, sc.contact?.[f]);
    for (const f of ['name', 'line']) text(`${at}.footer.${f}`, `${type}.footer.${f}`, sc.footer?.[f]);
    (Array.isArray(sc.badges) ? sc.badges : []).forEach((b, n) => text(`${at}.badges[${n}]`, `${type}.badges`, b));
    if (Array.isArray(sc.badges)) count(`${at}.badges`, `${type}.badges.count`, sc.badges.length, 'badges');
  });
  return out;
}
export const tooLongNote = (f) => (f.count ? `${f.at}: ${f.count} ${f.what}, and ${f.limit} fit` : `${f.at}: "${f.text}" is ${f.length} characters, and about ${f.limit} fit`);

// The table as a few lines of prose for a writer.
export function fitGuide(style = 'soft') {
  const l = (k) => limitOf(k, style);
  return [
    `Headline (title): up to ${l('footage.title.lines')} lines, each up to ${l('footage.title')} characters. Small label: ${l('footage.label')}.`,
    `footage: sub ${l('footage.sub')}, chip ${l('footage.chip')}.`,
    `card: caption ${l('card.caption')}; stat badge ${l('card.stat.badge')} characters, stat heading ${l('card.stat.heading')}, stat sub ${l('card.stat.sub')}.`,
    `list: up to ${l('list.items.count')} rows (3 is best); row text ${l('list.items.text')}, row sub ${l('list.items.sub')}.`,
    `phone: callout ${l('phone.callouts.text')}.`,
    `chat: each message ${l('chat.messages.text')}; contact kicker ${l('chat.contact.kicker')}, button ${l('chat.contact.button')}, sub ${l('chat.contact.sub')}; footer name ${l('chat.footer.name')}, line ${l('chat.footer.line')}.`,
    `offer: the figure (price) ${l('offer.price')} characters, old price ${l('offer.was')}, terms ${l('offer.terms')}, code ${l('offer.code')}.`,
    `photos: one to four pictures, caption ${l('photos.caption')}.`,
    `quote: the words up to ${l('quote.quote')} characters, name ${l('quote.name')}, role ${l('quote.role')}.`,
    `end: name ${l('end.name')}, tagline ${l('end.tagline')}, button (cta) ${l('end.cta')}, up to ${l('end.badges.count')} badges of ${l('end.badges')} each, address (url) ${l('end.url')}.`,
  ].join('\n');
}
