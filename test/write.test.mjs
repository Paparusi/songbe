// The writer: a brief becomes a checked video.json. The language model is replaced by a script here, so nothing is spent and the
// loop itself — draft, check, hand the findings back, check again — is what gets tested.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fitTable, limitOf, shownLength, tooLong } from '../src/fit.mjs';
import { inventedFacts, parseReply, systemPrompt, unreadable, userPrompt, writeSpec } from '../src/write.mjs';
import { SCENES, STYLES, validate } from '../src/spec.mjs';
import { ROOT } from '../src/util.mjs';

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'songbe-write-'));
test.after(() => fs.rmSync(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));
const BRIEF = 'Quán cà phê Mộc ở Thủ Dầu Một, rang hạt tại quán mỗi sáng. Mở cửa từ 6 giờ. Giao miễn phí trong khu cho đơn từ 2 ly. Đặt qua Zalo 0900 111 222.';
const GOOD = { style: 'soft', brand: { name: 'Mộc', ink: '#2A1A12', primary: '#8A4B2A', accent: '#F2C879', paper: '#FBF5EC', muted: '#7A6A5E' }, voice: { language: 'Vietnamese' },
  music: { prompt: 'Warm acoustic instrumental with soft guitar and brushed drums, 100 BPM' },
  scenes: [
    { type: 'footage', say: 'Sáng nay bạn uống cà phê ở đâu?', label: 'Thủ Dầu Một', pin: true, title: ['Cà phê', '[[rang mộc]]'], sub: 'Rang tại quán mỗi sáng' },
    { type: 'list', say: 'Mộc rang hạt mỗi sáng, mở cửa từ sáu giờ, và giao miễn phí trong khu.', label: 'Vì sao chọn Mộc', title: ['Ngon từ', 'hạt mới'],
      items: [{ icon: 'sun', text: 'Rang mỗi sáng', sub: 'Hạt mới trong ngày' }, { icon: 'clock', text: 'Mở cửa từ 6 giờ' }, { icon: 'heart', text: 'Giao miễn phí trong khu', sub: 'Đơn từ 2 ly' }] },
    { type: 'chat', say: ['Nhắn Zalo cho Mộc để đặt trước nhé.', '{Không chín trăm, một một một, hai hai hai|0900 111 222}.'], label: 'Đặt trước', title: 'Nhắn Mộc',
      messages: [{ from: 'them', text: 'Cho mình 2 ly sữa đá' }, { from: 'us', text: 'Có ngay, Mộc giao liền!' }], contact: { kicker: 'Zalo', button: 'Nhắn tin', number: ['0900', '111', '222'] } },
    { type: 'end', say: 'Mộc, cà phê rang mỗi sáng.', tagline: 'Cà phê rang mỗi sáng', cta: 'Nhắn Zalo đặt ngay' }] };
const clone = (x, change) => { const c = structuredClone(x); change?.(c); return c; };
// a model that answers from a list and remembers what it was asked
const scripted = (...replies) => { const asked = []; const ask = async (q) => { asked.push(q); const r = replies[Math.min(asked.length, replies.length) - 1]; return typeof r === 'string' ? r : JSON.stringify(r); }; return { ask, asked }; };
const fresh = (name) => { const d = path.join(scratch, name); fs.mkdirSync(d, { recursive: true }); return d; };

test('the fit table covers every place a scene shows text, for every look', () => {
  const table = fitTable();
  for (const [key, row] of Object.entries(table)) for (const style of STYLES) assert.ok(Number.isInteger(row[style]) && row[style] > 0, `${key} ${style}`);
  for (const [type, shape] of Object.entries(SCENES)) { if ('label' in shape) assert.ok(table[`${type}.label`], `${type}.label`); if ('title!' in shape) for (const f of ['title', 'title.lines']) assert.ok(table[`${type}.${f}`], `${type}.${f}`); }
  for (const key of ['footage.sub', 'footage.chip', 'card.caption', 'card.stat.badge', 'card.stat.heading', 'card.stat.sub', 'list.items.text', 'list.items.sub', 'list.items.count', 'phone.callouts.text',
    'offer.price', 'offer.was', 'offer.terms', 'offer.code', 'photos.caption', 'quote.quote', 'quote.name', 'quote.role', 'chat.messages.text', 'chat.contact.kicker', 'chat.contact.button', 'chat.contact.sub', 'chat.footer.name', 'chat.footer.line', 'end.name', 'end.tagline', 'end.cta', 'end.badges', 'end.badges.count', 'end.url']) assert.ok(table[key], key);
  assert.ok(limitOf('footage.title', 'bold') <= limitOf('footage.title', 'soft'), 'the condensed capitals of bold take no more than soft');
});

