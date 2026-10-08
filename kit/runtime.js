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
  // a masked line arrives at t0: it rises from below (soft) or is wiped in from the left (bold)
  function reveal(el, t, t0, dur = .62) {
    const st = el.firstElementChild.style;
    if (SB.style.reveal === 'wipe') {
      const k = ease.outQuint(seg(t, t0, t0 + dur * .8));
      st.transform = `translateX(${lerp(-46, 0, k)}px)`; st.clipPath = `inset(-45% ${((1 - k) * 100).toFixed(2)}% -35% -2%)`;
    } else st.transform = `translateY(${lerp(112, 0, ease.outQuint(seg(t, t0, t0 + dur)))}%)`;
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

  // What a style changes besides its style sheet (kit/styles/<name>.css): headline scale and leading, how lines arrive, how cuts are covered.
  const STYLES = {
    soft: { title: { scale: 1, lead: 0 }, reveal: 'rise', wipe: 'slab' },
    bold: { title: { scale: 1.34, lead: 1.2, boxLead: 1.38 }, reveal: 'wipe', wipe: 'curtain' },   // leading leaves room for stacked Vietnamese accents
  };

  const SB = { clamp, lerp, seg, ease, spring, esc, rich, tf, reveal, pop, fit, PIN, mediaSrc, setImg, scenes: {}, live: [], cues: [], styles: STYLES, style: STYLES.soft };

  SB.mount = async function (plan) {
    SB.plan = plan;
    SB.style = STYLES[plan.style] || STYLES.soft;
    document.documentElement.dataset.style = STYLES[plan.style] ? plan.style : 'soft';
    // the frame: its size and which family of layouts applies (tall 9:16, square 1:1 or 4:5, wide 16:9)
    const [W, H] = plan.size, ratio = W / H;
    SB.frame = { W, H, kind: ratio < .7 ? 'tall' : ratio > 1.3 ? 'wide' : 'square' };
    document.documentElement.dataset.format = SB.frame.kind;
    const root = document.documentElement.style, b = plan.brand;
    for (const [k, v] of Object.entries({ ink: b.ink, primary: b.primary, accent: b.accent, paper: b.paper, muted: b.muted })) if (v) root.setProperty('--' + k, v);
    const stage = document.getElementById('stage');
    stage.style.width = W + 'px'; stage.style.height = H + 'px';
    plan.scenes.forEach((sc, i) => {
      const el = document.createElement('div'); el.className = 'scene'; el.id = 's' + i; stage.appendChild(el);
      const inst = SB.scenes[sc.type](el, sc, plan, i);
      SB.live.push({ el, sc, inst });
    });
    stage.insertAdjacentHTML('beforeend',
      `<div id="wipe"><div id="w1"></div><div id="w2"></div><div id="w3"></div></div>
       <div id="notice"></div><div id="vignette"></div><canvas id="grain" width="${Math.round(W / 2)}" height="${Math.round(H / 2)}"></canvas>`);
    // the cut cover and the grain are sized from the frame (the numbers are the 1080×1920 design, scaled)
    const sx = W / 1080, sy = H / 1920, band = (i) => document.getElementById('w' + i).style;
    if (SB.style.wipe === 'curtain') [2600, 160, 40].forEach((h, i) => Object.assign(band(i + 1), { left: '0', top: '0', width: W + 'px', height: h * sy + 'px' }));
    else [1900, 130, 30].forEach((w, i) => Object.assign(band(i + 1), { top: '-400px', height: H + 800 + 'px', width: w * sx + 'px' }));
    Object.assign(document.getElementById('grain').style, { width: Math.round(1200 * sx) + 'px', height: Math.round(2134 * sy) + 'px' });
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
        sweeping = true; const e = ease.inOut(k), w = (i) => document.getElementById('w' + i).style;
        const sx = SB.frame.W / 1080, sy = SB.frame.H / 1920;
        if (SB.style.wipe === 'curtain') {          // a flat band drops through the frame
          const y = lerp(-2760, 1960, e) * sy; w(1).transform = `translateY(${y}px)`; w(2).transform = `translateY(${y + 2600 * sy}px)`; w(3).transform = `translateY(${y + 2760 * sy}px)`;
        } else {                                    // a slanted slab of brand colour sweeps across
          const x = lerp(-2300, 1300, e) * sx; w(1).transform = `translateX(${x}px) skewX(-14deg)`; w(2).transform = `translateX(${x + 1930 * sx}px) skewX(-14deg)`; w(3).transform = `translateX(${x + 2090 * sx}px) skewX(-14deg)`;
        }
      }
    }
    document.getElementById('wipe').style.visibility = sweeping ? 'visible' : 'hidden';
    const cur = SB.live.find((s) => t >= s.sc.start && t < s.sc.end), n = document.getElementById('notice');
    n.style.visibility = cur && cur.sc.notice ? 'visible' : 'hidden'; if (cur && cur.sc.notice) n.textContent = cur.sc.notice;
    // light film grain, reseeded per output frame
    const cv = document.getElementById('grain'), cx = cv.getContext('2d'), im = cx.createImageData(cv.width, cv.height);
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
    pp.onclick = () => { playing = !playing; pp.textContent = playing ? 'Pause' : 'Play'; base = +sk.value >= plan.duration - .05 ? 0 : +sk.value; t0 = performance.now(); if (audio) { audio.currentTime = base; playing ? audio.play().catch(() => {}) : audio.pause(); } tick(); };
    sk.oninput = () => { playing = false; pp.textContent = 'Play'; if (audio) audio.pause(); show(+sk.value); };
    // inside the studio: start where the editor left off, follow its seeks, tell it where we are
    const at = parseFloat((location.hash.match(/t=([\d.]+)/) || [])[1]);
    if (at > 0) show(Math.min(at, plan.duration - .04));
    addEventListener('message', (e) => { if (e.data && typeof e.data.sbSeek === 'number') { playing = false; pp.textContent = 'Play'; if (audio) audio.pause(); show(Math.min(e.data.sbSeek, plan.duration - .04)); } });
    if (parent !== window) setInterval(() => parent.postMessage({ sbTime: +sk.value }, '*'), 250);
  };

  window.SB = SB;
})();
