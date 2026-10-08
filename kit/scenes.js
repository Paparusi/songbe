// Songbe scene kit — six scene types that cover most short vertical ads:
//   footage  full-bleed footage or image with a headline on top
//   card     light page: headline, a media card (proof shot) and a stat card
//   list     headline and rows that arrive one by one
//   phone    headline over a phone showing app screens, with callouts
//   chat     dark page: headline, a short chat exchange, a contact card and the brand footer
//   end      logo, name, tagline and a call to action
// Each factory builds its DOM once and returns { layout?, cues, draw(u, t) } where u is seconds since the scene started.
// Scenes set geometry inline and leave the look (colours, corners, shadows, type) to classes, so a style sheet can restyle them.
(() => {
  const { lerp, seg, ease, spring, clamp, rich, esc, tf, reveal, pop, fit, PIN, mediaSrc, setImg } = SB;
  const $ = (el, sel) => el.querySelector(sel);
  const lines = (v) => (Array.isArray(v) ? v : v ? [v] : []);
  // headline size and line step for the current style: [size, step]
  // (boxed: the lines sit on their own plates, as headlines over footage do in some styles)
  const type = (size, step, boxed) => { const k = SB.style.title; return k.scale === 1 ? [size, step] : [Math.round(size * k.scale), Math.round(size * k.scale * ((boxed && k.boxLead) || k.lead))]; };
  const wait = (sc) => (sc.start === 0 ? 0 : .26);       // let the cut's colour sweep pass first
  const fitTitle = (tl, size, width = 920) => { let z = size; for (const l of tl) z = Math.min(z, fit(l, width)); for (const l of tl) l.style.fontSize = z + 'px'; };

  const ICONS = {
    check: ['s', 'M5 12.5l4.5 4.5L19 7.5'], star: ['f', 'M12 3.2l2.7 5.6 6.1.8-4.5 4.3 1.1 6.1L12 17.1 6.6 20l1.1-6.1L3.2 9.6l6.1-.8z'],
    bolt: ['f', 'M13 2L4.5 13.5H11L10 22l8.5-11.5H12z'], heart: ['f', 'M12 20.5s-7.5-4.6-7.5-10A4.3 4.3 0 0 1 12 7.6a4.3 4.3 0 0 1 7.5 2.9c0 5.4-7.5 10-7.5 10z'],
    shield: ['f', 'M12 2.8l7.5 2.8v5.6c0 4.6-3.2 8.3-7.5 10-4.3-1.7-7.5-5.4-7.5-10V5.6z'], drop: ['f', 'M12 2.8s6.2 6.6 6.2 11.2A6.2 6.2 0 0 1 5.8 14c0-4.6 6.2-11.2 6.2-11.2z'],
    clock: ['s', 'M12 3.5a8.5 8.5 0 1 0 0 17 8.5 8.5 0 0 0 0-17zM12 7.5V12l3 2'], bell: ['s', 'M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 2h-15zM10 20.5a2 2 0 0 0 4 0'],
    sun: ['s', 'M12 7.5a4.5 4.5 0 1 0 0 9 4.5 4.5 0 0 0 0-9zM12 2v2.2M12 19.8V22M2 12h2.2M19.8 12H22M4.9 4.9l1.6 1.6M17.5 17.5l1.6 1.6M4.9 19.1l1.6-1.6M17.5 6.5l1.6-1.6'],
    pin: ['f', 'M12 2a7 7 0 0 0-7 7c0 5.2 7 13 7 13s7-7.8 7-13a7 7 0 0 0-7-7zm0 9.6A2.6 2.6 0 1 1 12 6.4a2.6 2.6 0 0 1 0 5.2z'],
  };
  const icon = (name, size) => { const [mode, d] = ICONS[name] || ICONS.check;
    return `<svg width="${size}" height="${size}" viewBox="0 0 24 24"><path d="${d}" ${mode === 'f' ? 'fill="currentColor"' : 'fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"'}/></svg>`; };

  const backdrop = (dark) => (dark
    ? `<div class="glow g1" style="left:520px;top:-200px;width:760px;height:760px;background:color-mix(in srgb,var(--primary) 55%,transparent)"></div>
       <div class="glow g2" style="left:-260px;top:1050px;width:700px;height:700px;background:color-mix(in srgb,var(--accent) 26%,transparent)"></div>`
    : `<div class="dots"></div>
       <div class="glow g1" style="left:-180px;top:1180px;width:620px;height:620px;background:color-mix(in srgb,var(--accent) 42%,transparent)"></div>
       <div class="glow g2" style="left:640px;top:-120px;width:640px;height:640px;background:color-mix(in srgb,var(--primary) 22%,transparent)"></div>`);
  const drift = (el, u, dark) => {
    if (!dark) $(el, '.dots').style.transform = `translate(${-u * 9}px,${-u * 6}px)`;
    tf($(el, '.g1'), dark ? { x: Math.sin(u * .6) * 40, y: u * 10 } : { x: Math.sin(u * .9) * 26, y: -u * 16 });
    tf($(el, '.g2'), dark ? { x: u * 12, y: Math.cos(u * .7) * 30 } : { x: -u * 14, y: Math.cos(u * .8) * 22 });
  };
  // small label + headline lines; on light pages the last of several lines takes the primary colour
  const heading = (sc, dark, size, step) => `
    ${sc.label ? `<div class="mask label lb" style="left:72px;top:214px;color:var(--${dark ? 'accent' : 'primary'})"><span>${esc(sc.label)}</span></div>` : ''}
    ${lines(sc.title).map((s, i, a) => `<div class="mask title tl" style="left:68px;top:${280 + i * step}px;font-size:${size}px;color:${dark ? '#fff' : `var(--${i === a.length - 1 && a.length > 1 ? 'primary' : 'ink'})`}"><span>${rich(s)}</span></div>`).join('')}`;

  SB.scenes.footage = (el, sc) => {
    const pill = sc.labelStyle === 'pill', ts = lines(sc.title), top = pill ? 296 : 284, [size, step] = type(118, 144, true);
    el.classList.add('over-footage');
    el.innerHTML = `
      ${sc.media ? '<img class="fill bg" style="filter:contrast(1.04) saturate(1.06)">' : '<div class="fill night"></div>'}
      <div class="shade-top"></div><div class="shade-bottom"></div>
      ${sc.label ? (pill
        ? `<div class="a pill tag label lb" style="left:70px;top:206px;padding:14px 30px 14px 34px;font-size:28px;transform-origin:0 50%">${esc(sc.label)}</div>`
        : `<div class="mask label lb" style="left:72px;top:214px;color:var(--accent)"><span>${sc.pin ? PIN(30, 'var(--accent)') : ''}${esc(sc.label)}</span></div>`) : ''}
      ${ts.map((s, i) => `<div class="mask title on-dark tl" style="left:68px;top:${top + i * step}px;font-size:${size}px;padding-top:8px"><span>${rich(s)}</span></div>`).join('')}
      ${sc.sub ? `<div class="mask sub on-dark sb" style="left:72px;top:${top + ts.length * step + 28}px;font-size:44px"><span>${rich(sc.sub)}</span></div>` : ''}
      ${sc.chip ? `<div class="a pill chip ch" style="left:70px;top:1296px;font-size:40px;font-weight:700;padding:22px 38px 22px 30px;transform-origin:0 50%">${PIN(40, 'var(--primary)')}${esc(sc.chip)}</div>` : ''}`;
    const bg = $(el, '.bg'), lb = $(el, '.lb'), tl = [...el.querySelectorAll('.tl')], sb = $(el, '.sb'), ch = $(el, '.ch');
    const dur = sc.end - sc.start, t0 = sc.start === 0 ? 0 : .3;            // later scenes wait for the wipe to pass
    const at = { label: t0 + .12, title: t0 + .26, sub: t0 + 1.1, chip: Math.min(t0 + 2.2, Math.max(1.2, dur - 1.6)) };
    return {
      layout() { fitTitle(tl, size, 900); if (sb) fit(sb, 900); },
      cues: [...(lb && pill ? [{ t: at.label, kind: 'pop' }] : []), ...(ch ? [{ t: at.chip, kind: 'pop' }] : [])],
      async draw(u) {
        if (bg) { await setImg(bg, mediaSrc(sc.media, u)); bg.style.transform = `scale(${1.02 + .05 * ease.inOut(seg(u, 0, dur + .2))})`; }
        if (lb) pill ? pop(lb, u, at.label, { from: .5, w: 15 }) : reveal(lb, u, at.label);
        tl.forEach((l, i) => reveal(l, u, at.title + i * .16));
        if (sb) reveal(sb, u, at.sub, .55);
        if (ch) pop(ch, u, at.chip, { from: .7, dy: 40 });
      },
    };
  };

  SB.scenes.card = (el, sc) => {
    const ts = lines(sc.title), m = sc.media, st = sc.stat, [size, step] = type(116, 136), shift = (ts.length - 2) * step + (step - 136) * 2;
    const mediaTop = 620 + Math.max(0, shift), statTop = m ? mediaTop + 606 : mediaTop + 40;
    el.classList.add('paper');
    el.innerHTML = backdrop(false) + `
      ${sc.label ? `<div class="mask label lb" style="left:72px;top:214px;color:var(--primary)"><span>${esc(sc.label)}</span></div>` : ''}
      ${ts.map((s, i) => `<div class="mask title tl" style="left:68px;top:${280 + i * step}px;font-size:${size}px;color:var(--${i === ts.length - 1 && ts.length > 1 ? 'primary' : 'ink'})"><span>${rich(s)}</span></div>`).join('')}
      ${m ? `<div class="a card md" style="left:70px;top:${mediaTop}px;width:940px;height:560px;padding:16px;transform-origin:50% 100%">
        <div class="frame" style="position:relative;width:908px;height:528px">
          <img class="mi" style="position:absolute;left:-16px;top:-6px;width:940px;height:540px;object-fit:cover">
          ${sc.caption ? `<div class="cap" style="position:absolute;left:20px;bottom:20px;font-size:27px;font-weight:600;padding:10px 20px">${esc(sc.caption)}</div>` : ''}
        </div></div>` : ''}
      ${st ? `<div class="a card stat st" style="left:70px;top:${statTop}px;width:940px;height:226px">
        <div class="badge bd" style="position:absolute;left:34px;top:33px;width:160px;height:160px;font-weight:900;font-size:84px;letter-spacing:-3px;text-align:center;line-height:156px;white-space:nowrap"><span>${esc(st.badge)}</span></div>
        <div class="sh" style="position:absolute;left:226px;top:46px;font-size:50px;font-weight:800;color:var(--ink);letter-spacing:-1px;white-space:nowrap">${esc(st.heading)}</div>
        <div class="ss" style="position:absolute;left:228px;top:124px;font-size:34px;font-weight:500;color:var(--muted);white-space:nowrap">${esc(st.sub || '')}</div></div>` : ''}`;
    const lb = $(el, '.lb'), tl = [...el.querySelectorAll('.tl')], md = $(el, '.md'), mi = $(el, '.mi'), stEl = $(el, '.st'), bd = $(el, '.bd');
    const at = { label: .26, title: .36, media: .78, stat: m ? 1.78 : 1.0 };
    return {
      layout() {
        fitTitle(tl, size, 900);
        if (stEl) { fit($(el, '.sh'), 680); fit($(el, '.ss'), 680); let b = 84; while (bd.firstElementChild.offsetWidth > 138 && b > 30) { b -= 4; bd.style.fontSize = b + 'px'; } }
      },
      cues: [...(md ? [{ t: at.media - .22, kind: 'swish' }, { t: at.media + .08, kind: 'pop' }] : []), ...(stEl ? [{ t: at.stat + .02, kind: 'pop' }, { t: at.stat + .25, kind: 'ding', gain: .85 }] : [])],
      async draw(u) {
        drift(el, u, false);
        if (lb) reveal(lb, u, at.label);
        tl.forEach((l, i) => reveal(l, u, at.title + i * .14));
        if (md) {
          await setImg(mi, mediaSrc(m, u));
          const s = spring(u - at.media, .62, 10);
          tf(md, { y: lerp(260, 0, s) + Math.sin(u * 1.5) * 4, r: lerp(-5, 0, clamp(s)), s: lerp(.9, 1, clamp(s)), o: clamp((u - at.media) * 8) });
          mi.style.transform = `scale(${1.03 + .05 * seg(u, 0, 3.6)})`;
        }
        if (stEl) {
          pop(stEl, u, at.stat, { from: .78, dy: 70, w: 12 });
          const z = spring(u - at.stat - .22, .4, 17); bd.style.transform = `scale(${lerp(.4, 1, z)}) rotate(${lerp(-14, 0, clamp(z))}deg)`;
        }
      },
    };
  };

  // list: a headline and up to five rows that arrive one by one
  SB.scenes.list = (el, sc) => {
    const dark = sc.tone === 'dark', items = sc.items || [], n = lines(sc.title).length, [size, step] = type(112, 132);
    const rowH = items.some((x) => x.sub) ? 184 : 150, top = 280 + n * step + 70, pad = (rowH - 104) / 2;
    el.classList.add(dark ? 'night' : 'paper');
    el.innerHTML = backdrop(dark) + heading(sc, dark, size, step) + items.map((it, i) => `
      <div class="a row${dark ? ' dark' : ''}" style="left:70px;top:${top + i * (rowH + 26)}px;width:940px;height:${rowH}px">
        <div class="iconb ic" style="position:absolute;left:30px;top:${pad}px;width:104px;height:104px;display:flex;align-items:center;justify-content:center;font-size:54px;font-weight:900">${it.icon === 'number' ? i + 1 : icon(it.icon, 60)}</div>
        <div class="rh" style="position:absolute;left:166px;top:${it.sub ? pad + 2 : (rowH - 62) / 2}px;font-size:48px;font-weight:800;letter-spacing:-1px;white-space:nowrap">${rich(it.text)}</div>
        ${it.sub ? `<div class="rs" style="position:absolute;left:168px;top:${pad + 66}px;font-size:33px;font-weight:500;white-space:nowrap">${esc(it.sub)}</div>` : ''}
      </div>`).join('');
    const lb = $(el, '.lb'), tl = [...el.querySelectorAll('.tl')], rows = [...el.querySelectorAll('.row')];
    const dur = sc.end - sc.start, t0 = wait(sc), first = t0 + .7, gap = clamp((dur - first - 1.6) / Math.max(1, rows.length), .3, 1.5);   // long lines: rows keep pace with the voice
    return {
      layout() { fitTitle(tl, size); for (const r of rows) { fit($(r, '.rh'), 740); if ($(r, '.rs')) fit($(r, '.rs'), 740); } },
      cues: rows.map((_, i) => ({ t: first + i * gap + .02, kind: 'pop' })),
      async draw(u) {
        drift(el, u, dark);
        if (lb) reveal(lb, u, t0);
        tl.forEach((l, i) => reveal(l, u, t0 + .1 + i * .14));
        rows.forEach((r, i) => {
          const at = first + i * gap, s = spring(u - at, .62, 11);
          tf(r, { x: lerp(170, 0, s), o: clamp((u - at) * 8) });
          $(r, '.ic').style.transform = `scale(${lerp(.3, 1, spring(u - at - .1, .45, 16))})`;
        });
      },
    };
  };

  // phone: a headline over a phone that rises into frame, showing one or more app screens with callouts
  SB.scenes.phone = (el, sc) => {
    const light = sc.tone === 'light', dark = !light, screens = lines(sc.screens), calls = sc.callouts || [], n = lines(sc.title).length, [size, step] = type(112, 132);
    const W = 580, H = 1222, X = (1080 - W) / 2, Y = 280 + n * step + 78;
    el.classList.add(dark ? 'night' : 'paper');
    el.innerHTML = backdrop(dark) + heading(sc, dark, size, step) + `
      <div class="a ph" style="left:${X}px;top:${Y}px;width:${W}px;height:${H}px;transform-origin:50% 0">
        <div class="phone${light ? ' light' : ''}"><div class="scr">${screens.map((s) => `<img class="ss" src="${s}">`).join('')}<div class="island"></div></div></div>
        ${calls.map((c, i) => `<div class="a pill callout co" style="${(c.side || (i % 2 ? 'left' : 'right')) === 'left' ? `left:${40 - X}px;transform-origin:0 50%` : `right:${40 - X}px;transform-origin:100% 50%`};top:${Math.round((c.y ?? .2 + .2 * i) * H)}px;white-space:nowrap;font-size:38px;font-weight:700;padding:20px 34px 20px 28px"><i style="display:inline-block;width:18px;height:18px;border-radius:50%;margin-right:14px;vertical-align:2px"></i>${esc(c.text)}</div>`).join('')}
      </div>`;
    const lb = $(el, '.lb'), tl = [...el.querySelectorAll('.tl')], ph = $(el, '.ph'), ss = [...el.querySelectorAll('.ss')], co = [...el.querySelectorAll('.co')];
    const dur = sc.end - sc.start, t0 = wait(sc), rise = t0 + .2;
    const swap = ss.map((_, i) => (i === 0 ? -9 : rise + .9 + (i - 1) * Math.max(1.1, (dur - rise - 1.4) / ss.length) + (dur - rise - .9) / ss.length * .5));
    const callAt = co.map((_, i) => rise + .95 + i * .45);
    return {
      layout() { fitTitle(tl, size); },
      cues: [{ t: rise - .12, kind: 'swish' }, ...swap.slice(1).map((t) => ({ t: t - .05, kind: 'swish', gain: .8 })), ...callAt.map((t) => ({ t: t + .02, kind: 'pop' }))],
      async draw(u) {
        drift(el, u, dark);
        if (lb) reveal(lb, u, t0);
        tl.forEach((l, i) => reveal(l, u, t0 + .1 + i * .14));
        const s = spring(u - rise, .82, 9), k = clamp(s);        // well damped: the phone must not bounce up over the headline
        ph.style.transform = `translateY(${lerp(1500, 0, s) + Math.sin(u * 1.3) * 6}px) perspective(1800px) rotateX(${lerp(26, 0, k)}deg) rotate(${lerp(-6, 0, k)}deg)`;
        ph.style.opacity = u < rise ? 0 : 1;
        ss.forEach((im, i) => {
          const kin = i === 0 ? 1 : ease.inOut(seg(u, swap[i], swap[i] + .55)), kout = i < ss.length - 1 ? ease.inOut(seg(u, swap[i + 1], swap[i + 1] + .55)) : 0;
          im.style.transform = `translateX(${(1 - kin) * 100 - kout * 30}%)`; im.style.zIndex = i;
        });
        co.forEach((c, i) => { const z = spring(u - callAt[i], .5, 14); tf(c, { s: Math.max(0, z), y: Math.sin((u - callAt[i]) * 2.2 + i) * 5, o: u < callAt[i] ? 0 : 1 }); });
      },
    };
  };

  SB.scenes.chat = (el, sc, plan) => {
    const msgs = sc.messages || [], them = msgs.find((x) => x.from === 'them'), us = msgs.find((x) => x.from === 'us');
    const c = sc.contact, f = sc.footer || {}, logo = plan.brand.logo || {}, [size, step] = type(112, 132), down = (lines(sc.title).length - 1) * step + (step - 132);
    el.classList.add('night');
    el.innerHTML = backdrop(true) + heading(sc, true, size, step) + `
      ${them ? `<div class="bubble them b1" style="right:70px;top:${486 + down}px;transform-origin:100% 100%"><span class="b1t"></span></div>` : ''}
      ${us ? `<div class="bubble us b2" style="left:70px;top:${640 + down}px;max-width:720px;transform-origin:0 100%">${esc(us.text)}</div>
        <div class="bubble us dt" style="left:70px;top:${640 + down}px;padding:30px 34px;transform-origin:0 100%">${[0, 1, 2].map((i) => `<i class="d${i}" style="display:inline-block;width:16px;height:16px;border-radius:50%;background:#9AA8BC;margin-right:${i < 2 ? 10 : 0}px"></i>`).join('')}</div>` : ''}
      ${c ? `<div class="a card contact ct" style="left:70px;top:${900 + down}px;width:940px;height:372px;transform-origin:50% 100%">
        <div class="kicker" style="position:absolute;left:48px;top:40px;font-size:36px;font-weight:700;letter-spacing:3px;text-transform:uppercase">${esc(c.kicker || '')}</div>
        ${c.button ? `<div class="pill ghost" style="position:absolute;right:48px;top:36px;font-size:30px;font-weight:600;padding:8px 22px">${esc(c.button)}</div>` : ''}
        <div class="nm" style="position:absolute;left:46px;top:124px;font-size:120px;font-weight:900;color:var(--ink);letter-spacing:-3px;white-space:nowrap">
          ${lines(c.number).map((g, i) => `<span class="mask" style="position:relative;display:inline-block;vertical-align:top;margin-left:${i ? 18 : 0}px"><span class="ng">${esc(g)}</span></span>`).join('')}</div>
        <div class="cs" style="position:absolute;left:48px;top:292px;font-size:34px;font-weight:500;color:var(--muted);white-space:nowrap">${esc(c.sub || '')}</div></div>` : ''}
      <div class="a ft" style="left:70px;top:${1352 + down}px;width:940px;height:110px">
        ${logo.mark ? `<img src="${logo.mark}" style="position:absolute;left:0;top:6px;height:96px">` : ''}
        ${logo.word ? `<img class="lw" src="${logo.word}" style="position:absolute;left:100px;top:26px;height:58px">` : ''}
        <div class="fx" style="position:absolute;left:${logo.word ? 420 : logo.mark ? 120 : 0}px;top:12px">
          <div style="font-size:36px;font-weight:800;color:#fff;white-space:nowrap">${esc(f.name || plan.brand.name || '')}</div>
          <div style="font-size:26px;font-weight:500;color:rgba(255,255,255,.7);white-space:nowrap;margin-top:4px">${esc(f.line || '')}</div></div>
      </div>`;
    const lb = $(el, '.lb'), tl = [...el.querySelectorAll('.tl')], b1 = $(el, '.b1'), b1t = $(el, '.b1t'), b2 = $(el, '.b2'), dt = $(el, '.dt'), ct = $(el, '.ct'), ng = [...el.querySelectorAll('.ng')], ft = $(el, '.ft');
    // the contact card rises just before the sentence that reads the number out; its groups appear as they are spoken
    const say = sc.say || [], last = say.length > 1 ? say[say.length - 1] : null;
    const cardAt = last ? Math.max(1.6, last.start - sc.start - .45) : 3.05;
    const span = last ? last.end - last.start : 1.3, g0 = last ? last.start - sc.start - .05 : cardAt + .55;
    const groupAt = ng.map((_, i) => g0 + span * [0, .37, .64, .8][Math.min(i, 3)] * (ng.length > 1 ? 1 : 0));
    const chat = Math.max(1.4, cardAt - .05), k = chat / 3.0;      // squeeze the chat beat into the time before the card
    const at = { label: .26, title: .38, b1: .95 * k, type0: 1.05 * k, type1: 2.05 * k, dots: 2.3 * k, b2: 3.0 * k, card: cardAt, footer: cardAt + .45, end: last ? last.end - sc.start + .1 : cardAt + 2 };
    const text = them ? them.text : '', taps = Math.min(9, Math.max(3, Math.round(text.length / 3)));
    return {
      layout() {
        fitTitle(tl, size);
        if (ct) { fit($(el, '.nm'), 852); fit($(el, '.cs'), 852); }
        if ($(el, '.lw')) $(el, '.fx').style.left = $(el, '.lw').offsetWidth + 134 + 'px';
      },
      cues: [
        ...(b1 ? [{ t: at.b1, kind: 'pop' }, ...Array.from({ length: taps }, (_, i) => ({ t: at.type0 + .02 + i * (at.type1 - at.type0) / taps, kind: 'tap', gain: .7 }))] : []),
        ...(b2 ? [{ t: at.dots + .02, kind: 'pop', gain: .65 }, { t: at.b2 + .01, kind: 'pop' }] : []),
        ...(ct ? [{ t: at.card - .1, kind: 'swish' }, ...groupAt.map((t) => ({ t: t + .05, kind: 'tap' })), ...groupAt.map((t) => ({ t: t + .08, kind: 'pop', gain: .75 })), { t: at.end, kind: 'ding' }] : []),
      ],
      async draw(u) {
        drift(el, u, true);
        if (lb) reveal(lb, u, at.label);
        tl.forEach((l, i) => reveal(l, u, at.title + i * .14));
        if (b1) {
          b1t.textContent = text.slice(0, Math.max(1, Math.round(seg(u, at.type0, at.type1) * text.length)));
          tf(b1, { s: lerp(.5, 1, spring(u - at.b1, .6, 14)), o: clamp((u - at.b1) * 10) });
        }
        if (b2) {
          const on = u >= at.dots && u < at.b2;
          tf(dt, { s: on ? lerp(.5, 1, spring(u - at.dots, .6, 16)) : 0, o: on ? 1 : 0 });
          [0, 1, 2].forEach((i) => { $(el, '.d' + i).style.transform = `translateY(${-Math.max(0, Math.sin((u - at.dots) * 9 - i * .9)) * 9}px)`; });
          tf(b2, { s: lerp(.6, 1, spring(u - at.b2, .6, 14)), o: clamp((u - at.b2) * 10) });
        }
        if (ct) {
          const s = spring(u - at.card, .62, 10), beat = u > at.end ? 1 + .035 * Math.max(0, Math.sin((u - at.end) * 3.4)) : 1;
          tf(ct, { y: lerp(420, 0, s) + Math.sin(u * 1.4) * 4, s: lerp(.92, 1, clamp(s)) * beat, o: clamp((u - at.card) * 8) });
          ng.forEach((g, i) => { g.style.transform = `translateY(${lerp(112, 0, ease.outQuint(seg(u, groupAt[i], groupAt[i] + .45)))}%)`; });
        }
        const kf = ease.outQuint(seg(u, at.footer, at.footer + .7)); tf(ft, { y: lerp(50, 0, kf), o: kf });
      },
    };
  };

  // end: logo, name, tagline and a call to action
  SB.scenes.end = (el, sc, plan) => {
    const light = sc.tone === 'light', dark = !light, logo = plan.brand.logo || {}, name = sc.name ?? plan.brand.name ?? '', [size] = type(132, 156);
    const fg = light ? 'var(--ink)' : '#fff', soft = light ? 'var(--muted)' : 'rgba(255,255,255,.76)', badges = sc.badges || [];
    el.classList.add(dark ? 'night' : 'paper');
    el.innerHTML = backdrop(dark) + (logo.mark
      ? `<img class="a lg" src="${logo.mark}" style="left:420px;top:410px;width:240px;height:240px;object-fit:contain">`
      : `<div class="a lg logo-fallback" style="left:420px;top:410px;width:240px;height:240px;font-size:150px;font-weight:900;text-align:center;line-height:236px">${esc(name.trim()[0] || '')}</div>`) + `
      <div class="mask title nm" style="left:0;width:1080px;top:700px;text-align:center;font-size:${size}px;color:${fg}"><span>${esc(name)}</span></div>
      ${sc.tagline ? `<div class="mask sub tg" style="left:0;width:1080px;top:876px;text-align:center;font-size:46px;font-weight:500;color:${soft}"><span>${rich(sc.tagline)}</span></div>` : ''}
      ${sc.cta ? `<div class="a pill cta ca" style="left:160px;top:1010px;width:760px;height:140px;line-height:138px;text-align:center;font-size:54px;font-weight:800;white-space:nowrap">${esc(sc.cta)}</div>` : ''}
      ${badges.length ? `<div class="a bx" style="left:0;width:1080px;top:1200px;text-align:center;white-space:nowrap">${badges.map((b) => `<span class="store${light ? ' light' : ''} bdg" style="display:inline-block;margin:0 10px;padding:16px 34px;font-size:36px;font-weight:700">${esc(b)}</span>`).join('')}</div>` : ''}
      ${sc.url ? `<div class="a ur" style="left:0;width:1080px;top:${badges.length ? 1330 : 1210}px;text-align:center;font-size:42px;font-weight:700;color:${soft}">${esc(sc.url)}</div>` : ''}`;
    const lg = $(el, '.lg'), nm = $(el, '.nm'), tg = $(el, '.tg'), ca = $(el, '.ca'), bd = [...el.querySelectorAll('.bdg')], ur = $(el, '.ur');
    const t0 = wait(sc), at = { logo: t0 + .1, name: t0 + .38, tag: t0 + .62, cta: t0 + 1.0, badge: t0 + 1.35, url: t0 + 1.7 };
    const shrink = (m, max) => { let z = parseFloat(getComputedStyle(m).fontSize); while (m.firstElementChild.offsetWidth > max && z > 28) { z -= 2; m.style.fontSize = z + 'px'; } };
    return {
      layout() { shrink(nm, 940); if (tg) shrink(tg, 940); if (ca) { let z = 54; while (ca.scrollWidth > 760 && z > 30) { z -= 2; ca.style.fontSize = z + 'px'; } } },
      cues: [{ t: at.logo, kind: 'pop' }, { t: at.logo + .12, kind: 'ding', gain: .8 }, ...(ca ? [{ t: at.cta, kind: 'pop' }] : []), ...bd.map((_, i) => ({ t: at.badge + i * .12, kind: 'tap' }))],
      async draw(u) {
        drift(el, u, dark);
        const s = spring(u - at.logo, .45, 12); tf(lg, { s: lerp(.3, 1, s), r: lerp(-14, 0, clamp(s)), y: Math.sin(u * 1.4) * 5, o: clamp((u - at.logo) * 9) });
        reveal(nm, u, at.name); if (tg) reveal(tg, u, at.tag, .55);
        if (ca) { const z = spring(u - at.cta, .5, 13), beat = u > at.cta + .8 ? 1 + .03 * Math.max(0, Math.sin((u - at.cta - .8) * 3.6)) : 1; tf(ca, { s: lerp(.6, 1, z) * beat, o: clamp((u - at.cta) * 9) }); }
        bd.forEach((b, i) => { const z = spring(u - at.badge - i * .12, .55, 14); b.style.transform = `scale(${Math.max(0, z)})`; b.style.opacity = u < at.badge + i * .12 ? 0 : 1; });
        if (ur) { const k = ease.outQuint(seg(u, at.url, at.url + .6)); tf(ur, { y: lerp(30, 0, k), o: k }); }
      },
    };
  };
})();
