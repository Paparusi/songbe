// Lines by hand, on the canvas. A card is used by another by dragging from its port onto it — as the picture a clip starts
// on, as its line, as a reference, as a shot of a cut — and something new is made from a card by dropping its line on an empty
// place. A line is cut by clicking it. Each of these is one change to one node, and the server keeps it only when the canvas is
// still sound with it (no circle, nothing left without what it needs); the page says why when it is not.
// (Loaded before the canvas page's own script, whose S, el, api, list, bare, take, draw, panel, say, place, sizeOf, view, board,
// world and wires these use when they are called.)
const WORDS = ['text', 'person', 'place'], SVG = 'http://www.w3.org/2000/svg';

// what dropping card `a` onto card `b` can mean: [{ says, change(the node of b) }]
function linkWays(a, b) {
  const A = S.flow.nodes[a], B = S.flow.nodes[b], at = '@' + a, out = [], add = (says, change) => out.push({ says, change });
  if (!A || !B || a === b) return out;
  const into = (key) => (n) => { n[key] = `${String(n[key] || '').trim()} ${at}`.trim(); }, words = WORDS.includes(A.kind), bring = A.kind === 'text' ? 'Put its words into the prompt' : A.kind === 'person' ? 'Bring them into the prompt' : 'Bring it into the prompt';
  const refs = (n) => { n.refs = [...new Set([...list(n.refs), at])]; }, made = (n) => n.prompt !== undefined;
  if (B.kind === 'picture' && made(B)) { if (words) add(bring, into('prompt')); if (A.kind === 'picture') add('Hand it over as a reference', refs); }
  if (B.kind === 'picture' && A.kind === 'clip' && B.grab !== undefined) add(`Take the frame from this clip instead of ${bare(B.grab)}`, (n) => { n.grab = at; });
  if (B.kind === 'clip' && made(B)) {
    if (A.kind === 'picture') { add(B.frame ? `Start on it instead of ${bare(B.frame)}` : 'Start on it', (n) => { n.frame = at; }); add(B.end ? `End on it instead of ${bare(B.end)}` : 'End on it', (n) => { n.end = at; }); add('Hand it over as a reference', refs); }
    if (A.kind === 'voice') add(B.voice ? `It is the line of this clip instead of ${bare(B.voice)}` : 'It is the line of this clip', (n) => { n.voice = at; });
    if (words) add(bring, into('prompt'));
  }
  if (B.kind === 'clip' && A.kind === 'sound') add('Hear it in this clip (set the second in the clip’s panel)', (n) => { n.sounds = [...list(n.sounds), { sound: at, at: 0 }]; });
  if (B.kind === 'sound' && made(B) && A.kind === 'text') add(bring, into('prompt'));
  if (B.kind === 'voice' && B.text !== undefined) { if (A.kind === 'person') add('They say this line', (n) => { n.who = at; }); if (A.kind === 'clip' && bare(A.voice) === b) add('Record the line to the lips of this clip, after it is filmed', (n) => { n.fit = at; }); }
  if (B.kind === 'music' && made(B) && A.kind === 'text') add(bring, into('prompt'));
  if (B.kind === 'cut') { if (A.kind === 'clip') add('Add it as the last shot', (n) => { n.shots = [...list(n.shots), at]; }); if (A.kind === 'music') add(B.music ? `Play it under the cut instead of ${bare(B.music)}` : 'Play it under the cut', (n) => { n.music = at; }); }
  if (B.kind === 'text' && A.kind === 'text') add('Put its words into these', into('text'));
  return out;
}

