// The script of a film, changed from the canvas window: the series (its look, its cast and places, its models, the episodes it
// plans) and the shot table of each episode. What is typed is saved a moment later — kept only when the series and every script
// are still sound with it — and the director then brings the canvas up to it, so exactly the cards that work from what changed
// are to be made again. Nothing here asks a model for anything.
// (Loaded after the canvas page's own script: it uses that page's $, el, api, take, draw, panel, list and S. Text from the files
// is always set as text, never as markup.)
(() => {
  const box = $('#script'), body = $('#sbody'), tabs = $('#stabs'), tag = $('#sstate'), told = $('#snote');
  const ROLES = [['picture', 'Pictures'], ['clip', 'Clips nobody speaks in'], ['talk', 'Clips someone speaks in'], ['voice', 'Voices'], ['music', 'Music'], ['sound', 'Sounds']];
  let W = null, tab = 'series', timer = null, sending = false, again = false, problems = [];

  // ---- small parts ----
  const set = (obj, key, v) => { if (v === undefined || v === null || v === '') delete obj[key]; else obj[key] = v; touch(); };
  const inp = (obj, key, hint = '', more = {}) => el('input', { type: 'text', value: obj[key] ?? '', placeholder: hint, oninput: (e) => set(obj, key, e.target.value), ...more });
  const num = (obj, key, hint = '', more = {}) => el('input', { type: 'number', value: obj[key] ?? '', placeholder: hint, oninput: (e) => set(obj, key, e.target.value === '' ? undefined : +e.target.value), ...more });
  const area = (obj, key, rows = 2, hint = '') => el('textarea', { rows, placeholder: hint, oninput: (e) => set(obj, key, e.target.value) }, document.createTextNode(obj[key] ?? ''));
  const pick = (value, options, onpick, none) => el('select', { onchange: (e) => onpick(e.target.value) }, ...(none === undefined ? [] : [el('option', { value: '', text: none })]), ...options.map(([v, t]) => el('option', { value: v, text: t, selected: v === value })));
  const f = (label, input, cls = '') => el('div', { class: 'sf ' + cls }, el('label', { text: label }), input);
  const row = (...kids) => el('div', { class: 'sr' }, ...kids), acts = (...kids) => el('div', { class: 'sa' }, ...kids);
  const h3 = (text, ...kids) => el('h3', {}, text, ...kids);
  const small = (text, onclick, more = {}) => el('button', { class: 'btn small', text, onclick, ...more });
  // a button that wants a second click before it removes something
  const sure = (text, act) => { let armed = 0; const b = el('button', { class: 'btn small stop', text, onclick: () => { if (Date.now() - armed < 4000) return act(); armed = Date.now(); b.textContent = 'Click again to remove'; setTimeout(() => { b.textContent = text; }, 4000); } }); return b; };
  const slug = (name) => String(name).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').replace(/^(\d)/, 'n$1').slice(0, 24).replace(/-+$/, '');
  const shotsOf = (ep) => (ep?.scenes || []).flatMap((sc) => sc.shots || []);
  const modelList = (kind) => { const id = 'smodels-' + kind; if (!document.getElementById(id)) document.body.append(el('datalist', { id }, ...Object.entries(S.models.known).filter(([, m]) => m.kind === kind).map(([name]) => el('option', { value: name })))); return id; };

  // ---- saving ----
  // the series as it goes to the file: without the empty holders the form made for what nobody filled in
  const script = (ep) => { const c = structuredClone(ep); if (c.models && !Object.keys(c.models).length) delete c.models; return c; };
  const whole = (series) => { const c = structuredClone(series); if (c.models && !Object.keys(c.models).length) delete c.models; for (const p of Object.values(c.cast || {})) if (p.voice && !Object.keys(p.voice).length) delete p.voice; return c; };
  function touch() { tag.textContent = 'saving…'; tag.className = 'tag'; clearTimeout(timer); timer = setTimeout(send, 700); }
  async function send() {
    clearTimeout(timer); timer = null;
    if (sending) { again = true; return; }
    sending = true; const what = tab;
    try {
      const x = await api(what === 'series' ? '/api/series' : '/api/script?episode=' + what, { method: 'PUT', body: JSON.stringify(what === 'series' ? whole(W.series) : script(W.episodes[what])) }).then((r) => r.json());
      if (x.error || x.saved === false) { problems = x.bad || [x.error]; tag.textContent = 'not saved'; tag.className = 'tag warn'; told.textContent = ''; }
      else {
        problems = []; W.seconds = x.seconds || W.seconds; tag.textContent = 'saved'; tag.className = 'tag on';
        const c = x.changed, parts = [c.added.length && `${c.added.length} added`, c.updated.length && `${c.updated.length} written again`, c.removed.length && `${c.removed.length} removed`].filter(Boolean);
        told.textContent = (parts.length ? `On the canvas: ${parts.join(', ')}.` : 'Nothing on the canvas had to change.') + (c.kept.length ? ` Left as you changed them: ${c.kept.slice(0, 5).join(', ')}${c.kept.length > 5 ? '…' : ''}.` : '')
          + (c.held?.length ? ` Held, so that they stay the same person in other clothes: ${c.held.join(', ')}.` : '');
        take(x); draw(); panel(); lengths(); thumbs();
      }
      showProblems();
    } catch (e) { tag.textContent = 'not saved'; tag.className = 'tag warn'; problems = ['The app did not answer: ' + e.message]; showProblems(); }
    finally { sending = false; if (again) { again = false; send(); } }
  }
  const showProblems = () => $('#sbad').replaceChildren(...problems.slice(0, 8).map((b) => el('div', { class: 'msg bad', text: b })), ...(problems.length > 8 ? [el('div', { class: 'msg bad', text: `… and ${problems.length - 8} more` })] : []));
  const lengths = () => { for (const s of body.querySelectorAll('[data-runs]')) { const t = W.seconds?.[s.dataset.runs]; s.textContent = t ? `about ${Math.round(t)} s on screen` : ''; } };

  // ---- the series ----
  function usedIn(kind, id) {      // where the scripts use someone of the cast or a place: ["episode 1: shots 2, 5", …]
    return Object.entries(W.episodes).map(([n, ep]) => { const at = kind === 'place' ? (ep.scenes || []).map((sc, i) => (sc.where === id ? `scene ${i + 1}` : null)).filter(Boolean) : shotsOf(ep).filter((x) => (x.who || []).includes(id) || x.line?.who === id).map((x) => x.id);
      return at.length ? `episode ${n}: ${kind === 'place' ? at.join(', ') : 'shots ' + at.join(', ')}` : null; }).filter(Boolean);
  }
  function seriesForm() {
    const s = W.series, kids = [];
    kids.push(row(f('Title', inp(s, 'title')), f('In one sentence', inp(s, 'logline'))),
      f('The medium: what kind of picture this is', inp(s, 'style', 'Photorealistic live action, natural skin, a still from a 35mm film')),
      f('The look of every picture: light, lens, colours, era and country', area(s, 'look', 3)),
      row(f('The tone, for the music and the acting', inp(s, 'tone')), f('How the voices sound', inp(s, 'accent', 'Southern Vietnamese (Saigon) accent'))),
      row(f('An episode runs about (seconds)', num(s, 'seconds', '60', { min: 5, max: 600 })), f('A run may spend ($)', num(s, 'budget', '5', { min: 0, step: 1 })), f('Asked again by itself when a take cannot be used', num(s, 'retakes', '1', { min: 0, max: 3 }))));
    kids.push(h3('Models'), el('div', { class: 'msg note', text: 'One for each kind of work; any card on the canvas may name its own. A short name from the list, or fal:<endpoint>, or google:<model id>.' }));
    s.models ||= {};
    kids.push(row(...ROLES.slice(0, 3).map(([role, label]) => f(label, inp(s.models, role, 'the first your keys reach', { list: modelList(role === 'talk' ? 'clip' : role) })))), row(...ROLES.slice(3).map(([role, label]) => f(label, inp(s.models, role, 'the first your keys reach', { list: modelList(role) })))));
    kids.push(h3('Cast'));
    for (const [id, c] of Object.entries(s.cast || {})) {
      const voices = W.voices ? Object.entries(W.voices[c.gender === 'male' ? 'male' : 'female'] || {}).map(([name, sounds]) => [name, `${name} — ${sounds}`]) : null; c.voice ||= {};
      kids.push(el('div', { class: 'scard' }, el('div', { class: 'hd' }, el('b', { text: c.name || id }), el('span', { class: 'tag', text: id }), el('div', { class: 'gap' }), sure('Remove', () => { const used = usedIn('cast', id); if (used.length) return note(`${c.name || id} is in ${used.join('; ')}. Take them out of those shots first.`); delete s.cast[id]; render(); touch(); })),
        row(f('Name', inp(c, 'name')), f('Who they are in the story', inp(c, 'role')), f('', pick(c.gender || 'female', [['female', 'a woman'], ['male', 'a man']], (v) => { c.gender = v; render(); touch(); }), 'fix')),
        f('Face and body: age, build, skin, hair, and one thing that sets them apart', area(c, 'look', 2)), f('The one outfit they wear through the series', area(c, 'wardrobe', 2)),
        row(f('How they speak and carry themselves', inp(c, 'manner')), f('Voice', voices ? pick(c.voice.voice || '', voices, (v) => set(c.voice, 'voice', v), '—') : inp(c.voice, 'voice')), f('How the voice sounds', inp(c.voice, 'style', 'low, tired, slow')))));
    }
    kids.push(adder('A new person: their name', (name) => { const id = slug(name); if (!id) return 'Give them a name.'; if (s.cast?.[id] || s.places?.[id]) return 'That name is taken.'; (s.cast ||= {})[id] = { name: name.trim(), gender: 'female' }; }));
    kids.push(h3('Places'));
    for (const [id, p] of Object.entries(s.places || {})) kids.push(el('div', { class: 'scard' }, el('div', { class: 'hd' }, el('b', { text: p.name || id }), el('span', { class: 'tag', text: id }), el('div', { class: 'gap' }), sure('Remove', () => { const used = usedIn('place', id); if (used.length) return note(`${p.name || id} is where ${used.join('; ')} ${used.length > 1 ? 'are' : 'is'} set. Move those scenes first.`); delete s.places[id]; render(); touch(); })),
      f('Name', inp(p, 'name')), f('A set designer’s note: size, furniture, materials, colours, where the light comes from. No people', area(p, 'look', 3))));
    kids.push(adder('A new place: its name', (name) => { const id = slug(name); if (!id) return 'Give it a name.'; if (s.cast?.[id] || s.places?.[id]) return 'That name is taken.'; (s.places ||= {})[id] = { name: name.trim() }; }));
    // the sounds the story turns on: each is made once and is the same every time; shots say at which second it is heard
    kids.push(h3('Sounds'), el('div', { class: 'msg note', text: 'Only a sound the story turns on and that must be the same every time: a knock on a wall, a phone ringing. Each is made once; a shot says at which second it is heard. Ordinary background belongs to the shots.' }));
    for (const [id, x] of Object.entries(s.sounds || {})) kids.push(el('div', { class: 'scard' }, el('div', { class: 'hd' }, el('b', { text: x.name || id }), el('span', { class: 'tag', text: id }), el('div', { class: 'gap' }), sure('Remove', () => { const used = Object.entries(W.episodes).map(([n, ep]) => { const at = shotsOf(ep).filter((sh) => (sh.hear || []).some((h) => h.sound === id)).map((sh) => sh.id); return at.length ? `episode ${n}: shots ${at.join(', ')}` : null; }).filter(Boolean);
        if (used.length) return note(`${x.name || id} is heard in ${used.join('; ')}. Take it out of those shots first.`); delete s.sounds[id]; if (!Object.keys(s.sounds).length) delete s.sounds; render(); touch(); })),
      row(f('Name', inp(x, 'name')), f('Seconds', num(x, 'seconds', '3', { min: .5, max: 30, step: .5 }), 'narrow')), f('What is heard: one sound, in a few words of English, with nothing before or after it', area(x, 'prompt', 2))));
    kids.push(adder('A new sound: its name', (name) => { const id = slug(name); if (!id) return 'Give it a name.'; if (s.cast?.[id] || s.places?.[id] || s.sounds?.[id]) return 'That name is taken.'; (s.sounds ||= {})[id] = { name: name.trim() }; }));
    kids.push(h3('Episodes planned'), el('div', { class: 'msg note', text: 'What happens in each, in two or three sentences. The writer writes an episode’s shots from this; the tabs above hold the shots.' }));
    (s.episodes ||= []).forEach((e, i) => kids.push(el('div', { class: 'scard' }, el('div', { class: 'hd' }, el('b', { text: `Episode ${i + 1}` }), el('span', { class: 'tag' + (W.episodes[i + 1] ? ' on' : ''), text: W.episodes[i + 1] ? 'has its script' : 'no script yet' }), el('div', { class: 'gap' }),
      i === s.episodes.length - 1 && !W.episodes[i + 1] && i > 0 ? sure('Remove', () => { s.episodes.pop(); render(); touch(); }) : null), f('Title', inp(e, 'title')), f('What happens, what it opens on, the question it ends on', area(e, 'summary', 2)))));
    kids.push(acts(small('+ Another episode', () => { s.episodes.push({ title: `Episode ${s.episodes.length + 1}`, summary: '' }); render(); touch(); })));
    return kids;
  }
  // a line to type a name into, and a button: for a new person or place
  function adder(hint, add) {
    const name = el('input', { type: 'text', placeholder: hint }), msg = el('span', { class: 'msg bad' }), go = () => { const said = add(name.value); if (said) return (msg.textContent = said); render(); touch(); };
    name.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
    return el('div', { class: 'sr', style: 'margin-top:10px' }, name, el('div', { class: 'fix' }, small('+ Add', go)), el('div', { class: 'fix' }, msg));
  }

  // ---- an episode ----
  const nextId = (ep, after) => {      // a name for a new shot that renames no other: "3b" after "3", else the next number
    const taken = new Set(shotsOf(ep).map((x) => String(x.id)));
    if (after) { const base = /^(\d+)/.exec(after)?.[1]; if (base) for (const c of 'bcdefghijklmnopqrstuvwxyz') if (!taken.has(base + c)) return base + c; }
    let n = Math.max(0, ...[...taken].map((x) => parseInt(x, 10) || 0)) + 1; while (taken.has(String(n))) n++; return String(n);
  };
  function episodeForm(n) {
    const s = W.series, ep = W.episodes[n], plan = s.episodes?.[n - 1] || {}, cast = Object.entries(s.cast || {}), places = Object.entries(s.places || {}).map(([id, p]) => [id, p.name || id]);
    if (!ep) {      // planned, not written: the writer writes it, or it is started by hand
      return [el('div', { class: 'scard' }, el('div', { class: 'hd' }, el('b', { text: `Episode ${n}: ${plan.title || ''}` })), el('div', { class: 'msg note', text: plan.summary || '' }),
        el('div', { class: 'msg note', style: 'margin-top:8px', text: 'This episode has no shots yet. The writer writes them from the series and from the episodes before it (the Episodes menu above the canvas: “Write episode…”). Or begin with one empty shot and write them here yourself.' }),
        acts(n === (s.episodes || []).findIndex((_, i) => !W.episodes[i + 1]) + 1 && !S.episodes?.writing ? el('button', { class: 'btn small go', text: 'Have it written', title: 'The writer writes its shots from the series and the episodes before it', onclick: async (e) => { e.target.disabled = true;
          const x = await api('/api/episode', { method: 'POST', body: '{}' }).then((r) => r.json()); if (x.error) { e.target.disabled = false; return note(x.error.split('\n')[0]); }
          note(`Episode ${n} is being written…`); take(await api('/api/state').then((r) => r.json())); draw(); } }) : null, small('Write it here, by hand', () => { W.episodes[n] = { title: plan.title || `Episode ${n}`, ...(plan.summary ? { summary: plan.summary } : {}), scenes: [{ where: places[0]?.[0], time: '', staging: '', shots: [{ id: '1', size: 'medium', who: [], action: '' }] }] }; render(); })))];
    }
    const own = (ep.models ||= {}), theirs = (role) => s.models?.[role] || 'the series’';
    const kids = [row(f('Title', inp(ep, 'title')), f('Music: mood, instruments, tempo', inp(ep, 'music'))), f('What happens', area(ep, 'summary', 2)),
      row(f('This episode’s clips nobody speaks in are filmed by', inp(own, 'clip', theirs('clip'), { list: modelList('clip') })), f('… and those someone speaks in by', inp(own, 'talk', theirs('talk'), { list: modelList('clip') }))), el('div', { class: 'msg note', 'data-runs': n })];
    (ep.scenes ||= []).forEach((scene, si) => {
      const card = el('div', { class: 'scard' }, el('div', { class: 'hd' }, el('b', { text: `Scene ${si + 1}` }), el('div', { class: 'gap' }), ep.scenes.length > 1 ? sure('Remove the scene', () => { ep.scenes.splice(si, 1); render(); touch(); }) : null),
        row(f('Where', pick(scene.where, places, (v) => set(scene, 'where', v))), f('When: the hour and the light', inp(scene, 'time', 'late night, one desk lamp, rain outside'))),
        f('Staging: where everyone stands or sits, left and right, and the state of the room. Every frame of the scene is drawn from this', area(scene, 'staging', 2)));
      (scene.shots ||= []).forEach((shot, ki) => card.append(shotRow(n, ep, scene, si, ki, shot, cast)));
      card.append(acts(small('+ A shot at the end of this scene', () => { const last = scene.shots.at(-1); scene.shots.push({ id: nextId(ep), size: 'medium', who: [...(last?.who || [])], action: '' }); render(); focusShot(scene.shots.at(-1).id); })));
      kids.push(card);
    });
    kids.push(acts(small('+ Another scene', () => { ep.scenes.push({ where: places[0]?.[0], time: '', staging: '', shots: [{ id: nextId(ep), size: 'wide', who: [], action: '' }] }); render(); })));
    return kids;
  }
  // the first frame of a shot as it stands on the canvas, and whether its clip is made; a click chooses the clip's card there
  function paint(t) {
    const id = t.dataset.thumb, frame = rows.get(id + '-frame'), clip = rows.get(id), made = !!clip && ['ready', 'held', 'own'].includes(clip.state);
    t.replaceChildren(frame?.url ? el('img', { src: frame.url, loading: 'lazy', draggable: 'false', style: `aspect-ratio:${frameRatio()}` }) : el('div', { class: 'none', style: `aspect-ratio:${frameRatio()}`, text: clip ? 'no picture yet' : 'new' }),
      el('span', { class: 'tag' + (made ? (clip.review ? ' warn' : ' on') : ''), text: !clip ? 'not on the canvas yet' : made ? (clip.review ? 'clip made · look' : 'clip made') : 'clip to make' }));
  }
  const thumbs = () => { for (const t of body.querySelectorAll('[data-thumb]')) paint(t); };
  function shotRow(n, ep, scene, si, ki, shot, cast) {
    const scenes = ep.scenes, speaker = shot.line?.who || '', node = `e${n}-s${shot.id}`;
    const thumb = el('div', { class: 'thumb fix' + (frameRatio() > 1 ? ' wide' : ''), 'data-thumb': node, title: 'Show this shot on the canvas', onclick: () => { if (S.flow.nodes[node]) { sel = node; draw(); panel(); } } }); paint(thumb);
    const move = (by) => {      // up or down one place, through the edge of its scene into the one beside it
      const to = ki + by; scene.shots.splice(ki, 1);
      if (to >= 0 && to <= scene.shots.length) scene.shots.splice(to, 0, shot); else if (by < 0) scenes[si - 1].shots.push(shot); else scenes[si + 1].shots.unshift(shot);
      for (const sc of scenes) if (sc.shots[0]?.continues) delete sc.shots[0].continues;      // the first shot of a scene has nothing to carry on from
      if (!scene.shots.length) scenes.splice(si, 1); render(); focusShot(shot.id); touch();
    };
    const first = si === 0 && ki === 0, last = si === scenes.length - 1 && ki === scene.shots.length - 1;
    const who = el('div', { class: 'chips' }, ...cast.map(([id, c]) => el('button', { class: 'chip' + ((shot.who || []).includes(id) ? ' on' : ''), text: c.name || id, title: 'Seen in this frame', onclick: (e) => { const now = new Set(shot.who || []); if (now.has(id)) now.delete(id); else now.add(id); shot.who = cast.map(([x]) => x).filter((x) => now.has(x)); e.target.classList.toggle('on'); model.placeholder = theirs(); touch(); } })));
    // the model this shot is filmed by when it names none: the episode's or the series', for a shot someone seen speaks in or not
    const theirs = () => { const role = shot.line && (shot.who || []).includes(shot.line.who) ? 'talk' : 'clip'; return ep.models?.[role] || W.series.models?.[role] || 'the series’'; }, model = inp(shot, 'model', theirs(), { list: modelList('clip') });
    const lineText = el('input', { type: 'text', value: shot.line?.text || '', placeholder: speaker ? 'What they say' : 'Nobody speaks in this shot', disabled: !speaker, oninput: (e) => { shot.line.text = e.target.value; touch(); } });
    const lineHow = el('input', { type: 'text', value: shot.line?.how || '', placeholder: 'quiet, hurt, holding back', disabled: !speaker, oninput: (e) => set(shot.line, 'how', e.target.value) });
    return el('div', { class: 'shot', 'data-shot': shot.id },
      el('div', { class: 'sr' }, el('div', { class: 'fix n', text: shot.id }), f('Size', pick(shot.size, W.sizes.map((x) => [x, x]), (v) => set(shot, 'size', v))), f('Camera', inp(shot, 'camera', 'static')), f('Seconds', num(shot, 'seconds', speaker ? 'auto' : '4', { min: 1, max: 15, step: .5 }), 'narrow'),
        f('Model', model),
        el('div', { class: 'fix tools' }, small('↑', () => move(-1), { disabled: first, title: 'Earlier' }), small('↓', () => move(1), { disabled: last, title: 'Later' }), small('+', () => { scene.shots.splice(ki + 1, 0, { id: nextId(ep, String(shot.id)), size: shot.size === 'close' ? 'over shoulder' : 'close', who: [...(shot.who || [])], action: '' }); render(); focusShot(scene.shots[ki + 1].id); }, { title: 'A new shot after this one' }),
          shotsOf(ep).length > 1 ? sure('✕', () => { scene.shots.splice(ki, 1); if (scene.shots[0]?.continues) delete scene.shots[0].continues; if (!scene.shots.length) scenes.splice(si, 1); render(); touch(); }) : null)),
      el('div', { class: 'sbx' }, el('div', { class: 'col' },
        el('div', { class: 'sr' }, f('In the frame', who), ki > 0 ? f('', el('label', { class: 'tick', title: 'It starts on the last frame of the shot before it' }, el('input', { type: 'checkbox', checked: !!shot.continues, onchange: (e) => set(shot, 'continues', e.target.checked || undefined) }), ' carries on from the shot before'), 'fix') : null),
        f('What is seen: one simple action, beginning with the person’s name', area(shot, 'action', 2)),
        el('div', { class: 'sr' }, f('Says it', pick(speaker, cast.map(([id, c]) => [id, c.name || id]), (v) => { if (!v) delete shot.line; else shot.line = { ...(shot.line || { text: '' }), who: v }; lineText.disabled = lineHow.disabled = !v; lineText.placeholder = v ? 'What they say' : 'Nobody speaks in this shot'; model.placeholder = theirs(); if (v) lineText.focus(); touch(); }, 'nobody'), 'narrow2'), f(shot.line && !(shot.who || []).includes(speaker) ? 'The line (heard from off screen)' : 'The line', lineText, 'wide'), f('How it is said', lineHow)),
        f('Heard besides voices', inp(shot, 'sound', 'room tone, rain, a door')),
        // the sounds of the series set into this shot: which, and the second each begins
        Object.keys(W.series.sounds || {}).length ? f(`Sounds of the series heard in it, and the second each begins (${Object.keys(W.series.sounds).join(', ')}) — like: ${Object.keys(W.series.sounds)[0]} 1, ${Object.keys(W.series.sounds)[0]} 2.5`, el('input', { type: 'text', value: (shot.hear || []).map((h) => `${h.sound} ${h.at ?? 0}`).join(', '), placeholder: 'none',
          oninput: (e) => { const all = e.target.value.split(',').map((p) => p.trim()).filter(Boolean).map((p) => { const [id, at] = p.split(/\s+/); return { sound: id, at: +at || 0 }; }); set(shot, 'hear', all.length ? all : undefined); } })) : null), thumb));
  }
  const focusShot = (id) => { const r = body.querySelector(`[data-shot="${CSS.escape(String(id))}"] textarea`); if (r) { r.scrollIntoView({ block: 'center' }); r.focus(); } };

  // ---- the drawer ----
  const note = (text) => { told.textContent = text; };
  function render() {
    const eps = W.series?.episodes || [];
    tabs.replaceChildren(el('button', { class: 'btn small' + (tab === 'series' ? ' on' : ''), text: 'Series', onclick: () => go('series') }),
      ...eps.map((e, i) => el('button', { class: 'btn small' + (tab === i + 1 ? ' on' : '') + (W.episodes[i + 1] ? '' : ' dim'), text: `Episode ${i + 1}`, title: e.title || '', onclick: () => go(i + 1) })));
    const keep = body.scrollTop; body.replaceChildren(el('div', { id: 'sbad' }), ...(tab === 'series' ? seriesForm() : episodeForm(tab))); body.scrollTop = keep; showProblems(); lengths();
  }
  async function go(to) { if (timer) await send(); tab = to; problems = []; told.textContent = ''; tag.textContent = ''; render(); body.scrollTop = 0; }
  async function load() {
    const x = await api('/api/script').then((r) => r.json());
    if (!x.series) { W = null; return false; }
    W = { ...x, episodes: Object.fromEntries(Object.entries(x.episodes || {}).map(([k, v]) => [+k, v])) }; if (tab !== 'series' && tab > (W.series.episodes?.length || 0)) tab = 'series';
    if (x.error) problems = [x.error]; render(); return true;
  }
  async function open(to) { if (!(await load())) return say('This canvas has no series to change: it was not made from an idea.', true); if (to) tab = to; render(); box.hidden = false; tag.textContent = ''; told.textContent = ''; }
  $('#scriptb').addEventListener('click', () => (box.hidden ? open() : close()));
  const close = async () => { if (timer) await send(); box.hidden = true; };
  $('#sclose').addEventListener('click', close);
  // an episode written from the canvas menu while the drawer is open appears in it
  let failed = null;
  window.scriptSeen = (state) => { if (box.hidden || !W) return; thumbs(); const f = state.episodes?.failed || null; if (f && f !== failed) note(f.split('\n')[0]); failed = f; if (timer || sending) return; const now = (state.episodes?.written || []).join(), had = Object.keys(W.episodes).join(); if (now !== had) load(); };
  window.scriptOpen = open;
})();
