// Songbe browser runtime. Every frame is a pure function of time: SB.draw(t) lays the whole stage out for second t,
// so the renderer can ask for any frame in any order and always get the same pixels.
(() => {
  const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
  const lerp = (a, b, k) => a + (b - a) * k;
  const seg = (t, a, b) => clamp((t - a) / (b - a));          // 0→1 while t goes a→b
  const ease = {
    outCubic: (x) => 1 - Math.pow(1 - x, 3),
    outQuint: (x) => 1 - Math.pow(1 - x, 5),
    inOut: (x) => (x < .5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2),
  };
  // damped spring measured in seconds: 0 → 1 with a small overshoot
  const spring = (s, z = .5, w = 13) => (s <= 0 ? 0 : 1 - Math.exp(-z * w * s) * Math.cos(w * Math.sqrt(1 - z * z) * s));

  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  // inline markup in spec strings: [[text]] = highlighted plate, **text** = accent colour
  const rich = (s) => esc(s).replace(/\[\[(.+?)\]\]/g, '<span class="hl">$1</span>').replace(/\*\*(.+?)\*\*/g, '<b class="ac">$1</b>');

  function tf(el, o) {
    el.style.transform = `translate(${o.x || 0}px,${o.y || 0}px) rotate(${o.r || 0}deg) scale(${o.s == null ? 1 : o.s})`;
    if (o.o != null) el.style.opacity = o.o;
  }
  // masked line slides up into place at t0
  function reveal(el, t, t0, dur = .62) {
    el.firstElementChild.style.transform = `translateY(${lerp(112, 0, ease.outQuint(seg(t, t0, t0 + dur)))}%)`;
  }
  // element pops in with a spring at t0
  function pop(el, t, t0, o = {}) {
    const s = spring(t - t0, o.z || .55, o.w || 13);
    tf(el, { s: lerp(o.from == null ? .6 : o.from, 1, s), y: lerp(o.dy || 0, 0, clamp(s)), r: lerp(o.r || 0, 0, clamp(s)), o: clamp((t - t0) * 9) });
  }
  // shrink a line's font until it fits the given width
  function fit(el, maxWidth) {
    let size = parseFloat(getComputedStyle(el).fontSize);
    while (el.scrollWidth > maxWidth && size > 24) { size -= 2; el.style.fontSize = size + 'px'; }
    return size;
  }

  const PIN = (size, colour) => `<svg width="${size}" height="${size}" viewBox="0 0 24 24" style="vertical-align:-${Math.round(size * .14)}px;margin-right:10px"><path fill="${colour}" d="M12 2a7 7 0 0 0-7 7c0 5.2 7 13 7 13s7-7.8 7-13a7 7 0 0 0-7-7zm0 9.6A2.6 2.6 0 1 1 12 6.4a2.6 2.6 0 0 1 0 5.2z"/></svg>`;

  // footage shown as an image whose source is swapped per frame (frames were extracted ahead of time)
  function mediaSrc(m, local) {
    if (!m) return null;
    if (m.kind === 'image') return m.src;
    const i = clamp(Math.round((local + (m.offset || 0)) * m.fps), 0, m.count - 1) + 1;
    return `${m.dir}/${String(i).padStart(4, '0')}.jpg`;
  }
  async function setImg(el, src) {
    if (src && el.getAttribute('src') !== src) { el.setAttribute('src', src); await el.decode().catch(() => {}); }
  }

  const SB = { clamp, lerp, seg, ease, spring, esc, rich, tf, reveal, pop, fit, PIN, mediaSrc, setImg, scenes: {}, live: [], cues: [] };

  SB.mount = async function (plan) {
    SB.plan = plan;
    const root = document.documentElement.style, b = plan.brand;
    for (const [k, v] of Object.entries({ ink: b.ink, primary: b.primary, accent: b.accent, paper: b.paper, muted: b.muted })) if (v) root.setProperty('--' + k, v);
    const stage = document.getElementById('stage');
    plan.scenes.forEach((sc, i) => {
      const el = document.createElement('div'); el.className = 'scene'; el.id = 's' + i; stage.appendChild(el);
      const inst = SB.scenes[sc.type](el, sc, plan, i);
      SB.live.push({ el, sc, inst });
    });
    stage.insertAdjacentHTML('beforeend',
      `<div id="wipe"><div id="w1" style="width:1900px;background:var(--primary)"></div><div id="w2" style="width:130px;background:var(--accent)"></div><div id="w3" style="width:30px;background:#fff"></div></div>
       <div id="notice"></div><div id="vignette"></div><canvas id="grain" width="540" height="960"></canvas>`);
    await document.fonts.ready;
    await Promise.all([...document.images].map((im) => im.decode().catch(() => 0)));
    for (const s of SB.live) if (s.inst.layout) s.inst.layout();
    // sound cues come from the same code that animates, so picture and sound cannot drift apart
    SB.cues = [];
    for (const c of plan.cuts) SB.cues.push({ t: c - .32, kind: 'whoosh' });
    for (const s of SB.live) for (const c of (s.inst.cues || [])) SB.cues.push({ t: s.sc.start + c.t, kind: c.kind, gain: c.gain });
    SB.cues.sort((a, b) => a.t - b.t);
    await SB.draw(0);
    return document.fonts.size;
  };

  SB.draw = async function (t) {
    const plan = SB.plan;
    for (const s of SB.live) {
      const on = t >= s.sc.start && t < s.sc.end;
      s.el.style.visibility = on ? 'visible' : 'hidden';
      if (on) await s.inst.draw(t - s.sc.start, t);
    }
    // a slab of brand colour sweeps across at every cut
    let sweeping = false;
    for (const c of plan.cuts) {
      const k = seg(t, c - .30, c + .34);
      if (k > 0 && k < 1) {
        sweeping = true; const x = lerp(-2300, 1300, ease.inOut(k));
        document.getElementById('w1').style.transform = `translateX(${x}px) skewX(-14deg)`;
        document.getElementById('w2').style.transform = `translateX(${x + 1930}px) skewX(-14deg)`;
        document.getElementById('w3').style.transform = `translateX(${x + 2090}px) skewX(-14deg)`;
      }
    }
    document.getElementById('wipe').style.visibility = sweeping ? 'visible' : 'hidden';
    const cur = SB.live.find((s) => t >= s.sc.start && t < s.sc.end), n = document.getElementById('notice');
    n.style.visibility = cur && cur.sc.notice ? 'visible' : 'hidden'; if (cur && cur.sc.notice) n.textContent = cur.sc.notice;
    // light film grain, reseeded per output frame
    const cv = document.getElementById('grain'), cx = cv.getContext('2d'), im = cx.createImageData(540, 960);
    let sd = (Math.floor(t * plan.fps) * 9301 + 49297) % 233280;
    for (let i = 0; i < im.data.length; i += 4) { sd = (sd * 9301 + 49297) % 233280; im.data[i] = im.data[i + 1] = im.data[i + 2] = sd / 233280 * 255; im.data[i + 3] = 255; }
    cx.putImageData(im, 0, 0);
  };

  // Preview in a normal browser: scale to the window and add a scrubber. The renderer opens the page with #render and never sees this.
  SB.preview = function () {
    const plan = SB.plan, stage = document.getElementById('stage');
    const scale = () => { const k = Math.min(innerWidth / plan.size[0], (innerHeight - 56) / plan.size[1]); stage.style.transform = `scale(${k})`; stage.style.left = (innerWidth - plan.size[0] * k) / 2 + 'px'; };
    scale(); addEventListener('resize', scale);
    document.body.insertAdjacentHTML('beforeend', `<div id="player"><button id="pp">Play</button><input id="sk" type="range" min="0" max="${plan.duration}" step="0.01" value="0"><span id="tt">0.00</span></div>`);
    const sk = document.getElementById('sk'), pp = document.getElementById('pp'), tt = document.getElementById('tt');
    const audio = plan.previewAudio ? new Audio(plan.previewAudio) : null;
    let playing = false, t0 = 0, base = 0, busy = false;
    const show = async (t) => { if (busy) return; busy = true; sk.value = t; tt.textContent = t.toFixed(2); await SB.draw(t); busy = false; };
    const tick = () => { if (!playing) return; const t = base + (performance.now() - t0) / 1000; if (t >= plan.duration) { playing = false; pp.textContent = 'Play'; if (audio) audio.pause(); return; } show(t); requestAnimationFrame(tick); };
    pp.onclick = () => { playing = !playing; pp.textContent = playing ? 'Pause' : 'Play'; base = +sk.value >= plan.duration - .05 ? 0 : +sk.value; t0 = performance.now(); if (audio) { audio.currentTime = base; playing ? audio.play() : audio.pause(); } tick(); };
    sk.oninput = () => { playing = false; pp.textContent = 'Play'; if (audio) audio.pause(); show(+sk.value); };
  };

  window.SB = SB;
})();