// what can be made from card `a` when its line is dropped on an empty place: [{ says, nodes: [[name, node], …] }]
function linkNew(a) {
  const A = S.flow.nodes[a], at = '@' + a, name = (end) => { let id = `${a}-${end}`.slice(0, 44), k = 2; while (S.flow.nodes[id]) id = `${a}-${end}${k++}`.slice(0, 48); return id; };
  if (!A) return [];
  if (A.kind === 'picture') return [{ says: 'A clip that starts on it', nodes: [[name('clip'), { kind: 'clip', frame: at, prompt: 'Describe what happens.' }]] }, { says: 'Another picture made from it', nodes: [[name('next'), { kind: 'picture', prompt: `The same as ${at}, but ` }]] }];
  if (A.kind === 'clip') { const end = name('end'); return [{ says: 'A picture of its last frame', nodes: [[end, { kind: 'picture', grab: at, at: 'end' }]] }, { says: 'The clip that carries on from it', nodes: [[end, { kind: 'picture', grab: at, at: 'end' }], [name('on'), { kind: 'clip', frame: '@' + end, prompt: 'Describe what happens next.' }]] }, { says: 'A cut that begins with it', nodes: [[name('cut'), { kind: 'cut', shots: [at] }]] }]; }
  if (A.kind === 'voice') return [{ says: 'A clip in which it is said', nodes: [[name('clip'), { kind: 'clip', voice: at, prompt: 'Describe what happens.' }]] }];
  if (A.kind === 'text') return [{ says: 'A picture from these words', nodes: [[name('picture'), { kind: 'picture', prompt: at }]] }, { says: 'Music from these words', nodes: [[name('music'), { kind: 'music', prompt: `Instrumental, no vocals. ${at}` }]] }];
  if (A.kind === 'person') return [{ says: 'A picture of them', nodes: [[name('picture'), { kind: 'picture', prompt: `${at}. ` }]] }, { says: 'A line they say', nodes: [[name('line'), { kind: 'voice', who: at, text: 'The line.' }]] }];
  if (A.kind === 'place') return [{ says: 'A picture of it', nodes: [[name('picture'), { kind: 'picture', prompt: `${at}. A wide view of the whole place with nobody in it.` }]] }];
  return [];
}

// the node of `b` with every way it uses `a` taken out; null when it only uses `a` through something else it works from
function unlinked(a, b) {
  const n = structuredClone(S.flow.nodes[b]), had = JSON.stringify(n), named = new RegExp(`\\s*@${a}(?![a-z0-9-])`, 'g');
  for (const k of ['frame', 'end', 'voice', 'fit', 'music', 'who']) if (bare(n[k]) === a) delete n[k];
  if (bare(n.grab) === a) { delete n.grab; delete n.at; }
  if (n.refs !== undefined) { n.refs = list(n.refs).filter((r) => bare(r) !== a); if (!n.refs.length) delete n.refs; }
  if (Array.isArray(n.shots)) n.shots = n.shots.filter((s) => bare(typeof s === 'string' ? s : s?.clip) !== a);
  if (Array.isArray(n.sounds)) { n.sounds = n.sounds.filter((x) => bare(typeof x === 'string' ? x : x?.sound) !== a); if (!n.sounds.length) delete n.sounds; }
  for (const k of ['prompt', 'text']) if (typeof n[k] === 'string') n[k] = n[k].replace(named, '').trim();
  return JSON.stringify(n) === had ? null : n;
}

// where a note, a person or a place is brought in by name, and where a sound is set into a clip: [[from, to], …]. These are many (every picture names the look), so
// they are drawn for the chosen card only.
function softEdges() {
  const out = [], N = S.flow.nodes;
  for (const [id, n] of Object.entries(N)) { const from = new Set();
    for (const m of String((n.kind === 'text' ? n.text : n.prompt) || '').matchAll(/@([a-z0-9]+(?:-[a-z0-9]+)*)/g)) if (N[m[1]] && WORDS.includes(N[m[1]].kind) && m[1] !== id) from.add(m[1]);
    if (n.who && N[bare(n.who)]) from.add(bare(n.who));
    for (const x of list(n.sounds)) { const sid = bare(typeof x === 'string' ? x : x?.sound); if (N[sid]) from.add(sid); }      // the sounds set into a clip
    for (const a of from) out.push([a, id]); }
  return out;
}

