// Songbe scene kit — three scene types that cover a short vertical ad:
//   footage  full-bleed footage or image with a headline on top
//   card     light page: headline, a media card (proof shot) and a stat card
//   chat     dark page: headline, a short chat exchange, a contact card and the brand footer
// Each factory builds its DOM once and returns { layout?, cues, draw(u, t) } where u is seconds since the scene started.
(() => {
  const { lerp, seg, ease, spring, clamp, rich, esc, tf, reveal, pop, fit, PIN, mediaSrc, setImg } = SB;
  const $ = (el, sel) => el.querySelector(sel);
  const lines = (v) => (Array.isArray(v) ? v : v ? [v] : []);

  SB.scenes.footage = (el, sc) => {
    const pill = sc.labelStyle === 'pill', ts = lines(sc.title), top = pill ? 296 : 284;
    el.innerHTML = `
      ${sc.media ? '<img class="fill bg" style="filter:contrast(1.04) saturate(1.06)">' : '<div class="fill night"></div>'}
      <div class="shade-top"></div><div class="shade-bottom"></div>
      ${sc.label ? (pill
        ? `<div class="a pill label on-dark lb" style="left:70px;top:206px;background:var(--primary);padding:14px 30px 14px 34px;font-size:28px;transform-origin:0 50%">${esc(sc.label)}</div>`
        : `<div class="mask label lb" style="left:72px;top:214px;color:var(--accent)"><span>${sc.pin ? PIN(30, 'var(--accent)') : ''}${esc(sc.label)}</span></div>`) : ''}
      ${ts.map((s, i) => `<div class="mask title on-dark tl" style="left:68px;top:${top + i * 144}px;font-size:118px;padding-top:8px"><span>${rich(s)}</span></div>`).join('')}
      ${sc.sub ? `<div class="mask sub on-dark sb" style="left:72px;top:${top + ts.length * 144 + 28}px;font-size:44px"><span>${rich(sc.sub)}</span></div>` : ''}
      ${sc.chip ? `<div class="a pill ch" style="left:70px;top:1296px;background:rgba(255,255,255,.96);color:var(--ink);font-size:40px;font-weight:700;padding:22px 38px 22px 30px;transform-origin:0 50%;box-shadow:0 18px 44px rgba(0,0,0,.28)">${PIN(40, 'var(--primary)')}${esc(sc.chip)}</div>` : ''}`;
    const bg = $(el, '.bg'), lb = $(el, '.lb'), tl = [...el.querySelectorAll('.tl')], sb = $(el, '.sb'), ch = $(el, '.ch');
    const dur = sc.end - sc.start, t0 = sc.start === 0 ? 0 : .3;            // later scenes wait for the wipe to pass
    const at = { label: t0 + .12, title: t0 + .26, sub: t0 + 1.1, chip: Math.min(t0 + 2.2, Math.max(1.2, dur - 1.6)) };
    return {
      layout() { let size = 118; for (const l of tl) size = Math.min(size, fit(l, 900)); for (const l of tl) l.style.fontSize = size + 'px'; if (sb) fit(sb, 900); },
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
    const ts = lines(sc.title), m = sc.media, st = sc.stat, statTop = m ? 1226 : 660;
    el.classList.add('paper');
    el.innerHTML = `
      <div class="dots"></div>
      <div class="glow g1" style="left:-180px;top:1180px;width:620px;height:620px;background:color-mix(in srgb,var(--accent) 42%,transparent)"></div>
      <div class="glow g2" style="left:640px;top:-120px;width:640px;height:640px;background:color-mix(in srgb,var(--primary) 22%,transparent)"></div>
      ${sc.label ? `<div class="mask label lb" style="left:72px;top:214px;color:var(--primary)"><span>${esc(sc.label)}</span></div>` : ''}
      ${ts.map((s, i) => `<div class="mask title tl" style="left:68px;top:${280 + i * 136}px;font-size:116px;color:var(--${i === ts.length - 1 && ts.length > 1 ? 'primary' : 'ink'})"><span>${rich(s)}</span></div>`).join('')}
      ${m ? `<div class="a card md" style="left:70px;top:620px;width:940px;height:560px;padding:16px;transform-origin:50% 100%">
        <div style="position:relative;width:908px;height:528px;border-radius:32px;overflow:hidden;background:#dfe7f2">
          <img class="mi" style="position:absolute;left:-16px;top:-6px;width:940px;height:540px;object-fit:cover">
          ${sc.caption ? `<div style="position:absolute;left:20px;bottom:20px;background:color-mix(in srgb,var(--ink) 86%,transparent);color:#fff;font-size:27px;font-weight:600;padding:10px 20px;border-radius:14px">${esc(sc.caption)}</div>` : ''}
        </div></div>` : ''}
      ${st ? `<div class="a card st" style="left:70px;top:${statTop}px;width:940px;height:226px;border-radius:40px">
        <div class="bd" style="position:absolute;left:34px;top:33px;width:160px;height:160px;border-radius:36px;background:var(--ink);color:var(--accent);font-weight:900;font-size:84px;letter-spacing:-3px;text-align:center;line-height:156px;white-space:nowrap"><span>${esc(st.badge)}</span></div>
        <div class="sh" style="position:absolute;left:226px;top:46px;font-size:50px;font-weight:800;color:var(--ink);letter-spacing:-1px;white-space:nowrap">${esc(st.heading)}</div>
        <div class="ss" style="position:absolute;left:228px;top:124px;font-size:34px;font-weight:500;color:var(--muted);white-space:nowrap">${esc(st.sub || '')}</div></div>` : ''}`;
    const lb = $(el, '.lb'), tl = [...el.querySelectorAll('.tl')], md = $(el, '.md'), mi = $(el, '.mi'), stEl = $(el, '.st'), bd = $(el, '.bd');
    const at = { label: .26, title: .36, media: .78, stat: m ? 1.78 : 1.0 };
    return {
      layout() {
        let size = 116; for (const l of tl) size = Math.min(size, fit(l, 900)); for (const l of tl) l.style.fontSize = size + 'px';
        if (stEl) { fit($(el, '.sh'), 680); fit($(el, '.ss'), 680); let b = 84; while (bd.firstElementChild.offsetWidth > 138 && b > 30) { b -= 4; bd.style.fontSize = b + 'px'; } }
      },
      cues: [...(md ? [{ t: at.media - .22, kind: 'swish' }, { t: at.media + .08, kind: 'pop' }] : []), ...(stEl ? [{ t: at.stat + .02, kind: 'pop' }, { t: at.stat + .25, kind: 'ding', gain: .85 }] : [])],
      async draw(u) {
        $(el, '.dots').style.transform = `translate(${-u * 9}px,${-u * 6}px)`;
        tf($(el, '.g1'), { x: Math.sin(u * .9) * 26, y: -u * 16 }); tf($(el, '.g2'), { x: -u * 14, y: Math.cos(u * .8) * 22 });
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

  SB.scenes.chat = (el, sc, plan) => {
    const msgs = sc.messages || [], them = msgs.find((x) => x.from === 'them'), us = msgs.find((x) => x.from === 'us');
    const c = sc.contact, f = sc.footer || {}, logo = plan.brand.logo || {}, ts = lines(sc.title);
    el.classList.add('night');
    el.innerHTML = `
      <div class="glow g1" style="left:520px;top:-200px;width:760px;height:760px;background:color-mix(in srgb,var(--primary) 55%,transparent)"></div>
      <div class="glow g2" style="left:-260px;top:1050px;width:700px;height:700px;background:color-mix(in srgb,var(--accent) 26%,transparent)"></div>
      ${sc.label ? `<div class="mask label lb" style="left:72px;top:214px;color:var(--accent)"><span>${esc(sc.label)}</span></div>` : ''}
      ${ts.map((s, i) => `<div class="mask title on-dark tl" style="left:68px;top:${280 + i * 132}px;font-size:112px"><span>${rich(s)}</span></div>`).join('')}
      ${them ? `<div class="bubble b1" style="right:70px;top:486px;background:var(--primary);color:#fff;border-bottom-right-radius:10px;transform-origin:100% 100%"><span class="b1t"></span></div>` : ''}
      ${us ? `<div class="bubble b2" style="left:70px;top:640px;max-width:720px;background:#fff;color:var(--ink);border-bottom-left-radius:10px;transform-origin:0 100%">${esc(us.text)}</div>
        <div class="bubble dt" style="left:70px;top:640px;background:#fff;border-bottom-left-radius:10px;padding:30px 34px;transform-origin:0 100%">${[0, 1, 2].map((i) => `<i class="d${i}" style="display:inline-block;width:16px;height:16px;border-radius:50%;background:#9AA8BC;margin-right:${i < 2 ? 10 : 0}px"></i>`).join('')}</div>` : ''}
      ${c ? `<div class="a card ct" style="left:70px;top:900px;width:940px;height:372px;border-radius:48px;transform-origin:50% 100%;box-shadow:0 40px 90px rgba(0,0,0,.45)">
        <div style="position:absolute;left:48px;top:40px;font-size:36px;font-weight:700;color:var(--primary);letter-spacing:3px;text-transform:uppercase">${esc(c.kicker || '')}</div>
        ${c.button ? `<div style="position:absolute;right:48px;top:36px;font-size:30px;font-weight:600;color:#fff;background:var(--ink);padding:8px 22px;border-radius:999px">${esc(c.button)}</div>` : ''}
        <div class="nm" style="position:absolute;left:46px;top:124px;font-size:120px;font-weight:900;color:var(--ink);letter-spacing:-3px;white-space:nowrap">
          ${lines(c.number).map((g, i) => `<span class="mask" style="position:relative;display:inline-block;vertical-align:top;margin-left:${i ? 18 : 0}px"><span class="ng">${esc(g)}</span></span>`).join('')}</div>
        <div class="cs" style="position:absolute;left:48px;top:292px;font-size:34px;font-weight:500;color:var(--muted);white-space:nowrap">${esc(c.sub || '')}</div></div>` : ''}
      <div class="a ft" style="left:70px;top:1352px;width:940px;height:110px">
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
        let size = 112; for (const l of tl) size = Math.min(size, fit(l, 920)); for (const l of tl) l.style.fontSize = size + 'px';
        if (ct) { fit($(el, '.nm'), 852); fit($(el, '.cs'), 852); }
        if ($(el, '.lw')) $(el, '.fx').style.left = $(el, '.lw').offsetWidth + 134 + 'px';
      },
      cues: [
        ...(b1 ? [{ t: at.b1, kind: 'pop' }, ...Array.from({ length: taps }, (_, i) => ({ t: at.type0 + .02 + i * (at.type1 - at.type0) / taps, kind: 'tap', gain: .7 }))] : []),
        ...(b2 ? [{ t: at.dots + .02, kind: 'pop', gain: .65 }, { t: at.b2 + .01, kind: 'pop' }] : []),
        ...(ct ? [{ t: at.card - .1, kind: 'swish' }, ...groupAt.map((t) => ({ t: t + .05, kind: 'tap' })), ...groupAt.map((t) => ({ t: t + .08, kind: 'pop', gain: .75 })), { t: at.end, kind: 'ding' }] : []),
      ],
      async draw(u) {
        tf($(el, '.g1'), { x: Math.sin(u * .6) * 40, y: u * 10 }); tf($(el, '.g2'), { x: u * 12, y: Math.cos(u * .7) * 30 });
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
})();
