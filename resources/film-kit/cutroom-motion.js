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
    var A = { shots: [], acts: [], talks: [], enters: [], hits: [], hops: [], spins: [], sleeps: [], outline: opts.outline || "#C8FF5A", shadow: opts.shadow !== false, speaks: opts.speaks };

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
      if (!A.speaks || A.speaks(t)) y -= level(t) * s * 0.9;
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
      var state = { pose: tr.pose, expression: expressionAt(t), mouth: shut || (A.speaks && !A.speaks(t)) ? "X" : mouthAt(t), blink: blinkAt(t), frame: f };
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
      if (A.glow !== false) { ctx.save(); ctx.shadowColor = A.outline; ctx.shadowBlur = Math.min(60, tr.s * 4); blit(ctx, sil, o, tr.alpha * 0.9); ctx.restore(); }
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
        // Letters per word inside a no-wrap box, so a line never breaks in the middle of a word.
        el.innerHTML = el.textContent.split(" ").map(function (w) { return '<span style="display:inline-block;white-space:nowrap">' + w.split("").map(function (c) { return '<i class="l">' + c + "</i>"; }).join("") + "</span>"; }).join(" ");
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
  CRM.out = function (tl, sel, at, dur) {
    tl.to(sel, { autoAlpha: 0, scale: 0.6, duration: dur || 0.18, ease: "power2.in" }, at);
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

  /**
   * Effects layer for any format: a full-frame flash and a particle canvas on top of the film.
   *   var fx = CRM.overlay(tl, D, [{ t, x, y, kind, n, ... }]);  CRM.flash(tl, fx.flash, t, 0.5);
   */
  CRM.overlay = function (tl, D, bursts, opts) {
    opts = opts || {};
    var root = document.querySelector(opts.film || "[data-composition-id]");
    var flash = document.createElement("div");
    flash.style.cssText = "position:absolute;inset:0;z-index:58;pointer-events:none;visibility:hidden;opacity:0;background:" + (opts.flashColor || "#fff");
    var canvas = document.createElement("canvas");
    canvas.width = 1080; canvas.height = 1920;
    canvas.style.cssText = "position:absolute;left:0;top:0;width:1080px;height:1920px;z-index:57;pointer-events:none";
    root.appendChild(canvas); root.appendChild(flash);
    var ctx = canvas.getContext("2d"), st = { t: 0 };
    var lines = opts.speedLines || [];
    tl.to(st, { t: D, duration: D, ease: "none", onUpdate: function () {
      ctx.clearRect(0, 0, 1080, 1920);
      lines.forEach(function (l) { CRM.speedLines(ctx, st.t, l.from, l.to, l.x, l.y, l.color); });
      CRM.particles(ctx, st.t, bursts || []);
    } }, 0);
    return { flash: flash, canvas: canvas };
  };

  /* ------------------------------------------------------------------ cinematic finish (v2) */
  /**
   * Post layer on top of the whole film: drifting light leaks (screen blend), film grain (overlay
   * blend), vignette and a gentle colour grade. Leak bursts at transition times wash the cut.
   *   CRM.post(tl, D, { leaks: [t1, t2], grain: 0.09, grade: true, warm: "#ff9a5a", cool: "#7c5cff" })
   */
  CRM.post = function (tl, D, opts) {
    opts = opts || {};
    var root = document.querySelector(opts.film || "[data-composition-id]");
    if (opts.grade !== false) root.style.filter = (root.style.filter || "") + " saturate(1.12) contrast(1.06)";
    function layer(z, blend) {
      var c = document.createElement("canvas");
      c.width = 540; c.height = 960;
      c.style.cssText = "position:absolute;left:0;top:0;width:1080px;height:1920px;pointer-events:none;z-index:" + z + ";mix-blend-mode:" + blend;
      root.appendChild(c);
      return c.getContext("2d");
    }
    var leak = layer(61, "screen"), grain = layer(62, "overlay");
    var vig = document.createElement("div");
    vig.style.cssText = "position:absolute;inset:0;pointer-events:none;z-index:63;background:radial-gradient(ellipse at 50% 46%,transparent 55%,rgba(0,0,0," + (opts.vignette == null ? 0.42 : opts.vignette) + ") 100%)";
    root.appendChild(vig);
    // Four pre-baked grain tiles, cycled per frame (deterministic, cheap).
    var tiles = [];
    for (var k = 0; k < 4; k++) {
      var t0 = document.createElement("canvas"); t0.width = 270; t0.height = 480;
      var g = t0.getContext("2d"), img = g.createImageData(270, 480), r = rng(101 + k * 37);
      for (var i = 0; i < img.data.length; i += 4) { var v = 128 + (r() - 0.5) * 255; img.data[i] = img.data[i + 1] = img.data[i + 2] = v; img.data[i + 3] = 255; }
      g.putImageData(img, 0, 0); tiles.push(t0);
    }
    var warm = opts.warm || "#ff9a5a", cool = opts.cool || "#7c5cff", bursts = opts.leaks || [], amount = opts.grain == null ? 0.09 : opts.grain;
    function blob(ctx, x, y, rad, color, a) {
      var gr = ctx.createRadialGradient(x, y, 0, x, y, rad);
      gr.addColorStop(0, color); gr.addColorStop(1, "rgba(0,0,0,0)");
      ctx.globalAlpha = a; ctx.fillStyle = gr; ctx.fillRect(0, 0, 540, 960); ctx.globalAlpha = 1;
    }
    var st = { t: 0 };
    tl.to(st, { t: D, duration: D, ease: "none", onUpdate: function () {
      var t = st.t, f = Math.floor(t * 30);
      leak.clearRect(0, 0, 540, 960);
      // Ambient leaks drifting along the edges.
      blob(leak, 540 * (0.85 + 0.12 * Math.sin(t * 0.37)), 960 * (0.15 + 0.08 * Math.sin(t * 0.23)), 420, warm, 0.16);
      blob(leak, 540 * (0.1 + 0.1 * Math.sin(t * 0.29 + 2)), 960 * (0.85 + 0.06 * Math.cos(t * 0.31)), 380, cool, 0.14);
      // Bursts that wash the cuts.
      for (var b = 0; b < bursts.length; b++) {
        var dt = t - bursts[b];
        if (dt < -0.15 || dt > 0.7) continue;
        var p = dt < 0 ? (dt + 0.15) / 0.15 : 1 - dt / 0.7;
        var x = 540 * (b % 2 ? 0.2 + dt : 0.8 - dt);
        blob(leak, x, 960 * 0.4, 700, b % 2 ? cool : warm, 0.75 * Math.max(0, p));
        blob(leak, x, 960 * 0.45, 260, "#fff3d6", 0.5 * Math.max(0, p));
      }
      grain.clearRect(0, 0, 540, 960);
      grain.globalAlpha = amount; grain.drawImage(tiles[f % 4], 0, 0, 540, 960); grain.globalAlpha = 1;
    } }, 0);
    return { leakCtx: leak, grainCtx: grain };
  };

  /** Living background: soft colour blobs drifting over a dark base (mesh gradient), plus faint grid. */
  CRM.mesh = function (ctx, t, palette, opts) {
    opts = opts || {};
    var W = ctx.canvas.width, H = ctx.canvas.height, P = palette || ["#141318", "#7C5CFF", "#C8FF5A", "#FF5A36"];
    if (opts.base !== false) { ctx.fillStyle = P[0]; ctx.fillRect(0, 0, W, H); }
    var spots = [[0.2, 0.18, 0.9, 1], [0.85, 0.3, 0.8, 2], [0.3, 0.8, 0.85, 3], [0.8, 0.85, 0.7, 1]];
    ctx.save(); ctx.globalCompositeOperation = "lighter";
    spots.forEach(function (s, i) {
      var x = W * (s[0] + 0.12 * Math.sin(t * (0.21 + i * 0.07) + i)), y = H * (s[1] + 0.08 * Math.cos(t * (0.17 + i * 0.05) + i * 2));
      var rad = W * s[2], gr = ctx.createRadialGradient(x, y, 0, x, y, rad), c = P[s[3] % P.length];
      gr.addColorStop(0, c); gr.addColorStop(1, "rgba(0,0,0,0)");
      ctx.globalAlpha = opts.strength == null ? 0.33 : opts.strength; ctx.fillStyle = gr; ctx.fillRect(0, 0, W, H);
    });
    ctx.restore(); ctx.globalAlpha = 1;
    if (opts.grid !== false) {
      ctx.strokeStyle = "rgba(255,255,255,0.05)"; ctx.lineWidth = 2;
      var step = 90, off = (t * 18) % step;
      for (var gx = -step; gx < W + step; gx += step) { ctx.beginPath(); ctx.moveTo(gx + off, 0); ctx.lineTo(gx + off, H); ctx.stroke(); }
      for (var gy = -step; gy < H + step; gy += step) { ctx.beginPath(); ctx.moveTo(0, gy + off); ctx.lineTo(W, gy + off); ctx.stroke(); }
    }
  };

  /** Words rise from blur to sharp, one by one (calm, premium lines). */
  CRM.rise = function (tl, sel, at, opts) {
    opts = opts || {};
    CRM.split(sel);
    var root = els(sel)[0];
    tl.set(root, { autoAlpha: 1 }, at);
    var words = root.querySelectorAll(".w"), gap = opts.gap == null ? 0.09 : opts.gap;
    for (var i = 0; i < words.length; i++) {
      var ta = (opts.times && opts.times[i] != null) ? opts.times[i] : at + i * gap;
      tl.fromTo(words[i], { autoAlpha: 0, y: 70, filter: "blur(18px)", display: "inline-block" }, { autoAlpha: 1, y: 0, filter: "blur(0px)", duration: 0.5, ease: "expo.out" }, ta);
    }
    return tl;
  };

  /** Karaoke pill: the spoken word gets a coloured pill that hops word to word with the voice. */
  CRM.karaoke = function (tl, sel, words, opts) {
    opts = opts || {};
    CRM.split(sel);
    var root = els(sel)[0], spans = root.querySelectorAll(".w");
    tl.set(root, { autoAlpha: 1 }, Math.max(0, words[0].start - 0.15));
    tl.fromTo(spans, { autoAlpha: 0, y: 30 }, { autoAlpha: 1, y: 0, duration: 0.25, stagger: 0.03, ease: "back.out(2)" }, Math.max(0, words[0].start - 0.15));
    for (var i = 0; i < spans.length && i < words.length; i++) {
      var w = spans[i], s = words[i].start, e = i + 1 < words.length ? words[i + 1].start : words[i].end + 0.2;
      tl.to(w, { backgroundColor: opts.pill || "#C8FF5A", color: opts.ink || "#141318", scale: 1.08, duration: 0.08 }, s);
      tl.to(w, { backgroundColor: "rgba(0,0,0,0)", color: opts.color || "#FFFFFF", scale: 1, duration: 0.1 }, e);
    }
    return tl;
  };

  /** Scramble: glyphs churn and lock left to right (tech words, numbers). Deterministic. */
  CRM.scramble = function (tl, sel, at, dur) {
    dur = dur || 0.7;
    els(sel).forEach(function (el) {
      var target = el.textContent, glyphs = "ABCDEFGHJKLMNPQRSTUVWXYZ0123456789#%&@$", r = rng(Math.floor(at * 977) + target.length);
      tl.set(el, { autoAlpha: 1 }, at);
      var steps = Math.round(dur / 0.04);
      for (var k = 0; k <= steps; k++) {
        var lock = Math.floor((k / steps) * target.length), s = "";
        for (var c = 0; c < target.length; c++) s += c < lock || target[c] === " " ? target[c] : glyphs[Math.floor(r() * glyphs.length)];
        (function (txt) { tl.call(function () { el.textContent = txt; }, null, at + k * 0.04); })(s);
      }
      tl.call(function () { el.textContent = target; }, null, at + dur + 0.01);
    });
    return tl;
  };

  /** Letters fly apart on exit (end of a scene). */
  CRM.explode = function (tl, sel, at) {
    els(sel).forEach(function (el) {
      if (!el.dataset.letters) { el.dataset.letters = "1"; el.innerHTML = el.innerHTML.replace(/>([^<]+)</g, function (m, txt) { return ">" + txt.split("").map(function (c) { return c === " " ? " " : '<b class="l" style="display:inline-block;font-weight:inherit">' + c + "</b>"; }).join("") + "<"; }); }
      var r = rng(Math.floor(at * 331) + 7);
      el.querySelectorAll(".l").forEach(function (l) {
        tl.to(l, { x: (r() - 0.5) * 700, y: (r() - 0.3) * 900, rotation: (r() - 0.5) * 540, autoAlpha: 0, duration: 0.55, ease: "power2.in" }, at + r() * 0.08);
      });
    });
    return tl;
  };

  /** A light sweep crossing a card or title (gloss). */
  CRM.shimmer = function (tl, sel, at) {
    els(sel).forEach(function (el) {
      var s = document.createElement("i");
      s.style.cssText = "position:absolute;top:-20%;bottom:-20%;left:0;width:35%;pointer-events:none;background:linear-gradient(100deg,transparent,rgba(255,255,255,.55),transparent);mix-blend-mode:overlay";
      if (getComputedStyle(el).position === "static") el.style.position = "relative";
      el.style.overflow = "hidden"; el.appendChild(s);
      tl.fromTo(s, { xPercent: -150 }, { xPercent: 380, duration: 0.7, ease: "power2.inOut" }, at);
    });
    return tl;
  };

  /* ------------------------------------------------------------------ story director */
  /**
   * Parses a dialogue script:
   *   # Episódio 1: O primeiro cliente
   *   [cena: quarto, noite]
   *   Narrador: Episódio um.
   *   Léo (animado): Bia, acorda!
   * → { title, lines: [{who, mood, text, scene}] }. Lines without "Nome:" belong to the narrator.
   */
  CRM.parseStory = function (src) {
    var out = { title: "", episode: "", lines: [] }, scene = { place: "quarto", time: "dia" };
    String(src || "").split(/\r?\n/).forEach(function (raw) {
      var line = raw.trim();
      if (!line) return;
      var h = /^#\s*(.+)$/.exec(line);
      if (h) { var m = /^(epis[oó]dio\s*\d+)\s*[:\-–]\s*(.+)$/i.exec(h[1]); out.episode = m ? m[1] : ""; out.title = m ? m[2] : h[1]; return; }
      var sc = /^\[\s*cena\s*:\s*([^\],]+)(?:,\s*([^\]]+))?\]$/i.exec(line);
      if (sc) { scene = { place: nrm(sc[1]), time: nrm(sc[2] || "dia") }; return; }
      var d = /^([^:()\[\]]{1,24}?)\s*(?:\(([^)]+)\))?\s*:\s*(.+)$/.exec(line);
      if (d) out.lines.push({ who: d[1].trim(), mood: nrm(d[2] || ""), text: d[3].trim(), scene: scene });
      else out.lines.push({ who: "Narrador", mood: "", text: line, scene: scene });
    });
    return out;
  };

  /** Flat illustrated sets drawn on canvas: quarto, escritorio, rua, cafe (dia/noite). */
  CRM.set = function (ctx, t, scene) {
    var W = ctx.canvas.width, H = ctx.canvas.height, night = /noite|madrugada/.test(scene.time);
    var wall = { quarto: night ? ["#1d2147", "#2b2f63"] : ["#f3d9b8", "#e9c79c"], escritorio: night ? ["#18263b", "#22344f"] : ["#dfe8f0", "#c9d6e2"], rua: night ? ["#0b1430", "#27305e"] : ["#8fd0f4", "#cdeefc"], cafe: night ? ["#2b1d1a", "#3b2924"] : ["#f2dcc6", "#e3c3a3"] }[scene.place] || (night ? ["#1b1530", "#2a2350"] : ["#e8e4f5", "#d6cff0"]);
    var g = ctx.createLinearGradient(0, 0, 0, H); g.addColorStop(0, wall[0]); g.addColorStop(1, wall[1]);
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    var floorY = H * 0.78;
    if (scene.place === "rua") {
      // Skyline with lit windows, then the sidewalk.
      var r = rng(19);
      for (var b = 0; b < 9; b++) {
        var bx = b * 130 - 30, bw = 110 + r() * 50, bh = 500 + r() * 600;
        ctx.fillStyle = night ? "#141a3a" : "#7aa6c8"; ctx.fillRect(bx, floorY - bh, bw, bh);
        for (var wy = floorY - bh + 30; wy < floorY - 40; wy += 60) for (var wx = bx + 16; wx < bx + bw - 20; wx += 34) { ctx.fillStyle = night && r() > 0.45 ? "#ffd56b" : night ? "#232b55" : "#b9d9ef"; ctx.fillRect(wx, wy, 18, 26); }
      }
    } else {
      // Window with sky/moon and a skirting line.
      ctx.fillStyle = night ? "#0c1230" : "#9bd6f6"; ctx.fillRect(W * 0.58, H * 0.16, 320, 380);
      if (night) { ctx.fillStyle = "#f4f1c9"; ctx.beginPath(); ctx.arc(W * 0.58 + 230, H * 0.16 + 110, 50, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = "#0c1230"; ctx.beginPath(); ctx.arc(W * 0.58 + 205, H * 0.16 + 95, 46, 0, Math.PI * 2); ctx.fill(); }
      else { ctx.fillStyle = "#fff"; ctx.globalAlpha = 0.8; ctx.fillRect(W * 0.58 + 40 + ((t * 12) % 200), H * 0.16 + 80, 120, 34); ctx.globalAlpha = 1; }
      ctx.strokeStyle = night ? "#3a3f7a" : "#ffffff"; ctx.lineWidth = 16; ctx.strokeRect(W * 0.58, H * 0.16, 320, 380);
      ctx.beginPath(); ctx.moveTo(W * 0.58 + 160, H * 0.16); ctx.lineTo(W * 0.58 + 160, H * 0.16 + 380); ctx.stroke();
      if (scene.place === "quarto") { ctx.fillStyle = night ? "#3b2f6b" : "#c98f5a"; ctx.fillRect(60, floorY - 200, 420, 200); ctx.fillStyle = night ? "#e6e2ff" : "#fff6ea"; ctx.fillRect(80, floorY - 240, 160, 60); }
      if (scene.place === "escritorio" || scene.place === "cafe") {
        ctx.fillStyle = night ? "#2d3a55" : "#8a6a4f"; ctx.fillRect(80, floorY - 240, 520, 26); ctx.fillRect(120, floorY - 214, 20, 214); ctx.fillRect(540, floorY - 214, 20, 214);
        ctx.fillStyle = "#11131c"; ctx.fillRect(200, floorY - 470, 300, 210);
        var glow = night ? 0.85 + 0.15 * Math.sin(t * 3) : 0.6; ctx.fillStyle = "rgba(124,92,255," + glow + ")"; ctx.fillRect(214, floorY - 456, 272, 182);
        if (scene.place === "cafe") { ctx.fillStyle = "#fff"; ctx.fillRect(640, floorY - 300, 70, 60); ctx.fillStyle = "#6b3e26"; ctx.fillRect(650, floorY - 290, 50, 14); }
      }
    }
    ctx.fillStyle = night ? "#121633" : scene.place === "rua" ? "#9a9aa8" : "#b98a62"; ctx.fillRect(0, floorY, W, H - floorY);
    ctx.fillStyle = "rgba(0,0,0,0.12)"; ctx.fillRect(0, floorY, W, 14);
    if (night) { var v = ctx.createRadialGradient(W / 2, H * 0.6, 100, W / 2, H * 0.6, H); v.addColorStop(0, "rgba(0,0,0,0)"); v.addColorStop(1, "rgba(0,0,0,0.45)"); ctx.fillStyle = v; ctx.fillRect(0, 0, W, H); }
  };

  /**
   * Directs an episode from a dialogue script: each character is an avatar that talks only on its
   * own lines, comic speech bubbles, narrator boxes, sets per scene, close-ups on emotional lines,
   * a title card and a "continua" end card.
   *   CRM.autoStory({ tl, film, duration, engine, script, cast: { "Léo": pkg, "Bia": pkg }, episode })
   */
  CRM.autoStory = function (o) {
    var tl = o.tl, root = document.querySelector(o.film || "#film"), D = o.duration, story = CRM.parseStory(o.script);
    var accent = o.accent || "#7C5CFF", pop = o.pop || "#C8FF5A";
    var css = document.createElement("style");
    css.textContent =
      "#cam{position:absolute;inset:0;transform-origin:50% 55%}#cam canvas{position:absolute;left:0;top:0;width:1080px;height:1920px}" +
      ".st-bubble{position:absolute;max-width:900px;padding:32px 44px;border:8px solid #141318;border-radius:50px;background:#fff;color:#141318;font:800 66px/1.12 'Instrument Sans',sans-serif;visibility:hidden;opacity:0;z-index:20;box-shadow:0 14px 0 rgba(0,0,0,.18)}" +
      ".st-bubble .w{display:inline-block}.st-bubble span .w{padding:0 8px;margin:0 -4px;border-radius:14px}.st-bubble b{display:block;margin-bottom:8px;font:400 34px/1 Anton,sans-serif;letter-spacing:2px;text-transform:uppercase;color:" + accent + "}" +
      ".st-bubble::after{content:'';position:absolute;bottom:-46px;left:var(--tail,120px);border:24px solid transparent;border-top:30px solid #141318}" +
      ".st-nar{position:absolute;left:70px;right:70px;top:170px;padding:24px 34px;background:#FFD23F;color:#141318;border:7px solid #141318;font:800 60px/1.15 'Instrument Sans',sans-serif;visibility:hidden;opacity:0;z-index:20;transform:rotate(-1.5deg)}" +
      ".st-nar .w{display:inline-block}" +
      ".st-title{position:absolute;left:60px;right:60px;top:560px;text-align:center;color:#fff;font:400 150px/1 Anton,sans-serif;text-transform:uppercase;visibility:hidden;opacity:0;z-index:25;text-shadow:0 10px 0 rgba(0,0,0,.35)}" +
      ".st-title small{display:block;font-size:64px;color:" + pop + ";letter-spacing:4px;margin-bottom:24px}" +
      ".st-end{position:absolute;left:60px;right:60px;top:560px;text-align:center;color:#fff;font:400 140px/1 Anton,sans-serif;visibility:hidden;opacity:0;z-index:25}";
    document.head.appendChild(css);
    var cam = document.createElement("div"); cam.id = "cam";
    var setC = document.createElement("canvas"); setC.width = 1080; setC.height = 1920;
    var avC = document.createElement("canvas"); avC.width = 1080; avC.height = 1920;
    cam.appendChild(setC); cam.appendChild(avC); root.appendChild(cam);
    var flash = document.createElement("div"); flash.style.cssText = "position:absolute;inset:0;background:#fff;z-index:58;visibility:hidden;opacity:0"; root.appendChild(flash);

    // Map each line to its spoken words (lines in order, word counts as written).
    var wi = 0, words = T.words;
    story.lines.forEach(function (l) {
      var n = l.text.split(/\s+/).filter(function (w) { return nrm(w); }).length;
      var seg = words.slice(wi, wi + n); wi += n;
      l.start = seg.length ? seg[0].start : (story.lines.length ? D * 0.9 : 0);
      l.end = seg.length ? seg[seg.length - 1].end : l.start + 1;
      l.words = seg;
    });
    var names = [];
    story.lines.forEach(function (l) { if (!/^narrador/i.test(l.who) && names.indexOf(l.who) < 0) names.push(l.who); });
    var slots = names.length === 1 ? [540] : [300, 780, 540];
    var cast = {};
    names.forEach(function (name, i) {
      var pkg = (o.cast && o.cast[name]) || (o.fallback && o.fallback[i % o.fallback.length]);
      if (!pkg || !o.engine) return;
      var speaks = function (t) { return story.lines.some(function (l) { return l.who === name && t >= l.start - 0.05 && t <= l.end + 0.1; }); };
      var A = CRM.avatar({ engine: o.engine, avatar: pkg, outline: i === 0 ? pop : "#FFFFFF", speaks: speaks });
      A.home = { x: slots[i] || 540, y: 1760, scale: 9 };
      A.shot(0, Object.assign({ d: 0 }, A.home)); A.enter(0.15 + i * 0.25, i % 2 ? "right" : "left");
      cast[name] = A;
    });

    var SCENES = [], LEAKS = [], BURSTS = [];
    var moodMap = { animado: ["celebrating", "happy"], feliz: ["celebrating", "happy"], sonolenta: ["neutral", "neutral"], sonolento: ["neutral", "neutral"], nervoso: ["surprised", "serious"], nervosa: ["surprised", "serious"], surpresa: ["surprised", "surprised"], surpreso: ["surprised", "surprised"], bravo: ["pointing", "serious"], brava: ["pointing", "serious"], pensativo: ["neutral", "thinking"], pensativa: ["neutral", "thinking"], confiante: ["explaining", "confident"] };
    var lastScene = null;
    story.lines.forEach(function (l, li) {
      var t0 = Math.max(0, l.start - 0.12), next = li + 1 < story.lines.length ? story.lines[li + 1].start - 0.12 : D;
      var key = l.scene.place + "|" + l.scene.time;
      if (key !== lastScene) { SCENES.push({ t: t0, scene: l.scene }); if (lastScene) { LEAKS.push(t0); CRM.flash(tl, flash, t0, 0.5); } lastScene = key; }
      var narrator = /^narrador/i.test(l.who), A = cast[l.who];
      if (narrator) {
        // Title card on the first narrator line when the script has a title; else a narration box.
        if (li === 0 && story.title) {
          var tt = document.createElement("div"); tt.className = "st-title";
          tt.innerHTML = "<small>" + (story.episode || "episódio") + "</small>" + story.title.replace(/[<>&]/g, "");
          root.appendChild(tt);
          CRM.popIn(tl, tt, t0, { rot: -4 }); CRM.out(tl, tt, next - 0.1);
        } else if (li === story.lines.length - 1) {
          // Give the final narrator line an end card.
          var dim = document.createElement("div"); dim.style.cssText = "position:absolute;inset:0;z-index:24;background:rgba(14,12,24,.72);visibility:hidden;opacity:0";
          root.appendChild(dim); tl.to(dim, { autoAlpha: 1, duration: 0.35 }, t0);
          var en = document.createElement("div"); en.className = "st-end"; en.textContent = l.text;
          root.appendChild(en); CRM.letters(tl, en, t0, { stagger: 0.03 });
          if (o.cta) CR.profileCTA(tl, t0 + 0.6, { x: 70, y: 1180, text: o.cta, color: accent, ink: "#FFFFFF", until: D });
        } else {
          var nb = document.createElement("div"); nb.className = "st-nar"; nb.textContent = l.text; root.appendChild(nb);
          CRM.rise(tl, nb, t0, { times: l.words.map(function (w) { return Math.max(0, w.start - 0.05); }) });
          CRM.out(tl, nb, next - 0.12, 0.1);
        }
        // Everyone back to the two-shot.
        names.forEach(function (n) { if (cast[n]) cast[n].shot(t0, Object.assign({ d: 0.4, e: "inOut" }, cast[n].home)); });
        return;
      }
      if (!A) return;
      var emo = /!/.test(l.text), ask = /\?/.test(l.text), m = moodMap[l.mood];
      var pose = m ? m[0] : emo ? "explaining" : ask ? "surprised" : "explaining", expr = m ? m[1] : emo ? "happy" : ask ? "thinking" : "confident";
      A.act(t0, pose, expr);
      if (/sonolent/.test(l.mood)) A.sleep(t0, t0 + 0.4);
      // Emotional lines get the close-up; the others the two-shot with the speaker slightly forward.
      var close = (emo || ask || /surpres|nervos/.test(l.mood)) && li % 2 === 1;
      names.forEach(function (n) {
        var B = cast[n]; if (!B) return;
        if (close) B.shot(t0, n === l.who ? { x: 540, y: 2950, scale: 24, d: 0.35, e: "out" } : { x: B.home.x < 540 ? -400 : 1480, y: 1700, scale: 8, d: 0.3 });
        else B.shot(t0, n === l.who ? { x: B.home.x, y: 1730, scale: 9, d: 0.3, e: "inOut" } : Object.assign({ d: 0.3, e: "inOut" }, B.home));
      });
      if (/surpres/.test(l.mood) || (emo && li % 3 === 0)) { A.hop(t0 + 0.1, 20); BURSTS.push({ t: t0 + 0.1, x: close ? 540 : A.home.x, y: 1100, kind: "spark", n: 30, spread: 700, seed: li * 7 + 3 }); }
      if (close) CRM.punch(tl, cam, t0 + 0.02, 1.04, 0.3);
      // Speech bubble above the speaker (or near the top on a close-up).
      var bb = document.createElement("div"); bb.className = "st-bubble";
      bb.innerHTML = "<b>" + l.who.replace(/[<>&]/g, "") + "</b><span>" + l.text.replace(/[<>&]/g, "") + "</span>";
      var left = close ? 90 : Math.max(40, Math.min(1080 - 940, A.home.x - 320));
      bb.style.left = left + "px"; bb.style.top = (close ? 220 : 640) + "px";
      bb.style.setProperty("--tail", (close ? 440 : Math.max(60, Math.min(640, A.home.x - left - 24))) + "px");
      root.appendChild(bb);
      tl.fromTo(bb, { autoAlpha: 0, scale: 0.4, y: 40 }, { autoAlpha: 1, scale: 1, y: 0, duration: 0.3, ease: "back.out(2.4)" }, t0);
      CRM.karaoke(tl, bb.querySelector("span"), l.words, { pill: pop, ink: "#141318", color: "#141318" });
      CRM.out(tl, bb, next - 0.12, 0.1);
    });

    var sx = setC.getContext("2d"), ax = avC.getContext("2d"), st = { t: 0 };
    tl.to(st, { t: D, duration: D, ease: "none", onUpdate: function () {
      var t = st.t, cur = SCENES[0] ? SCENES[0].scene : { place: "quarto", time: "dia" };
      for (var i = 0; i < SCENES.length; i++) if (SCENES[i].t <= t) cur = SCENES[i].scene;
      sx.clearRect(0, 0, 1080, 1920); CRM.set(sx, t, cur);
      ax.clearRect(0, 0, 1080, 1920);
      names.forEach(function (n) { if (cast[n]) cast[n].draw(ax, t); });
      CRM.particles(ax, t, BURSTS);
    } }, 0);
    CRM.post(tl, D, { film: o.film || "#film", leaks: LEAKS, grain: 0.06 });
    return { story: story, cast: cast };
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
  function drawReelMotion(parent, layers, tl, start, end, last) {
    var ns = "http://www.w3.org/2000/svg";
    var svg = document.createElementNS(ns, "svg");
    svg.setAttribute("viewBox", "0 0 1080 1920");
    svg.style.cssText = "position:absolute;inset:0;width:100%;height:100%;visibility:hidden;pointer-events:none";
    layers.forEach(function (layer) {
      var shape = layer.shape, node = document.createElementNS(ns, shape.kind);
      var attributes = {
        rect: ["x", "y", "width", "height"],
        circle: ["cx", "cy", "r"],
        path: ["d"],
        text: ["x", "y"],
      };
      attributes[shape.kind].forEach(function (name) { node.setAttribute(name, shape[name]); });
      node.setAttribute("fill", layer.fill);
      if (layer.stroke) node.setAttribute("stroke", layer.stroke);
      if (layer.strokeWidth != null) node.setAttribute("stroke-width", layer.strokeWidth);
      if (shape.kind === "rect" && shape.radius != null) node.setAttribute("rx", shape.radius);
      if (shape.kind === "text") {
        node.setAttribute("font-size", shape.fontSize);
        node.setAttribute("font-family", "Fredoka, Instrument Sans, sans-serif");
        node.setAttribute("font-weight", "700");
        node.textContent = shape.text;
      }
      svg.appendChild(node);
      if (layer.move) {
        var move = layer.move, length = end - start;
        tl.to(node, {
          x: move.x || 0, y: move.y || 0, scale: move.scale ?? 1,
          rotation: move.rotate || 0, opacity: move.opacity ?? 1,
          transformOrigin: "50% 50%", ease: "power2.inOut", duration: length * (move.end - move.start),
        }, start + length * move.start);
      }
    });
    parent.appendChild(svg);
    tl.set(svg, { visibility: "visible" }, start);
    if (!last) tl.set(svg, { visibility: "hidden" }, end);
  }

  CRM.autoReel = function (o) {
    var tl = o.tl, root = document.querySelector(o.film || "#film"), D = o.duration;
    var brand = o.brand || {}, accent = brand.accent || "#7C5CFF", pop = brand.pop || "#C8FF5A";
    var css = document.createElement("style");
    css.textContent =
      "#cam{position:absolute;inset:0;transform-origin:50% 45%}" +
      "#cam canvas{position:absolute;left:0;top:0;width:1080px;height:1920px}" +
      ".ar-t{position:absolute;left:60px;right:60px;top:170px;text-align:center;font-family:Anton,sans-serif;text-transform:uppercase;font-size:118px;line-height:.98;color:#fff;text-shadow:0 8px 0 rgba(0,0,0,.35);visibility:hidden;opacity:0}" +
      ".ar-t .w{display:inline-block}.ar-t em{font-style:normal;color:" + pop + "}.ar-t .neg{color:#FF3D5A}" +
      ".ar-k .w{padding:4px 16px;margin:2px;border-radius:18px}.ar-k em{color:inherit}" +
      ".ar-bar{position:absolute;left:0;top:0;height:14px;width:1080px;background:" + pop + ";z-index:50}" +
      ".ar-flash{position:absolute;inset:0;background:#fff;z-index:60;visibility:hidden;opacity:0}" +
      ".ar-vig{position:absolute;inset:0;z-index:55;pointer-events:none;background:radial-gradient(ellipse at center,transparent 58%,rgba(0,0,0,.45) 100%)}";
    document.head.appendChild(css);
    var cam = document.createElement("div"); cam.id = "cam";
    var bgC = document.createElement("canvas"); bgC.width = 1080; bgC.height = 1920;
    var avC = document.createElement("canvas"); avC.width = 1080; avC.height = 1920;
    cam.appendChild(bgC);
    var artLayer = document.createElement("div"); cam.appendChild(artLayer);
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

    var planned = Array.isArray(o.scenes) ? o.scenes : [];
    if (planned.length && words.length >= planned.length) {
      var counts = planned.map(function (scene) { return scene.narration.trim().split(/\s+/).length; });
      var total = counts.reduce(function (sum, count) { return sum + count; }, 0);
      var cumulative = 0, offset = 0;
      sentences = counts.map(function (count, index) {
        cumulative += count;
        var remaining = counts.length - index - 1;
        var end = Math.min(words.length - remaining, Math.max(offset + 1, Math.round(words.length * cumulative / total)));
        var sentence = words.slice(offset, end);
        offset = end;
        return sentence;
      });
    }
    if (planned.length) {
      var visualLayer = document.createElement("div");
      cam.insertBefore(visualLayer, avC);
      planned.forEach(function (scene, index) {
        var start = index === 0 ? 0 : sentences[index] ? sentences[index][0].start : D * index / planned.length;
        var end = index === planned.length - 1 ? D : sentences[index + 1] ? sentences[index + 1][0].start : D * (index + 1) / planned.length;
        if (scene.motion && end > start) drawReelMotion(artLayer, scene.motion, tl, start, end, index === planned.length - 1);
        if (end - start < 0.35) return;
        var panel = document.createElement("section");
        panel.style.cssText = "position:absolute;left:92px;right:92px;top:505px;visibility:hidden;color:white;font:700 48px Instrument Sans,sans-serif;line-height:1.12";
        var title = document.createElement("h2");
        title.style.cssText = "font:400 70px Anton,sans-serif;margin:0 0 36px;overflow-wrap:anywhere";
        title.textContent = scene.headline;
        if (scene.headline) panel.appendChild(title);
        var row = document.createElement("div");
        row.style.cssText = "display:flex;gap:24px";
        if (scene.visual === "steps" || scene.visual === "interface") row.style.flexDirection = "column";
        scene.elements.forEach(function (label, j) {
          var item = document.createElement("div");
          item.style.cssText = "flex:1;min-width:0;padding:32px;border:2px solid #ffffff44;border-radius:26px;background:#131023e8;overflow-wrap:anywhere";
          if (scene.visual === "interface") item.style.borderLeft = "14px solid " + pop;
          if (scene.visual === "contrast" && j > 0) item.style.marginTop = "70px";
          if (scene.visual === "result" && j === scene.elements.length - 1) {
            item.style.background = pop;
            item.style.color = "#141318";
          }
          item.textContent = (scene.visual === "steps" ? (j + 1) + " · " : "") + label;
          row.appendChild(item);
        });
        var frames = (scene.proofFrames || []).filter(function (file) { return /^assets\/[a-z0-9-]+\.(png|jpe?g|webp)$/i.test(file); });
        if (frames.length) {
          var proof = document.createElement("div");
          proof.style.cssText = "position:relative;width:100%;height:500px;background:#131023;border-radius:24px;overflow:hidden";
          var used = frames.slice(0, Math.max(1, Math.ceil((end - start) * 8)));
          used.forEach(function (file, index) {
            var image = document.createElement("img");
            image.src = file;
            image.style.cssText = "position:absolute;inset:0;width:100%;height:100%;object-fit:contain;visibility:hidden";
            proof.appendChild(image);
            tl.set(image, { visibility: "visible" }, start + index / 8);
            if (index + 1 < used.length) tl.set(image, { visibility: "hidden" }, start + (index + 1) / 8);
          });
          panel.appendChild(proof);
        } else if (row.children.length) {
          panel.appendChild(row);
          tl.fromTo(row.children, { autoAlpha: 0, x: -36 }, { autoAlpha: 1, x: 0, duration: 0.22, stagger: 0.09 }, start + 0.12);
        }
        if (!panel.children.length) return;
        visualLayer.appendChild(panel);
        tl.fromTo(panel, { autoAlpha: 0, y: 56 }, { autoAlpha: 1, y: 0, duration: 0.28 }, start);
        tl.to(panel, { autoAlpha: 0, duration: 0.16 }, end - 0.17);
      });
    }

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
    // Molde de um vídeo de referência: cores, ritmo de cortes e energia (CRM.autoReel({ reference })).
    var REF = o.reference || null;
    function refShotAt(t) {
      if (!REF || !REF.shots || !REF.shots.length) return null;
      var f = t / Math.max(0.01, D), hit = REF.shots[0];
      for (var k = 0; k < REF.shots.length; k++) if (REF.shots[k].start <= f) hit = REF.shots[k];
      return hit;
    }
    function shade(hex, f) {
      var m = /^#?([0-9a-f]{6})$/i.exec(hex || ""); if (!m) return hex;
      var n = parseInt(m[1], 16), c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(function (v) { return Math.max(0, Math.min(255, Math.round(v * f))); });
      return "#" + c.map(function (v) { return ("0" + v.toString(16)).slice(-2); }).join("");
    }
    var SC = [], BURSTS = [], LINES = [];
    var r = rng(77);
    if (A) { A.shot(0, Object.assign({ d: 0 }, planned.length ? { x: 540, y: 1760, scale: planned[0].avatarSize === "small" ? 5 : 7 } : SHOTS[0])); A.enter(0.12, "drop"); A.act(0, "neutral", "happy"); BURSTS.push({ t: 0.44, x: 540, y: 1720, kind: "dust", n: 26, seed: 3 }); }

    sentences.forEach(function (sw, si) {
      var start = Math.max(0, sw[0].start - 0.08), next = si + 1 < sentences.length ? Math.max(0, sentences[si + 1][0].start - 0.08) : D;
      var text = sw.map(function (w) { return w.text; }).join(" ");
      var keys = sw.map(function (w) { return nrm(w.text); });
      var neg = keys.some(function (k) { return NEG.test(k); }), posv = keys.some(function (k) { return POS.test(k); });
      var question = /\?$/.test(text), last = si === sentences.length - 1, first = si === 0;
      // Background for the scene.
      var g = neg ? ["#2a0f18", "#0d0709"] : posv ? ["#7C5CFF", "#241a5e"] : GRADS[si % GRADS.length];
      var rs = refShotAt(start);
      // With a reference, the scene takes its colours (darkened so white captions stay readable).
      if (rs && rs.palette && rs.palette.length) g = [shade(rs.palette[rs.palette.length - 1], 0.55), shade(rs.palette[0], 0.35)];
      SC.push({ t: start, a: g[0], b: g[1], glow: neg ? "rgba(255,61,90,.35)" : rs && rs.palette ? shade(rs.palette[Math.min(1, rs.palette.length - 1)], 1) + "66" : "rgba(200,255,90,.30)", d: first ? 0 : 0.25 });
      // Same cutting rhythm as the reference: extra camera cuts inside long scenes.
      if (REF && REF.secondsPerShot > 0) {
        var gap = Math.max(0.9, REF.secondsPerShot), k2 = 0;
        for (var cutT = start + gap; cutT < next - 0.6; cutT += gap, k2++) {
          if ((rs && rs.motion > 0.45) || REF.energy > 0.35) { if (k2 % 2) CRM.whip(tl, cam, cutT, k2 % 4 ? 1 : -1); else CRM.punch(tl, cam, cutT, 1.08, Math.min(0.5, gap * 0.4)); }
          else CRM.punch(tl, cam, cutT, 1.04, Math.min(0.6, gap * 0.5));
        }
      }
      // Avatar framing and acting.
      if (A && !first) {
        var shot = last ? { x: 720, y: 1680, scale: 11 } : question ? SHOTS[1] : SHOTS[[2, 3, 4, 5, 0][si % 5]];
        if (planned.length) shot = { x: si % 2 ? 350 : 730, y: 1760, scale: planned[si]?.avatarSize === "small" ? 5 : 7 };
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
        // A calm reference keeps calm transitions; an energetic one hits harder.
        if (REF && REF.energy < 0.2) kind = 2;
        if (REF && REF.energy > 0.45 && kind === 2) { CRM.shake(tl, cam, start + 0.02, 18, 0.3); kind = si % 2; }
        if (kind === 0) CRM.whip(tl, cam, start, si % 2 ? 1 : -1);
        else if (kind === 1) CRM.flash(tl, root.querySelector(".ar-flash"), start, 0.45);
        else CRM.punch(tl, cam, start + 0.05, 1.06, 0.4);
      }
      // Kinetic words: chunks of up to 4 words, each slamming on its first spoken word.
      // Balanced chunks of at most 4 words (5 words → 3 + 2, never a lone word at the end).
      var chunks = [], per = Math.ceil(sw.length / Math.ceil(sw.length / 4));
      for (var c = 0; c < sw.length; c += per) chunks.push(sw.slice(c, c + per));
      if (last && A) chunks = [sw];
      if (planned[si]?.captions === false) chunks = [];
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
        var t0 = Math.max(0, ch[0].start - 0.12), t1 = ci + 1 < chunks.length ? Math.max(t0 + 0.3, chunks[ci + 1][0].start - 0.22) : next - 0.2;
        var times = ch.map(function (w) { return Math.max(0, w.start - 0.06); });
        // Text style per kind of sentence: impact → slam, calm/question → blur rise, long → karaoke pill.
        var style = neg || posv || first || last ? "slam" : question ? "rise" : ch.length >= 3 && si % 2 ? "karaoke" : "rise";
        if (style === "slam") CRM.slam(tl, el, t0, { times: times, shakeSel: cam, amp: neg ? 22 : 12 });
        else if (style === "rise") CRM.rise(tl, el, t0, { times: times });
        else { el.classList.add("ar-k"); CRM.karaoke(tl, el, ch, { pill: pop }); }
        if (neg) CRM.glitch(tl, el.querySelector(".neg") || el, t0 + 0.1, 0.3);
        if (posv && ci === chunks.length - 1 && !last) CRM.explode(tl, el, t1 - 0.05);
        else CRM.out(tl, el, t1, 0.1);
      });
      if (question || posv) LINES.push([start, start + 0.8]);
    });

    CRM.progress(tl, root.querySelector(".ar-bar"), D);
    CRM.post(tl, D, { film: o.film || "#film", leaks: sentences.slice(1).map(function (sw) { return Math.max(0, sw[0].start - 0.08); }) });
    var bg = bgC.getContext("2d"), av = avC.getContext("2d");
    function draw(t) {
      bg.clearRect(0, 0, 1080, 1920);
      CRM.background(bg, t, SC);
      CRM.mesh(bg, t, ["#000", accent, pop, "#FF5A36"], { base: false, grid: false, strength: 0.16 });
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