// ---- doing it ----
async function saveNode(id, node) {      // one change to one node; true when the canvas kept it
  const x = await api('/api/node?id=' + encodeURIComponent(id), { method: 'PUT', body: JSON.stringify(node) }).then((r) => r.json());
  if (x.error || x.saved === false) { say(x.error || x.bad[0], true); return false; }
  take(x); sel = id; draw(); panel(); return true;
}
const hideChooser = () => document.getElementById('choose')?.remove();
function chooser(x, y, options) {      // a few things to choose from, at a place on the board
  hideChooser();
  board.append(el('div', { id: 'choose', style: `left:${Math.max(8, Math.min(x, board.clientWidth - 330))}px;top:${Math.max(8, Math.min(y, board.clientHeight - 38 * options.length - 24))}px` }, ...options.map((o) => el('button', { class: 'btn small', text: o.says, onclick: () => { hideChooser(); o.act(); } }))));
}
const toWorld = (e) => { const r = board.getBoundingClientRect(); return [(e.clientX - r.left - view.x) / view.k, (e.clientY - r.top - view.y) / view.k]; };

let linkPath = null, linkOver = null, wireSel = null;
function linkStart(a) {      // a line is pulled out of card `a`: the cards that can use it are shown
  linkPath = document.createElementNS(SVG, 'path'); linkPath.setAttribute('class', 'new'); linkShown(a);
}
// (the canvas is drawn again whenever something arrives — a price, a take that is done — also while a line is being pulled:
// what shows the pulling is put back each time)
function linkShown(a) {
  if (!linkPath) return; world.classList.add('linking'); linkOver = null;
  for (const n of world.querySelectorAll('.node')) { n.classList.toggle('from', n.dataset.id === a); n.classList.toggle('can', n.dataset.id !== a && linkWays(a, n.dataset.id).length > 0); }
  wires.append(linkPath);
}
function linkMove(a, e) {
  const [ax, ay] = place(a), [aw, ah] = sizeOf(a), [x, y] = toWorld(e), sx = ax + aw, sy = ay + ah / 2, bend = Math.max(50, Math.abs(x - sx) * .4);
  linkPath?.setAttribute('d', `M${sx},${sy} C${sx + bend},${sy} ${x - bend},${y} ${x},${y}`);
  const over = document.elementFromPoint(e.clientX, e.clientY)?.closest?.('.node.can') || null;
  if (over !== linkOver) { linkOver?.classList.remove('over'); over?.classList.add('over'); linkOver = over; }
}
function linkEnd(a, e, moved) {
  const under = document.elementFromPoint(e.clientX, e.clientY), target = under?.closest?.('.node'), r = board.getBoundingClientRect(), cx = e.clientX - r.left, cy = e.clientY - r.top;
  world.classList.remove('linking'); linkPath?.remove(); linkPath = null; linkOver = null; draw();
  if (!moved) return;
  if (target) {
    const b = target.dataset.id, ways = linkWays(a, b), act = (w) => { const node = structuredClone(S.flow.nodes[b]); w.change(node); saveNode(b, node); };
    if (!ways.length) return b === a ? null : say(`${b} has no use for ${a}.`, true);
    return ways.length === 1 ? act(ways[0]) : chooser(cx, cy, ways.map((w) => ({ says: w.says, act: () => act(w) })));
  }
  if (under?.closest?.('#script, #zoom, #log') || !under?.closest?.('#board')) return;
  const made = linkNew(a), [wx, wy] = toWorld(e);
  if (!made.length) return say('Drop it on a card that can use it.', true);
  chooser(cx, cy, made.map((m) => ({ says: m.says, act: async () => { let at = [Math.round(wx - 20), Math.round(wy - 40)]; for (const [id, node] of m.nodes) { if (!(await saveNode(id, { ...node, xy: at }))) return; at = [at[0] + 228, at[1]]; } } })));
}
function wirePick([a, b], e) {      // a line was clicked: it can be cut
  const r = board.getBoundingClientRect(); wireSel = [a, b]; draw();
  chooser(e.clientX - r.left, e.clientY - r.top, [{ says: `Cut this line: ${b} no longer uses ${a}`, act: () => { const node = unlinked(a, b); wireSel = null; if (node) return saveNode(b, node); draw(); say(`${b} uses ${a} through another card it works from; change that one.`, true); } }]);
}
