// The spec table: what the validator accepts, what it says about mistakes, and that the JSON Schema covers the same ground.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { validate, jsonSchema, SCENES, TEMPLATES, FORMATS, STYLES } from '../src/spec.mjs';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const example = (name) => [JSON.parse(fs.readFileSync(path.join(root, 'examples', name, 'video.json'), 'utf8')), path.join(root, 'examples', name)];

test('the bundled examples are valid', () => {
  for (const name of fs.readdirSync(path.join(root, 'examples'))) assert.deepEqual(validate(...example(name)), [], name);
});

test('every scene template is a valid scene', () => {
  for (const [type, scene] of Object.entries(TEMPLATES)) assert.deepEqual(validate({ brand: {}, scenes: [scene] }), [], type);
  assert.deepEqual(Object.keys(TEMPLATES).sort(), Object.keys(SCENES).sort());
});

test('typos are named and a correction is offered', () => {
  const errs = validate({ brand: { nam: 'x' }, scenes: [{ type: 'footge', say: 'hi' }, { type: 'card', say: 'x', titel: ['a'] }] });
  assert.ok(errs.some((e) => e.includes('video.brand.nam') && e.includes('"name"')));
  assert.ok(errs.some((e) => e.includes('scenes[0].type') && e.includes('"footage"')));
  assert.ok(errs.some((e) => e.includes('scenes[1].titel') && e.includes('"title"')));
  assert.ok(errs.some((e) => e === 'scenes[1].title: required'));
});

test('a scene needs something to say or a duration', () => {
  assert.ok(validate({ brand: {}, scenes: [{ type: 'end' }] }).some((e) => e.includes('"say" or a "duration"')));
  assert.deepEqual(validate({ brand: {}, scenes: [{ type: 'end', duration: 3 }] }), []);
});

test('missing files are reported with their place in the spec', () => {
  const [spec, dir] = example('recruitment-vi');
  spec.scenes[0].media = 'media/nope.mp4';
  assert.ok(validate(spec, dir).some((e) => e.includes('scenes[0].media') && e.includes('nope.mp4')));
});

test('style and format are limited to the known names', () => {
  assert.ok(validate({ brand: {}, style: 'loud', scenes: [{ type: 'end', duration: 2 }] }).some((e) => e.includes('video.style')));
  for (const style of STYLES) for (const format of Object.keys(FORMATS)) assert.deepEqual(validate({ brand: {}, style, format, scenes: [{ type: 'end', duration: 2 }] }), []);
});

test('the JSON Schema lists every scene type and the top-level fields', () => {
  const schema = jsonSchema();
  assert.deepEqual(schema.properties.scenes.items.oneOf.map((s) => s.properties.type.const).sort(), Object.keys(SCENES).sort());
  for (const k of ['brand', 'voice', 'music', 'style', 'format', 'captions']) assert.ok(schema.properties[k], k);
});
