/*
 * CutRoom motion kit (CRM): the avatar on stage, camera moves, kinetic type, transitions and particles.
 * Load after gsap, timing.js and cutroom-kit.js. Every frame is a pure function of time: canvas layers
 * are drawn from draw(t) and DOM layers are GSAP tweens on the paused timeline, so seeking always gives
 * the same pixels.
 *
 *   var A = CRM.avatar({ engine: renderAvatarPixels, avatar: pkg });   // window.FILM_AVATAR or a sample
 *   A.shot(0, { x: 540, y: 1500, scale: 9 });                          // feet at (x, y), 9 screen px per sprite px
 *   A.enter(0.1, "drop"); A.act(2.0, "surprised", "surprised"); A.talk(3, 8);
 *   A.draw(ctx, t);                                                     // inside draw(t)
 */
(function () {
  "use strict";
  var T = window.TIMING || { words: [], envelope: { fps: 30, db: [] }, voiceEnd: 0 };
  var FPS = 30;

  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function lerp(a, b, p) { return a + (b - a) * p; }
  var EASE = {
    linear: function (p) { return p; },
    out: function (p) { return 1 - Math.pow(1 - p, 3); },
    inOut: function (p) { return p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2; },
    back: function (p) { var c = 1.9, c3 = c + 1; return 1 + c3 * Math.pow(p - 1, 3) + c * Math.pow(p - 1, 2); },
    elastic: function (p) { return p === 0 || p === 1 ? p : Math.pow(2, -10 * p) * Math.sin((p * 10 - 0.75) * (2 * Math.PI) / 3) + 1; },
    bounce: function (p) {
      var n = 7.5625, d = 2.75;
      if (p < 1 / d) return n * p * p;
      if (p < 2 / d) return n * (p -= 1.5 / d) * p + 0.75;
      if (p < 2.5 / d) return n * (p -= 2.25 / d) * p + 0.9375;
      return n * (p -= 2.625 / d) * p + 0.984375;
    },
  };
  function rng(seed) {
    var s = (Math.abs(Math.floor(seed)) % 2147483646) + 1;
    return function () { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; };
  }
  /** Voice loudness 0..1 at time t, from the narration envelope. */
  function level(t) {
    var e = T.envelope || { fps: 30, db: [] };
    var i = Math.floor(t * (e.fps || 30));
    var db = e.db && e.db[i];
    if (db == null) return 0;
    return clamp((db + 42) / 26, 0, 1);
  }
  /** Avatar mouth for frame f: the film's own lip sync when the avatar is attached, else from the envelope. */
  function mouthAt(t) {
    var v = window.FILM_AVATAR_VOICE;
    var f = Math.floor(t * FPS);
    if (v && v.mouths && v.mouths.length) return v.mouths[clamp(f, 0, v.mouths.length - 1)] || "X";
    var e = T.envelope || { fps: 30, db: [] };
    var db = e.db && e.db[Math.floor(t * (e.fps || 30))];
    if (db == null || db <= -42) return "X";
    var l = clamp((db + 42) / 26, 0, 1);
    return ["A", "B", "C", "D", "E", "F"][Math.min(5, Math.floor(l * 6))];
  }

  /** Keyframed value: each key eases from the previous value over its own duration. */
  function track(keys, t, field, fallback) {
    var from = fallback, cur = null;
    function at(k, f, time) {
      var d = k.d == null ? 0.35 : k.d;
      var p = d <= 0 ? 1 : clamp((time - k.t) / d, 0, 1);
      return lerp(f, k[field], (EASE[k.e || "back"] || EASE.back)(p));
    }
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i];
      if (k[field] === undefined) continue;
      if (k.t > t) break;
      from = cur ? at(cur, from, k.t) : fallback;
      cur = k;
    }
    return cur ? at(cur, from, t) : fallback;
  }
  function latest(list, t) {
    var hit = null;
    for (var i = 0; i < list.length; i++) if (list[i].t <= t) hit = list[i];
    return hit;
  }

  var CRM = { ease: EASE, rng: rng, level: level, mouthAt: mouthAt, clamp: clamp, lerp: lerp };

  /* ------------------------------------------------------------------ avatar on stage */
  CRM.avatar = function (opts) {
    var render = typeof opts.engine === "function" ? opts.engine : opts.engine && opts.engine.renderAvatarPixels, pkg = opts.avatar;
    if (typeof render !== "function") throw new Error("CRM.avatar: engine must be renderAvatarPixels or window.AvatarEngine");
    var size = pkg.canvas.full, base = pkg.canvas.baseline || size - 6;
    var sprite = document.createElement("canvas"); sprite.width = sprite.height = size;
    var sctx = sprite.getContext("2d");
    var sil = document.createElement("canvas"); sil.width = sil.height = size;
    var silCtx = sil.getContext("2d");
    var cache = {};
    var A = { shots: [], acts: [], talks: [], enters: [], hits: [], hops: [], spins: [], sleeps: [], outline: opts.outline || "#C8FF5A", shadow: opts.shadow !== false };

    /** Camera framing: feet at (x, y) in screen px, `scale` screen px per sprite px. Eases from the previous shot. */
    A.shot = function (t, s) { A.shots.push(Object.assign({ t: t }, s)); A.shots.sort(function (a, b) { return a.t - b.t; }); return A; };
    /** Pose and expression from t on (either may be null to keep the current one). */
    A.act = function (t, pose, expression) { A.acts.push({ t: t, pose: pose, expression: expression }); A.acts.sort(function (a, b) { return a.t - b.t; }); return A; };
    /** Talking hands: alternates gesture poses on the spoken words between from and to. */
    A.talk = function (from, to, poses) { A.talks.push({ from: from, to: to, poses: poses || ["explaining", "neutral"] }); return A; };
    /** Entrance: "drop" (falls and lands with dust), "pop" (scales up with overshoot), "left"/"right" (slides in with smear). */
    A.enter = function (t, kind) { A.enters.push({ t: t, kind: kind || "pop" }); return A; };
    /** Impact frame: white silhouette for two frames and a squash. */
    A.hit = function (t) { A.hits.push(t); return A; };
    /** A small jump (celebration). */
    A.hop = function (t, height) { A.hops.push({ t: t, h: height || 18 }); return A; };
    /** Eyes shut between from and to (sleeping, or a slow knowing blink). */
    A.sleep = function (from, to) { A.sleeps.push({ from: from, to: to }); return A; };
    /** A full 360 flip (transition into a new shot). */
    A.spin = function (t) { A.spins.push(t); return A; };

    function poseAt(t) {
      var a = latest(A.acts.filter(function (x) { return x.pose; }), t);
      var pose = a ? a.pose : "neutral", since = a ? a.t : 0;
      for (var i = 0; i < A.talks.length; i++) {
        var k = A.talks[i];
        if (t < k.from || t > k.to) continue;
        var starts = [];
        for (var w = 0; w < T.words.length; w++) {
          var st = T.words[w].start;
          if (st >= k.from && st <= t) starts.push(st);
        }
        if (!starts.length) continue;
        var group = Math.floor((starts.length - 1) / 2), onset = starts[group * 2];
        if (onset >= since) { pose = k.poses[group % k.poses.length]; since = onset; }
      }
      return { pose: pose, since: since };
    }
    function expressionAt(t) {
      var a = latest(A.acts.filter(function (x) { return x.expression; }), t);
      return a ? a.expression : "neutral";
    }
    function blinkAt(t) {
      for (var z = 0; z < A.sleeps.length; z++) if (t >= A.sleeps[z].from && t < A.sleeps[z].to) return 1;
      var r = rng(7), at = 0.8;
      while (at < t + 1) {
        if (t >= at && t < at + 0.1) return 1;
        at += 2.2 + r() * 2.4;
      }
      return 0;
    }
    function pixels(state) {
      var key = state.pose + "|" + state.expression + "|" + state.mouth + "|" + state.blink + "|" + (state.frame % 120);
      if (!cache[key]) {
        var px = render(pkg, state, "full");
        cache[key] = new ImageData(new Uint8ClampedArray(px.data), px.width, px.height);
      }
      return cache[key];
    }
    /** Transform at t (shared by the sprite, its smear copies and the shadow). */
    function transform(t) {
      var x = track(A.shots, t, "x", 540), y = track(A.shots, t, "y", 1500), s = track(A.shots, t, "scale", 8);
      var rot = track(A.shots, t, "rot", 0), alpha = 1, sx = 1, sy = 1;
      if (A.enters.length && t < Math.min.apply(null, A.enters.map(function (x) { return x.t; }))) alpha = 0;
      for (var i = 0; i < A.enters.length; i++) {
        var e = A.enters[i], p = (t - e.t) / 0.55;
        if (t < e.t) continue;
        if (p >= 1) continue;
        if (e.kind === "drop") {
          var fall = clamp((t - e.t) / 0.32, 0, 1);
          y -= (1 - EASE.bounce(fall)) * 1400;
          if (fall >= 1) { var q = clamp((t - e.t - 0.32) / 0.2, 0, 1); sy *= 1 - 0.18 * Math.sin(q * Math.PI); sx *= 1 + 0.14 * Math.sin(q * Math.PI); }
        } else if (e.kind === "left" || e.kind === "right") {
          x += (e.kind === "left" ? -1 : 1) * (1 - EASE.back(clamp(p * 1.3, 0, 1))) * 900;
        } else {
          var k = EASE.back(clamp(p * 1.4, 0, 1)); sx *= k; sy *= k;
        }
      }
      for (var h = 0; h < A.hits.length; h++) {
        var dt = t - A.hits[h];
        if (dt >= 0 && dt < 0.25) { var w = Math.sin((dt / 0.25) * Math.PI); sy *= 1 - 0.12 * w; sx *= 1 + 0.1 * w; }
      }
      for (var j = 0; j < A.hops.length; j++) {
        var hp = (t - A.hops[j].t) / 0.42;
        if (hp >= 0 && hp < 1) { y -= Math.sin(hp * Math.PI) * A.hops[j].h * s / 8; if (hp < 0.12 || hp > 0.88) { sy *= 0.92; sx *= 1.06; } }
      }
      for (var r = 0; r < A.spins.length; r++) {
        var sp = (t - A.spins[r]) / 0.5;
        if (sp >= 0 && sp < 1) sx *= Math.cos(EASE.inOut(sp) * Math.PI * 2);
      }
      // Gesture change: anticipation squash then overshoot.
      var ps = poseAt(t), gp = (t - ps.since) / 0.2;
      if (gp >= 0 && gp < 1) { sy *= 1 + 0.06 * Math.sin(gp * Math.PI * 2); sx *= 1 - 0.04 * Math.sin(gp * Math.PI * 2); }
      // Talking bob from the voice.
      y -= level(t) * s * 0.9;
      return { x: x, y: y, s: s, rot: rot, sx: sx, sy: sy, alpha: alpha, pose: ps.pose };
    }
    function blit(ctx, img, tr, a) {
      ctx.save();
      ctx.globalAlpha = a;
      ctx.translate(tr.x, tr.y);
      ctx.rotate(tr.rot * Math.PI / 180);
      ctx.scale(tr.s * tr.sx, tr.s * tr.sy);
      ctx.drawImage(img, -size / 2, -base);
      ctx.restore();
    }
    A.transform = transform;
    A.draw = function (ctx, t) {
      var tr = transform(t);
      if (tr.alpha <= 0) return;
      var f = Math.floor(t * FPS);
      var shut = blinkAt(t) === 1 && A.sleeps.some(function (z) { return t >= z.from && t < z.to; });
      var state = { pose: tr.pose, expression: expressionAt(t), mouth: shut ? "X" : mouthAt(t), blink: blinkAt(t), frame: f };
      sctx.clearRect(0, 0, size, size);
      sctx.putImageData(pixels(state), 0, 0);
      // Silhouette for the outline and impact frames.
      silCtx.clearRect(0, 0, size, size);
      silCtx.globalCompositeOperation = "source-over";
      silCtx.drawImage(sprite, 0, 0);
      silCtx.globalCompositeOperation = "source-in";
      var hit = A.hits.some(function (h) { return t >= h && t < h + 2 / FPS; });
      silCtx.fillStyle = hit ? "#FFFFFF" : A.outline;
      silCtx.fillRect(0, 0, size, size);
      silCtx.globalCompositeOperation = "source-over";
      ctx.imageSmoothingEnabled = false;
      if (A.shadow) {
        ctx.save(); ctx.globalAlpha = 0.35 * tr.alpha; ctx.fillStyle = "#000";
        var lift = clamp((track(A.shots, t, "y", 1500) - tr.y) / 600, 0, 0.8);
        ctx.beginPath(); ctx.ellipse(tr.x, track(A.shots, t, "y", 1500) + 6, tr.s * 26 * (1 - lift), tr.s * 4 * (1 - lift), 0, 0, Math.PI * 2); ctx.fill(); ctx.restore();
      }
      // Smear: copies at earlier times when the avatar moves fast.
      var prev = transform(t - 0.05), speed = Math.hypot(tr.x - prev.x, tr.y - prev.y);
      if (speed > 30) for (var k = 3; k >= 1; k--) blit(ctx, sil, transform(t - k * 0.025), 0.18 * tr.alpha);
      // 1-sprite-pixel outline in the accent colour, then the sprite.
      var o = { x: tr.x, y: tr.y, s: tr.s, rot: tr.rot, sx: tr.sx, sy: tr.sy };
      var d = tr.s;
      [[-d, 0], [d, 0], [0, -d], [0, d]].forEach(function (v) { blit(ctx, sil, { x: o.x + v[0], y: o.y + v[1], s: o.s, rot: o.rot, sx: o.sx, sy: o.sy }, tr.alpha); });
      blit(ctx, hit ? sil : sprite, tr, tr.alpha);
    };
    return A;
  };

  /* ------------------------------------------------------------------ canvas layers */
  /** Background scenes: [{t, a, b, d}] vertical gradients crossfading, a drifting pixel grid and a glow. */
  CRM.background = function (ctx, t, scenes, opts) {
    opts = opts || {};
    var W = ctx.canvas.width, H = ctx.canvas.height;
    var cur = scenes[0], prev = scenes[0], p = 1;
    for (var i = 0; i < scenes.length; i++) if (scenes[i].t <= t) { prev = cur; cur = scenes[i]; p = clamp((t - cur.t) / (cur.d == null ? 0.25 : cur.d), 0, 1); }
    function paint(s, a) {
      var g = ctx.createLinearGradient(0, 0, 0, H);
      g.addColorStop(0, s.a); g.addColorStop(1, s.b);
      ctx.globalAlpha = a; ctx.fillStyle = g; ctx.fillRect(0, 0, W, H); ctx.globalAlpha = 1;
    }
    paint(prev, 1);
    if (p < 1) {
      // Iris wipe from the centre into the new scene.
      ctx.save(); ctx.beginPath(); ctx.arc(W / 2, H * 0.45, EASE.inOut(p) * Math.hypot(W, H), 0, Math.PI * 2); ctx.clip(); paint(cur, 1); ctx.restore();
    } else paint(cur, 1);
    var glow = ctx.createRadialGradient(W * 0.8, H * 0.12, 0, W * 0.8, H * 0.12, W * 0.9);
    glow.addColorStop(0, (cur.glow || "rgba(124,92,255,0.45)")); glow.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = glow; ctx.fillRect(0, 0, W, H);
    // Drifting pixel grid.
    var step = opts.grid || 60, off = (t * 40) % step;
    ctx.fillStyle = cur.dots || "rgba(255,255,255,0.07)";
    for (var y = -step; y < H + step; y += step) for (var x = -step; x < W + step; x += step) ctx.fillRect(Math.round(x + off), Math.round(y + off * 0.5), 6, 6);
  };

  /** Radial speed lines around (cx, cy) between from and to. */
  CRM.speedLines = function (ctx, t, from, to, cx, cy, color) {
    if (t < from || t > to) return;
    var p = (t - from) / Math.max(0.01, to - from), fade = Math.sin(p * Math.PI);
    var r = rng(Math.floor(t * 12) + 3);
    ctx.save(); ctx.globalAlpha = 0.55 * fade; ctx.fillStyle = color || "#FFFFFF";
    for (var i = 0; i < 46; i++) {
      var ang = r() * Math.PI * 2, r0 = 380 + r() * 260, len = 240 + r() * 520, wdt = 6 + r() * 14;
      ctx.save(); ctx.translate(cx, cy); ctx.rotate(ang);
      ctx.beginPath(); ctx.moveTo(r0, -wdt / 2); ctx.lineTo(r0 + len, 0); ctx.lineTo(r0, wdt / 2); ctx.fill(); ctx.restore();
    }
    ctx.restore();
  };

  /** Particle bursts: [{t, x, y, kind: "confetti"|"dust"|"spark"|"coin"|"heart", n, spread, colors, seed}]. */
  CRM.particles = function (ctx, t, bursts) {
    ctx.save();
    for (var b = 0; b < bursts.length; b++) {
      var B = bursts[b], dt = t - B.t, life = B.life || (B.kind === "dust" ? 0.6 : 1.6);
      if (dt < 0 || dt > life) continue;
      var r = rng(B.seed || (b + 1) * 97), n = B.n || 40, cols = B.colors || ["#C8FF5A", "#7C5CFF", "#FFFFFF", "#FF5A36", "#FFD23F"];
      var fade = 1 - Math.pow(dt / life, 3);
      for (var i = 0; i < n; i++) {
        var ang = B.kind === "dust" ? Math.PI + r() * Math.PI : (B.angle != null ? B.angle + (r() - 0.5) * (B.cone || 1.2) : r() * Math.PI * 2);
        var sp = (B.spread || 900) * (0.35 + r() * 0.75);
        var g = B.kind === "dust" ? 300 : B.kind === "spark" ? 200 : 1500;
        var x = B.x + Math.cos(ang) * sp * dt * (B.kind === "dust" ? 0.5 : 1);
        var y = B.y + Math.sin(ang) * sp * dt + 0.5 * g * dt * dt;
        var s = B.kind === "dust" ? 14 + r() * 18 : B.kind === "spark" ? 8 + r() * 8 : 12 + r() * 12;
        ctx.globalAlpha = fade * (B.kind === "dust" ? 0.55 : 1);
        ctx.fillStyle = B.kind === "dust" ? "#D9D3E8" : cols[i % cols.length];
        if (B.kind === "coin") { ctx.fillStyle = "#FFD23F"; ctx.fillRect(Math.round(x - 12), Math.round(y - 12), 24, 24); ctx.fillStyle = "#B8860B"; ctx.fillRect(Math.round(x - 3), Math.round(y - 8), 6, 16); continue; }
        if (B.kind === "heart") { var hs = 6; ctx.fillStyle = "#FF4D6D"; [[0,1],[1,0],[2,0],[3,1],[4,0],[5,0],[6,1],[0,2],[6,2],[1,3],[5,3],[2,4],[4,4],[3,5]].forEach(function (c) { ctx.fillRect(Math.round(x + c[0] * hs), Math.round(y + c[1] * hs), hs, hs); }); ctx.fillRect(Math.round(x + hs), Math.round(y + hs), hs * 5, hs * 2); ctx.fillRect(Math.round(x + 2 * hs), Math.round(y + 3 * hs), hs * 3, hs); continue; }
        if (B.kind === "confetti") { ctx.save(); ctx.translate(x, y); ctx.rotate(dt * (4 + r() * 8)); ctx.fillRect(-s / 2, -s / 4, s, s / 2); ctx.restore(); }
        else ctx.fillRect(Math.round(x - s / 2), Math.round(y - s / 2), s, s);
      }
    }
    ctx.restore();
  };

  /** Envelope bars (the voice drawn live), e.g. inside a "your voice" card. */
  CRM.waveform = function (ctx, t, x, y, w, h, color, bars) {
    bars = bars || 24;
    var bw = w / bars;
    ctx.fillStyle = color || "#C8FF5A";
    for (var i = 0; i < bars; i++) {
      var l = level(t - (bars - i) * 0.02);
      var bh = Math.max(6, l * h);
      ctx.fillRect(Math.round(x + i * bw + 2), Math.round(y + (h - bh) / 2), Math.round(bw - 4), Math.round(bh));
    }
  };

  /* ------------------------------------------------------------------ DOM / GSAP motion */
  function els(sel) { return typeof sel === "string" ? Array.prototype.slice.call(document.querySelectorAll(sel)) : [].concat(sel); }

  /** Wraps each word of the element in <i class="w"> (key words keep their markup). */
  CRM.split = function (sel) {
    els(sel).forEach(function (el) {
      if (el.dataset.split) return;
      el.dataset.split = "1";
      var out = [];
      Array.prototype.slice.call(el.childNodes).forEach(function (n) {
        if (n.nodeType === 3) n.textContent.split(/(\s+)/).forEach(function (w) { out.push(/\S/.test(w) ? '<i class="w">' + w + "</i>" : w); });
        else if (n.nodeName === "BR") out.push("<br>");
        else { n.classList && n.classList.add("w"); out.push(n.outerHTML); }
      });
      el.innerHTML = out.join("");
    });
    return sel;
  };

  /** Words slam in one by one (big → normal, tilt, flash), then the block shakes. */
  CRM.slam = function (tl, sel, at, opts) {
    opts = opts || {};
    CRM.split(sel);
    var root = els(sel)[0];
    tl.set(root, { autoAlpha: 1 }, at);
    var words = root.querySelectorAll(".w"), gap = opts.gap == null ? 0.09 : opts.gap;
    var r = rng(Math.floor(at * 100) + 11);
    for (var i = 0; i < words.length; i++) {
      var w = words[i], ta = (opts.times && opts.times[i] != null) ? opts.times[i] : at + i * gap;
      tl.fromTo(w, { scale: opts.from || 2.8, rotation: (r() - 0.5) * 16, autoAlpha: 0, display: "inline-block" }, { scale: 1, rotation: (r() - 0.5) * 4, autoAlpha: 1, duration: 0.22, ease: "back.out(2.6)" }, ta);
    }
    if (opts.shake !== false) CRM.shake(tl, opts.shakeSel || "#cam", at + Math.min(0.1, gap), opts.amp || 14, 0.28);
    return tl;
  };

  /** Letters drop in from above with a stagger (titles). */
  CRM.letters = function (tl, sel, at, opts) {
    opts = opts || {};
    els(sel).forEach(function (el) {
      if (!el.dataset.letters) {
        el.dataset.letters = "1";
        el.innerHTML = el.textContent.split("").map(function (c) { return c === " " ? " " : '<i class="l">' + c + "</i>"; }).join("");
      }
      tl.set(el, { autoAlpha: 1 }, at);
      tl.fromTo(el.querySelectorAll(".l"), { y: -160, autoAlpha: 0, rotation: -12, display: "inline-block" }, { y: 0, autoAlpha: 1, rotation: 0, duration: 0.42, ease: "bounce.out", stagger: opts.stagger || 0.035 }, at);
    });
    return tl;
  };

  /** Camera shake on the stage (deterministic). */
  CRM.shake = function (tl, sel, at, amp, dur) {
    amp = amp || 16; dur = dur || 0.3;
    var r = rng(Math.floor(at * 1000) + 5), n = Math.max(3, Math.round(dur / 0.04));
    for (var i = 0; i < n; i++) {
      var k = 1 - i / n;
      tl.to(sel, { x: (r() - 0.5) * 2 * amp * k, y: (r() - 0.5) * 2 * amp * k, duration: dur / n, ease: "none" }, at + (i * dur) / n);
    }
    tl.to(sel, { x: 0, y: 0, duration: 0.05, ease: "none" }, at + dur);
    return tl;
  };

  /** Punch-in: the stage zooms in fast and settles (emphasis). */
  CRM.punch = function (tl, sel, at, s, hold) {
    tl.to(sel, { scale: s || 1.08, duration: 0.12, ease: "power3.out" }, at);
    tl.to(sel, { scale: 1, duration: 0.5, ease: "power2.inOut" }, at + (hold || 0.5));
    return tl;
  };

  /** Whip pan between scenes: blur out one way, swap at `at`, blur in from the other side. */
  CRM.whip = function (tl, sel, at, dir) {
    dir = dir || 1;
    tl.to(sel, { xPercent: -14 * dir, filter: "blur(18px)", duration: 0.12, ease: "power2.in" }, at - 0.12);
    tl.set(sel, { xPercent: 14 * dir }, at);
    tl.to(sel, { xPercent: 0, filter: "blur(0px)", duration: 0.2, ease: "power2.out" }, at);
    return tl;
  };

  /** Full-frame flash (white by default). */
  CRM.flash = function (tl, sel, at, peak) {
    // set + to (not fromTo): a fromTo would paint its visible "from" state before it starts.
    tl.set(sel, { autoAlpha: peak || 0.85 }, at);
    tl.to(sel, { autoAlpha: 0, duration: 0.18, ease: "power1.out" }, at + 0.001);
    return tl;
  };

  /** RGB-split glitch on an element for ~0.3 s. */
  CRM.glitch = function (tl, sel, at, dur) {
    dur = dur || 0.3;
    var r = rng(Math.floor(at * 997) + 3), n = Math.round(dur / 0.035);
    for (var i = 0; i < n; i++) {
      var a = (r() - 0.5) * 30, b = (r() - 0.5) * 14;
      tl.set(sel, { x: a, skewX: b * 0.6, textShadow: (a / 2) + "px 0 #FF2E63, " + (-a / 2) + "px 0 #08F7FE" }, at + i * 0.035);
    }
    tl.set(sel, { x: 0, skewX: 0, textShadow: "0 0 0 rgba(0,0,0,0)" }, at + dur);
    return tl;
  };

  /** Element pops in with overshoot and a little rotation wobble. */
  CRM.popIn = function (tl, sel, at, opts) {
    opts = opts || {};
    tl.fromTo(sel, { autoAlpha: 0, scale: 0.2, rotation: opts.rot == null ? -8 : opts.rot, y: opts.y || 0 }, { autoAlpha: 1, scale: 1, rotation: 0, y: 0, duration: 0.45, ease: "elastic.out(1, 0.55)" }, at);
    return tl;
  };

  /** Slide in from a side with overshoot. */
  CRM.slideIn = function (tl, sel, at, from) {
    var map = { left: { xPercent: -140 }, right: { xPercent: 140 }, up: { yPercent: 160 }, down: { yPercent: -160 } };
    tl.fromTo(sel, Object.assign({ autoAlpha: 0 }, map[from || "right"]), { autoAlpha: 1, xPercent: 0, yPercent: 0, duration: 0.42, ease: "back.out(1.8)" }, at);
    return tl;
  };

  /** Out: shrinks and fades. */
  CRM.out = function (tl, sel, at) {
    tl.to(sel, { autoAlpha: 0, scale: 0.6, duration: 0.18, ease: "power2.in" }, at);
    return tl;
  };

  /** A red strike that draws across an element. */
  CRM.strike = function (tl, sel, at) {
    tl.fromTo(sel, { scaleX: 0, autoAlpha: 1, transformOrigin: "0% 50%" }, { scaleX: 1, duration: 0.2, ease: "power3.out" }, at);
    return tl;
  };

  /** Retention progress bar (top of the frame). */
  CRM.progress = function (tl, sel, duration) {
    tl.fromTo(sel, { scaleX: 0, transformOrigin: "0% 50%" }, { scaleX: 1, duration: duration, ease: "none" }, 0);
    return tl;
  };

  /* ------------------------------------------------------------------ automatic director */
  var NEG = /^(nao|nunca|ninguem|zero|sem|caro|cara|problema|dificil|perde|perdeu|pior|medo|sozinho|parado|travado|ruim|erro|falta)$/;
  var POS = /^(venda|vendas|vender|vende|cliente|clientes|resultado|sucesso|cresce|crescer|lucro|ganha|ganhar|pronto|facil|rapido|agora|sim|dinheiro|faturamento)$/;
  function nrm(s) { return String(s).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]/g, ""); }

  /**
   * Directs a whole Reel from the narration alone: one scene per sentence, with its own background,
   * avatar framing and acting, kinetic words, a transition and particles at the peaks. Used by the
   * app's "Reel com avatar" flow; agents can still direct scene by scene with the pieces above.
   *   CRM.autoReel({ tl, film: "#film", engine, avatar, duration, brand })
   */
  CRM.autoReel = function (o) {
    var tl = o.tl, root = document.querySelector(o.film || "#film"), D = o.duration;
    var brand = o.brand || {}, accent = brand.accent || "#7C5CFF", pop = brand.pop || "#C8FF5A";
    var css = document.createElement("style");
    css.textContent =
      "#cam{position:absolute;inset:0;transform-origin:50% 45%}" +
      "#cam canvas{position:absolute;left:0;top:0;width:1080px;height:1920px}" +
      ".ar-t{position:absolute;left:60px;right:60px;top:170px;text-align:center;font-family:Anton,sans-serif;text-transform:uppercase;font-size:118px;line-height:.98;color:#fff;text-shadow:0 8px 0 rgba(0,0,0,.35);visibility:hidden;opacity:0}" +
      ".ar-t .w{display:inline-block}.ar-t em{font-style:normal;color:" + pop + "}.ar-t .neg{color:#FF3D5A}" +
      ".ar-bar{position:absolute;left:0;top:0;height:14px;width:1080px;background:" + pop + ";z-index:50}" +
      ".ar-flash{position:absolute;inset:0;background:#fff;z-index:60;visibility:hidden;opacity:0}" +
      ".ar-vig{position:absolute;inset:0;z-index:55;pointer-events:none;background:radial-gradient(ellipse at center,transparent 58%,rgba(0,0,0,.45) 100%)}";
    document.head.appendChild(css);
    var cam = document.createElement("div"); cam.id = "cam";
    var bgC = document.createElement("canvas"); bgC.width = 1080; bgC.height = 1920;
    var avC = document.createElement("canvas"); avC.width = 1080; avC.height = 1920;
    cam.appendChild(bgC);
    var textLayer = document.createElement("div"); cam.appendChild(textLayer);
    cam.appendChild(avC);
    root.appendChild(cam);
    ["ar-vig", "ar-bar", "ar-flash"].forEach(function (c) { var d = document.createElement("div"); d.className = c; root.appendChild(d); });

    // Sentences from the spoken words.
    var words = T.words, sentences = [], cur = [];
    for (var i = 0; i < words.length; i++) {
      cur.push(words[i]);
      if (/[.?!]$/.test(words[i].text) || i === words.length - 1) { sentences.push(cur); cur = []; }
    }
    if (!sentences.length) sentences.push([{ text: "", start: 0, end: D }]);

    var A = o.engine && o.avatar ? CRM.avatar({ engine: o.engine, avatar: o.avatar, outline: pop }) : null;
    var SHOTS = [
      { x: 540, y: 1720, scale: 11 },               // wide, centre
      { x: 540, y: 2750, scale: 26, e: "out" },     // face
      { x: 280, y: 1800, scale: 8 },                // left
      { x: 800, y: 1780, scale: 9 },                // right
      { x: 540, y: 1860, scale: 13 },               // hero
      { x: 540, y: 1900, scale: 8 },                // bottom
    ];
    var GRADS = [["#1b1530", "#0f0d17"], ["#3b26a8", "#120d2e"], ["#141318", "#251c4d"], ["#6445d8", "#1b1440"], ["#0f1c4a", "#2a1f6b"], ["#2a1f6b", "#141318"]];
    var SC = [], BURSTS = [], LINES = [];
    var r = rng(77);
    if (A) { A.shot(0, Object.assign({ d: 0 }, SHOTS[0])); A.enter(0.12, "drop"); A.act(0, "neutral", "happy"); BURSTS.push({ t: 0.44, x: 540, y: 1720, kind: "dust", n: 26, seed: 3 }); }

    sentences.forEach(function (sw, si) {
      var start = Math.max(0, sw[0].start - 0.08), next = si + 1 < sentences.length ? Math.max(0, sentences[si + 1][0].start - 0.08) : D;
      var text = sw.map(function (w) { return w.text; }).join(" ");
      var keys = sw.map(function (w) { return nrm(w.text); });
      var neg = keys.some(function (k) { return NEG.test(k); }), posv = keys.some(function (k) { return POS.test(k); });
      var question = /\?$/.test(text), last = si === sentences.length - 1, first = si === 0;
      // Background for the scene.
      var g = neg ? ["#2a0f18", "#0d0709"] : posv ? ["#7C5CFF", "#241a5e"] : GRADS[si % GRADS.length];
      SC.push({ t: start, a: g[0], b: g[1], glow: neg ? "rgba(255,61,90,.35)" : "rgba(200,255,90,.30)", d: first ? 0 : 0.25 });
      // Avatar framing and acting.
      if (A && !first) {
        var shot = last ? { x: 720, y: 1680, scale: 11 } : question ? SHOTS[1] : SHOTS[[2, 3, 4, 5, 0][si % 5]];
        A.shot(start, Object.assign({ d: shot === SHOTS[1] ? 0.45 : 0 }, shot));
        if (shot.x === 800) A.enter(start, "right"); else if (shot.x === 280) A.enter(start, "left");
        var pose = last ? "pointing" : question ? "surprised" : posv ? "celebrating" : neg ? "neutral" : "explaining";
        var expr = last ? "happy" : question ? "thinking" : posv ? "happy" : neg ? "serious" : ["confident", "happy", "neutral"][si % 3];
        A.act(start, pose, expr);
        if (!question && !neg) A.talk(start + 0.3, next - 0.1, ["explaining", "pointing"]);
        if (posv) { A.hop(start + 0.2, 24); BURSTS.push({ t: start + 0.2, x: 540, y: 900, kind: "confetti", n: 90, spread: 1300, seed: si * 13 + 1 }); }
        if (neg) A.hit(start + 0.15);
      }
      // Transition into the scene.
      if (!first) {
        var kind = si % 3;
        if (kind === 0) CRM.whip(tl, cam, start, si % 2 ? 1 : -1);
        else if (kind === 1) CRM.flash(tl, root.querySelector(".ar-flash"), start, 0.45);
        else CRM.punch(tl, cam, start + 0.05, 1.06, 0.4);
      }
      // Kinetic words: chunks of up to 4 words, each slamming on its first spoken word.
      var chunks = [];
      for (var c = 0; c < sw.length; c += 4) chunks.push(sw.slice(c, c + 4));
      if (last && A) chunks = [sw];
      chunks.forEach(function (ch, ci) {
        var el = document.createElement("div");
        el.className = "ar-t";
        var longest = ch.reduce(function (a, w) { return nrm(w.text).length > nrm(a.text).length ? w : a; }, ch[0]);
        el.innerHTML = ch.map(function (w) {
          var k = nrm(w.text), t = w.text.replace(/[<>&]/g, "");
          if (NEG.test(k)) return '<span class="neg">' + t + "</span>";
          return w === longest || POS.test(k) ? "<em>" + t + "</em>" : t;
        }).join(" ");
        if (ch.length > 6) el.style.fontSize = "92px";
        textLayer.appendChild(el);
        var t0 = Math.max(0, ch[0].start - 0.12), t1 = ci + 1 < chunks.length ? Math.max(0, chunks[ci + 1][0].start - 0.14) : next - 0.06;
        CRM.slam(tl, el, t0, { times: ch.map(function (w) { return Math.max(0, w.start - 0.06); }), shakeSel: cam, amp: neg ? 22 : 12 });
        if (neg) CRM.glitch(tl, el.querySelector(".neg") || el, t0 + 0.1, 0.3);
        CRM.out(tl, el, t1);
      });
      if (question || posv) LINES.push([start, start + 0.8]);
      if (last) CR.profileCTA(tl, Math.max(start + 0.3, sw[sw.length - 1].start - 0.6), { x: 70, y: 720, color: accent, ink: "#FFFFFF", until: D });
    });

    CRM.progress(tl, root.querySelector(".ar-bar"), D);
    var bg = bgC.getContext("2d"), av = avC.getContext("2d");
    function draw(t) {
      bg.clearRect(0, 0, 1080, 1920);
      CRM.background(bg, t, SC);
      LINES.forEach(function (l) { CRM.speedLines(bg, t, l[0], l[1], 540, 1000, pop); });
      av.clearRect(0, 0, 1080, 1920);
      if (A) A.draw(av, t);
      CRM.particles(av, t, BURSTS);
    }
    var st = { t: 0 };
    tl.to(st, { t: D, duration: D, ease: "none", onUpdate: function () { draw(st.t); } }, 0);
    draw(0);
    return { avatar: A, draw: draw };
  };

  window.CRM = CRM;
})();
