// Captions: the two forms of a line, word times, and how lines are broken.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spokenOf, shownOf, timedWords, captionLines } from '../src/captions.mjs';

const text = (words) => words.map((w) => w.text).join(' ');

test('{spoken|shown} gives the voice one form and the captions the other', () => {
  const raw = 'Call {zero nine hundred|0900} in {Vee Sip two|VSIP 2}.';
  assert.equal(spokenOf(raw), 'Call zero nine hundred in Vee Sip two.');
  assert.equal(shownOf(raw), 'Call 0900 in VSIP 2.');
  assert.equal(spokenOf('No markup here.'), 'No markup here.');
});

test('word times run forward inside the sentence', () => {
  const words = timedWords('Every plant gets its own page, with a schedule that adapts.', 10, 14);
  assert.equal(text(words), 'Every plant gets its own page, with a schedule that adapts.');
  assert.ok(words[0].t0 >= 10 && words.at(-1).t1 <= 14);
  for (let i = 1; i < words.length; i++) assert.ok(words[i].t0 >= words[i - 1].t0, `word ${i}`);
});

test('shown words take the time of the spoken ones they replace', () => {
  const words = timedWords('Ring {zero nine hundred, zero zero zero|0900 000} now.', 0, 6);
  assert.equal(text(words), 'Ring 0900 000 now.');
  const number = words.filter((w) => /\d/.test(w.text));
  assert.ok(number.at(-1).t1 - number[0].t0 > 3, 'the number is spoken for most of the sentence');
});

test('pauses heard in the clip set where each clause starts', () => {
  // one comma, one pause from 1.0 s to 1.6 s: the second clause must start when the voice resumes
  const words = timedWords('Download it now, it is free.', 20, 23, [[1.0, 1.6]]);
  const it = words.findIndex((w, i) => i > 2 && w.text === 'it');
  assert.ok(Math.abs(words[it].t0 - 21.6) < 0.01, `second clause starts at ${words[it].t0}`);
  assert.ok(words[it - 1].t1 <= 21.0 + 0.01, 'the first clause ends when the pause begins');
});

test('too few pauses falls back to sharing the time by word length', () => {
  const words = timedWords('One, two, three, four.', 0, 4, [[1.0, 1.3]]);
  assert.equal(words.length, 4);
  assert.ok(words.every((w) => w.t1 > w.t0));
});

test('lines keep every word, in order, and stay short', () => {
  const sentence = 'Sprout reminds you when to water, checks the light, and gives you a care guide for every plant.';
  for (const limit of [24, 27, 40]) {
    const lines = captionLines(timedWords(sentence, 0, 6), limit);
    assert.equal(lines.map((l) => text(l.words)).join(' '), sentence);
    for (const l of lines) assert.ok(text(l.words).length <= limit * 1.3 + 1, `"${text(l.words)}" at limit ${limit}`);
    for (let i = 1; i < lines.length; i++) assert.ok(lines[i].start >= lines[i - 1].start);
  }
});

test('a clause that fits is not split and no word is left alone', () => {
  const lines = captionLines(timedWords('Bạn đang tìm việc ở Bình Dương?', 0, 2), 24).map((l) => text(l.words));
  assert.deepEqual(lines, ['Bạn đang tìm việc ở Bình Dương?']);
  const long = captionLines(timedWords('Muốn biết lương và ca làm? Nhắn Zalo cho chúng tôi nhé.', 0, 4), 24).map((l) => text(l.words));
  assert.deepEqual(long, ['Muốn biết lương và ca làm?', 'Nhắn Zalo cho chúng tôi nhé.']);
  for (const l of captionLines(timedWords('A fairly long clause that certainly needs to be broken into several lines', 0, 5), 24)) assert.ok(l.words.length > 1);
});