test('texts are measured as shown, and the ones that outgrow their place are named', () => {
  assert.equal(shownLength('on [[autopilot]]'), 12); assert.equal(shownLength('**Bình** Dương'), 10); assert.equal(shownLength('Gọi {không chín trăm|0900}'), 8);
  assert.deepEqual(tooLong(GOOD), []);
  const long = tooLong(clone(GOOD, (s) => { s.scenes[0].title = ['Cà phê rang mộc thơm ngon', 'mỗi sáng']; s.scenes[1].items.push({ text: 'a' }, { text: 'b' }); s.scenes[3].cta = 'Nhắn Zalo cho quán để đặt trước ngay hôm nay'; }));
  assert.deepEqual(long.map((f) => f.at), ['scenes[0].title line 1', 'scenes[1].items', 'scenes[3].cta']);
  assert.equal(long[0].length, 25); assert.equal(long[1].count, 5);
});

test('numbers and addresses that the brief never gave are caught', () => {
  assert.deepEqual(inventedFacts(GOOD, BRIEF), []);
  const made = inventedFacts(clone(GOOD, (s) => { s.scenes[1].items[0].sub = 'Hơn 5.000 khách mỗi tháng'; s.scenes[3].url = 'caphemoc.vn'; s.scenes[2].contact.number = ['0900', '111', '333']; s.scenes[1].label = 'Top 3 lý do'; }), BRIEF);
  assert.equal(made.length, 3, made.join('\n'));
  assert.ok(made[0].includes('5000') && made[1].includes('333') && made[2].includes('caphemoc.vn'));
});

test('colour pairs that cannot be read are caught; the bundled palettes pass', () => {
  for (const name of ['app-launch-en', 'recruitment-vi', 'sale-vi']) assert.deepEqual(unreadable(JSON.parse(fs.readFileSync(path.join(ROOT, 'examples', name, 'video.json'), 'utf8')).brand), [], name);
  assert.deepEqual(unreadable(GOOD.brand), []); assert.deepEqual(unreadable({ name: 'no colours given' }), []);
  const bad = unreadable({ ink: '#111827', primary: '#F5B700', accent: '#FFE28A', paper: '#FFFFFF', muted: '#6B7280' });
  assert.ok(bad.some((x) => x.includes('white text on primary')) && bad.some((x) => x.includes('belongs in "accent"')), bad.join('\n'));
});

test('a reply is read even when wrapped in words or a code fence', () => {
  assert.deepEqual(parseReply('Here you go:\n```json\n{"a": {"b": 1}}\n```\nHope it helps.'), { a: { b: 1 } });
  assert.throws(() => parseReply('I cannot do that.'), /no JSON object/); assert.throws(() => parseReply('{"a": '), /no JSON object|JSON/);
});

test('what the model is told: the rules, the measured limits, the schema, and only the media that exists', () => {
  const sys = systemPrompt({});
  for (const part of ['Use only what the brief states', '"additionalProperties":false', 'Never use this type without screens', 'Do not ask for generated footage', '"soft" | "bold" | "classic"', 'Serif headlines']) assert.ok(sys.includes(part), part);
  assert.ok(!systemPrompt({ style: 'soft' }).includes('"style": "soft" | "bold"') && sys.includes(`each up to ${limitOf('footage.title', '*')} characters`) && systemPrompt({ style: 'soft' }).includes(`each up to ${limitOf('footage.title', 'soft')} characters`));
  assert.ok(systemPrompt({ footage: true }).includes('"generate"'));
  const user = userPrompt({ brief: BRIEF, format: 'wide', media: [{ path: 'media/quan.mp4', kind: 'video', size: [1080, 1920] }] });
  assert.ok(user.includes(BRIEF) && user.includes('wide 16:9') && user.includes('- media/quan.mp4 (video, 1080×1920, portrait)'));
  assert.ok(userPrompt({ brief: BRIEF }).includes('Available media: none'));
});

test('a good first draft is saved as it is, with what is not the model\'s to decide set by Songbe', async () => {
  const dir = fresh('good'), m = scripted(GOOD);
  const steps = [], r = await writeSpec(dir, BRIEF, { ask: m.ask, format: 'square', onStep: (s) => steps.push(s.step) });
  assert.equal(r.rounds, 1); assert.deepEqual(r.left, []); assert.deepEqual(steps, ['write', 'check']); assert.equal(m.asked.length, 1);
  const saved = JSON.parse(fs.readFileSync(path.join(dir, 'video.json'), 'utf8'));
  assert.deepEqual(validate(saved, dir), []);
  assert.equal(saved.format, 'square'); assert.equal(saved.captions, true); assert.equal(saved.style, 'soft');
  assert.deepEqual(saved.voice, { voice: 'Casual_Guy', language: 'Vietnamese', speed: 1.08, emotion: 'happy' }, 'the voice comes from Songbe\'s own table, by language');
  assert.deepEqual(saved.scenes, GOOD.scenes); assert.equal(saved.brand.name, 'Mộc');
  assert.ok(r.seconds > 10 && r.seconds < 32);
});

test('findings go back to the model until the draft is clean', async () => {
  const dir = fresh('loop');
  const first = clone(GOOD, (s) => { s.scenes[0].titel = s.scenes[0].title; delete s.scenes[0].title; });                                   // a misspelt field: not valid
  const second = clone(GOOD, (s) => { s.scenes[0].title = ['Cà phê rang mộc thơm ngon nhất', 'mỗi sáng']; s.scenes[1].items[0].sub = 'Hơn 5.000 khách mỗi tháng'; });      // too long, and an invented number
  const m = scripted('Sure! Here is the video.', first, second, GOOD);
  const steps = [], r = await writeSpec(dir, BRIEF, { ask: m.ask, rounds: 4, onStep: (s) => steps.push(s.step) });
  assert.equal(r.rounds, 4); assert.deepEqual(r.left, []);
  assert.deepEqual(steps, ['write', 'fix', 'check', 'fix', 'check', 'fix', 'check']);
  assert.ok(m.asked[1].prompt.includes('was not one JSON object') && m.asked[1].prompt.includes('Sure! Here is the video.'));
  assert.ok(m.asked[2].prompt.includes('did you mean "title"'), 'the validator\'s own words');
  assert.ok(m.asked[3].prompt.includes('scenes[0].title line 1') && m.asked[3].prompt.includes('5000') && m.asked[3].prompt.includes('YOUR PREVIOUS DRAFT'));
  assert.ok(m.asked.every((q) => q.prompt.startsWith('BRIEF\n' + BRIEF)), 'the brief is in every request');
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, 'video.json'), 'utf8')).scenes, GOOD.scenes);
});

test('what could not be fixed is reported, and a draft that is not valid is never saved', async () => {
  const kept = clone(GOOD, (s) => { s.scenes[3].cta = 'Nhắn Zalo cho quán để đặt trước ngay hôm nay nhé'; });
  const r = await writeSpec(fresh('left'), BRIEF, { ask: scripted(kept).ask, rounds: 2 });
  assert.equal(r.rounds, 2); assert.ok(r.left.some((x) => x.includes('scenes[3].cta')), r.left.join('\n'));
  const dir = fresh('never'), broken = clone(GOOD, (s) => { s.scenes.push({ type: 'phone', say: 'Xem app.', title: ['Đặt qua', 'điện thoại'] }); });
  await assert.rejects(writeSpec(dir, BRIEF, { ask: scripted(broken).ask, rounds: 2 }), /could not produce a valid video after 2 tries[\s\S]*no screens/);
  await assert.rejects(writeSpec(dir, BRIEF, { ask: scripted({ brand: { name: 'x' }, scenes: [{ type: 'poster' }] }).ask, rounds: 1 }), /not valid/);
  assert.ok(!fs.existsSync(path.join(dir, 'video.json')));
});

test('an existing video is not written over, and the request itself is checked first', async () => {
  const dir = fresh('exists'); fs.writeFileSync(path.join(dir, 'video.json'), '{"mine": true}');
  const m = scripted(GOOD);
  await assert.rejects(writeSpec(dir, BRIEF, { ask: m.ask }), /already has a video\.json/);
  assert.equal(fs.readFileSync(path.join(dir, 'video.json'), 'utf8'), '{"mine": true}'); assert.equal(m.asked.length, 0);
  await writeSpec(dir, BRIEF, { ask: m.ask, force: true }); assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'video.json'), 'utf8')).brand.name, 'Mộc');
  await assert.rejects(writeSpec(fresh('short'), 'an ad', { ask: m.ask }), /Say a little more/);
  await assert.rejects(writeSpec(fresh('style'), BRIEF, { ask: m.ask, style: 'neon' }), /unknown style/);
  await assert.rejects(writeSpec(fresh('nokey'), BRIEF, { env: {} }), /needs a key/);
});

test('media in the project is offered to the model, and a logo is wired in', async () => {
  const dir = fresh('media'); fs.mkdirSync(path.join(dir, 'media'));
  fs.copyFileSync(path.join(ROOT, 'examples', 'app-launch-en', 'media', 'screen-today.png'), path.join(dir, 'media', 'man-hinh.png'));
  fs.copyFileSync(path.join(ROOT, 'examples', 'app-launch-en', 'media', 'mark.svg'), path.join(dir, 'media', 'logo.svg'));
  const withPhone = clone(GOOD, (s) => { s.scenes.splice(1, 1, { type: 'phone', say: 'Đặt trước ngay trên điện thoại.', title: ['Đặt trong', 'vài giây'], screens: ['media/man-hinh.png'], callouts: [{ text: 'Đặt trước', side: 'right', y: 0.3 }] }); });
  const m = scripted(withPhone), r = await writeSpec(dir, BRIEF, { ask: m.ask });
  assert.ok(m.asked[0].prompt.includes('- media/man-hinh.png (image'), 'the screenshot is listed'); assert.ok(!m.asked[0].prompt.includes('logo.svg'), 'the logo is not footage');
  assert.deepEqual(r.spec.brand.logo, { mark: 'media/logo.svg' }); assert.deepEqual(r.left, []);
});
