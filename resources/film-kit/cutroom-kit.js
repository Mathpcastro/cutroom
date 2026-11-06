/*
 * CutRoom film kit — helpers for HyperFrames films written by agents.
 * Load after gsap and timing.js (window.TIMING = {words:[{text,start,end}], envelope:{fps,db:[]}, voiceEnd}).
 * Every helper adds tweens to a paused GSAP timeline at absolute seconds, so the film stays a pure
 * function of time (the renderer seeks frame by frame).
 */
(function () {
  "use strict";
  var T = window.TIMING || { words: [], envelope: { fps: 30, db: [] }, voiceEnd: 0 };
  var norm = function (s) {
    return String(s)
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]/g, "");
  };
  var darken = function (hex, f) {
    var m = /^#?([0-9a-f]{6})$/i.exec(hex || "");
    if (!m) return hex;
    var n = parseInt(m[1], 16),
      c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(function (v) {
        return ("0" + Math.round(v * f).toString(16)).slice(-2);
      });
    return "#" + c.join("");
  };
  var r3 = function (n) {
    return Math.round(n * 1000) / 1000;
  };

  var CR = {
    timing: T,
    /** Start (s) of the nth spoken occurrence of `text` (accents and punctuation ignored). */
    word: function (text, nth) {
      var k = 0,
        target = norm(text);
      for (var i = 0; i < T.words.length; i++)
        if (norm(T.words[i].text) === target && ++k === (nth || 1)) return T.words[i].start;
      throw new Error('CutRoom kit: word "' + text + '" #' + (nth || 1) + " is not in the narration");
    },
    /**
     * Like word(), but never throws: returns `fallback` (seconds) when the word is not in the narration.
     * Recipe starters use it so a film still renders after the script changes (re-anchor later).
     */
    at: function (text, nth, fallback) {
      try {
        return CR.word(text, nth);
      } catch (e) {
        return fallback === undefined ? 0 : fallback;
      }
    },
    /**
     * Cursor that travels and clicks. points: [{x, y, t, click?}] in px of the composition, t in s.
     * Creates the arrow once (white with ink outline) and a ripple on each click.
     */
    cursor: function (tl, points, opts) {
      var o = opts || {},
        root = document.querySelector(o.parent || "[data-composition-id]"),
        size = o.size || 96;
      var el = document.createElement("div");
      el.className = "cr-cursor";
      el.style.cssText = "position:absolute;left:0;top:0;width:" + size + "px;height:" + size * 1.4 + "px;z-index:" + (o.z || 40) + ";visibility:hidden;opacity:0;transform-origin:0 0";
      el.innerHTML = '<svg viewBox="0 0 40 56" width="100%" height="100%"><path d="M2 2 L2 46 L14 35 L22 54 L31 50 L23 32 L38 32 Z" fill="#fff" stroke="' + (o.ink || "#1E1C1A") + '" stroke-width="3" stroke-linejoin="round"/></svg>';
      root.appendChild(el);
      var ring = document.createElement("div");
      ring.style.cssText = "position:absolute;left:0;top:0;width:90px;height:90px;margin:-45px 0 0 -45px;border-radius:50%;border:8px solid " + (o.ring || "#fff") + ";z-index:" + ((o.z || 40) - 1) + ";visibility:hidden;opacity:0";
      root.appendChild(ring);
      (points || []).forEach(function (p, i) {
        if (i === 0) {
          tl.set(el, { x: p.x, y: p.y }, r3(Math.max(0, p.t - 0.01)));
          tl.fromTo(el, { autoAlpha: 0, scale: 0.6 }, { autoAlpha: 1, scale: 1, duration: 0.2 }, r3(p.t));
        } else tl.to(el, { x: p.x, y: p.y, duration: p.move || 0.42, ease: "power2.inOut" }, r3(p.t - (p.move || 0.42)));
        if (p.click) {
          tl.to(el, { scale: 0.84, duration: 0.07, yoyo: true, repeat: 1 }, r3(p.t));
          tl.set(ring, { x: p.x + 6, y: p.y + 6 }, r3(p.t));
          tl.fromTo(ring, { scale: 0.3, autoAlpha: 0.95 }, { scale: 1.7, autoAlpha: 0, duration: 0.34, ease: "power2.out" }, r3(p.t));
        }
      });
      if (o.hideAt) tl.to(el, { autoAlpha: 0, duration: 0.15 }, r3(o.hideAt));
      return el;
    },
    /**
     * Camera on a wrapper element: slow drift that never stops plus a punch-in on each `punches` time.
     * The wrapper should fill the frame (transform-origin center).
     */
    camera: function (tl, sel, until, punches, opts) {
      var o = opts || {},
        drift = o.drift || 0.035;
      for (var t = 0, k = 0; t < until; t += 3, k++)
        tl.to(sel, { scale: 1 + (k % 2 ? drift : drift * 0.4), x: k % 2 ? -14 : 12, duration: 3, ease: "sine.inOut" }, r3(t));
      // Punches go on an inner wrapper (opts.inner) so they never fight the drift tweens.
      var inner = o.inner || sel;
      (punches || []).forEach(function (p) {
        tl.fromTo(inner, { scale: 1 }, { scale: 1 + (o.punch || 0.06), duration: 0.12, ease: "power3.out", immediateRender: false }, r3(p));
        tl.to(inner, { scale: 1, duration: 0.5, ease: "power2.inOut" }, r3(p + 0.14));
      });
    },
    wordEnd: function (text, nth) {
      var start = CR.word(text, nth);
      for (var i = 0; i < T.words.length; i++) if (T.words[i].start === start) return T.words[i].end;
      return start;
    },
    // ---- motion vocabulary (durations tuned for 30 fps reels) ----
    pop: function (tl, sel, at) {
      tl.fromTo(sel, { scale: 0.55, autoAlpha: 0 }, { scale: 1, autoAlpha: 1, duration: 0.34, ease: "back.out(2.2)" }, r3(at));
    },
    rise: function (tl, sel, at) {
      tl.fromTo(sel, { y: 70, autoAlpha: 0 }, { y: 0, autoAlpha: 1, duration: 0.4, ease: "power3.out" }, r3(at));
    },
    exit: function (tl, sel, at) {
      tl.to(sel, { y: "-=50", autoAlpha: 0, duration: 0.22, ease: "power2.in" }, r3(at));
    },
    slam: function (tl, sel, at) {
      tl.fromTo(sel, { scale: 1.22, autoAlpha: 0 }, { scale: 1, autoAlpha: 1, duration: 0.24, ease: "power4.out" }, r3(at));
    },
    stamp: function (tl, sel, at, angle) {
      var a = angle === undefined ? -6 : angle;
      tl.fromTo(sel, { scale: 1.75, rotation: a - 12, autoAlpha: 0 }, { scale: 1, rotation: a, autoAlpha: 1, duration: 0.2, ease: "power3.out" }, r3(at));
    },
    spin: function (tl, sel, at) {
      tl.fromTo(sel, { scale: 0, rotation: -200, autoAlpha: 0 }, { scale: 1, rotation: 0, autoAlpha: 1, duration: 0.45, ease: "back.out(2)" }, r3(at));
    },
    /** Draws an SVG path: give it stroke-dasharray/offset = its length in CSS. */
    draw: function (tl, sel, at, duration) {
      tl.set(sel, { autoAlpha: 1 }, r3(at));
      tl.to(sel, { strokeDashoffset: 0, duration: duration || 0.35, ease: "power2.out" }, r3(at));
    },
    show: function (tl, sel, at) {
      tl.set(sel, { autoAlpha: 1 }, r3(at));
    },
    hide: function (tl, sel, at) {
      tl.set(sel, { autoAlpha: 0 }, r3(at));
    },
    /** Counts the element's text from `from` to `to`, landing at `at + duration` (land it on the spoken number). */
    count: function (tl, sel, from, to, at, duration, format) {
      var el = document.querySelector(sel),
        o = { v: from },
        fmt =
          format ||
          function (v) {
            return Math.round(v).toLocaleString("pt-BR");
          };
      tl.to(o, { v: to, duration: duration || 1.15, ease: "power2.out", onUpdate: function () { el.textContent = fmt(o.v); } }, r3(at));
      tl.call(function () { el.textContent = fmt(to); }, null, r3(at + (duration || 1.15)));
    },
    /** Types a line: the element needs overflow:hidden;white-space:nowrap;width:0 and its final text. */
    type: function (tl, sel, at) {
      var el = document.querySelector(sel),
        n = el.textContent.length;
      tl.fromTo(sel, { width: 0 }, { width: n + "ch", duration: Math.min(0.85, n * 0.05), ease: "steps(" + n + ")" }, r3(at));
    },
    /** Halftone dot wipe over the whole frame: a .cr-wipe element is created once. */
    wipe: function (tl, at, color) {
      var root = document.querySelector("[data-composition-id]"),
        layer = document.querySelector(".cr-wipe");
      if (!layer) {
        layer = document.createElement("div");
        layer.className = "cr-wipe";
        var W = Number(root.getAttribute("data-width")),
          H = Number(root.getAttribute("data-height")),
          cols = 13,
          rows = Math.round((13 * H) / W),
          step = W / cols;
        layer.style.cssText = "position:absolute;left:0;top:0;width:" + W + "px;height:" + H + "px;visibility:hidden;opacity:0;z-index:50;pointer-events:none";
        for (var r = 0; r < rows; r++)
          for (var c = 0; c < cols; c++) {
            var d = document.createElement("i");
            d.style.cssText = "position:absolute;width:" + step * 1.5 + "px;height:" + step * 1.5 + "px;left:" + (c * step - step * 0.25) + "px;top:" + (r * step - step * 0.25) + "px;border-radius:50%;background:" + (color || "#1E1C1A") + ";transform:scale(0)";
            layer.appendChild(d);
          }
        layer.dataset.grid = rows + "," + cols;
        root.appendChild(layer);
      }
      var grid = layer.dataset.grid.split(",").map(Number);
      tl.set(layer, { autoAlpha: 1 }, r3(at));
      tl.fromTo(layer.children, { scale: 0 }, { scale: 1, duration: 0.45, ease: "power2.in", stagger: { grid: grid, from: "center", amount: 0.12 } }, r3(at));
      tl.to(layer.children, { scale: 0, duration: 0.33, ease: "power2.out", stagger: { grid: grid, from: "center", amount: 0.1 } }, r3(at + 0.5));
      tl.set(layer, { autoAlpha: 0 }, r3(at + 0.95));
    },
    /**
     * Captions in meaning chunks (max words, broken at punctuation). Each word appears on the frame it
     * is spoken, grey, and turns ink in 0.2 s; key words get the .key class (style it).
     * opts: {el: container selector, maxWords: 4, keys: ["word"...], ink, grey, keyColor, until}
     */
    captions: function (tl, opts) {
      var o = opts || {},
        box = document.querySelector(o.el || ".cr-captions"),
        max = o.maxWords || 4,
        keys = (o.keys || []).map(norm),
        chunks = [],
        cur = [];
      T.words.forEach(function (w, i) {
        cur.push(w);
        if (/[.,?!:;]$/.test(w.text) || cur.length >= max || i === T.words.length - 1) {
          chunks.push(cur);
          cur = [];
        }
      });
      chunks.forEach(function (ch, ci) {
        var line = document.createElement("div");
        line.className = "cr-cap";
        line.style.cssText = "position:absolute;left:0;top:0;visibility:hidden;opacity:0";
        var keyAt = -1;
        ch.forEach(function (w, wi) {
          if (keyAt < 0 && keys.indexOf(norm(w.text)) >= 0) keyAt = wi;
        });
        ch.forEach(function (w, wi) {
          var s = document.createElement("span");
          s.className = "cr-w" + (wi === keyAt ? " key" : "");
          s.textContent = w.text.replace(/[.]$/, "");
          s.style.cssText = "visibility:hidden;opacity:0;color:" + (o.grey || "#B5AFA7");
          line.appendChild(s);
          if (wi < ch.length - 1) line.appendChild(document.createTextNode(" "));
          tl.set(s, { autoAlpha: 1 }, r3(w.start));
          tl.to(s, { color: wi === keyAt ? o.keyColor || "#E8462F" : o.ink || "#1E1C1A", duration: 0.2 }, r3(w.start));
        });
        box.appendChild(line);
        var next = ci + 1 < chunks.length ? chunks[ci + 1][0].start - 0.04 : o.until || T.voiceEnd + 0.6;
        tl.set(line, { autoAlpha: 1 }, r3(ch[0].start - 0.04));
        tl.set(line, { autoAlpha: 0 }, r3(next));
      });
    },
    /**
     * Mouth from the narration loudness, frame by frame: shapes are elements `${prefix}0` (closed) …
     * `${prefix}N` (wide). -42 dB closed, -16 dB wide, instant attack, 0.55 release per frame.
     */
    mouth: function (tl, prefix, shapes, opts) {
      var o = opts || {},
        lo = o.closed === undefined ? -42 : o.closed,
        hi = o.open === undefined ? -16 : o.open,
        fps = T.envelope.fps || 30,
        level = 0,
        prev = -1,
        all = [];
      for (var k = 0; k < shapes; k++) all.push(prefix + k);
      var allSel = all.join(",");
      (T.envelope.db || []).forEach(function (db, i) {
        level = Math.max(Math.min(1, Math.max(0, (db - lo) / (hi - lo))), level * 0.55);
        var shape = Math.round(level * (shapes - 1));
        if (shape !== prev) {
          tl.set(allSel, { autoAlpha: 0 }, r3(i / fps));
          tl.set(prefix + shape, { autoAlpha: 1 }, r3(i / fps));
          prev = shape;
        }
      });
      tl.set(allSel, { autoAlpha: 0 }, r3(T.voiceEnd + 0.05));
      tl.set(prefix + 0, { autoAlpha: 1 }, r3(T.voiceEnd + 0.05));
    },
    /** Blinks every 2.4–4.2 s on a fixed seed (scaleY 0 → 1 → 0 on the eyelid element). */
    blink: function (tl, sel, until, seed) {
      var s = seed || 7,
        rnd = function () {
          return (s = (s * 16807) % 2147483647) / 2147483647;
        };
      for (var t = 1.3; t < until - 0.3; t += 2.4 + rnd() * 1.8)
        tl.to(sel, { scaleY: 1, duration: 0.07, yoyo: true, repeat: 1, ease: "none" }, r3(t));
    },
    /** Slow sway that never stops (nothing on screen should be still for more than 1 s). */
    sway: function (tl, sel, until, degrees, period) {
      var p = period || 1.6;
      for (var t = 0, k = 0; t < until - p; t += p, k++)
        tl.to(sel, { rotation: (k % 2 ? -1 : 1) * (degrees || 2.2), duration: p, ease: "sine.inOut" }, r3(t));
    },
    /** Nod (and lift brows) on each listed word. */
    nod: function (tl, sel, words, brows) {
      (words || []).forEach(function (w) {
        tl.to(sel, { y: 10, duration: 0.18, yoyo: true, repeat: 1, ease: "power2.out" }, r3(w));
        if (brows) tl.to(brows, { y: -12, duration: 0.18, yoyo: true, repeat: 1, ease: "power2.out" }, r3(w - 0.05));
      });
    },
    /** A hand that rises from below for `hold` seconds. */
    gesture: function (tl, sel, at, hold) {
      tl.fromTo(sel, { y: 380 }, { y: 0, duration: 0.32, ease: "back.out(1.6)" }, r3(at));
      tl.to(sel, { y: 380, duration: 0.28, ease: "power2.in" }, r3(at + (hold || 1.7)));
    },
    /**
     * Pixel-art presenter (32x36 sprite, crisp SVG): 5 mouths driven by the narration loudness,
     * instant blinks, whole-pixel head bob, and a thumbs-up that rises on each time in `thumbs`.
     * opts: {parent:"#film", x, y, px:18, hoodie:"#E8462F", skin:"#F0C29B", hair:"#3A2A22", until, thumbs:[s], hold:1.6}
     * Returns {el, hand(t)} — call hand(t) for extra thumbs-ups. No motion blur on pixel art.
     */
    pixelPresenter: function (tl, opts) {
      var o = opts || {},
        PX = o.px || 18,
        until = o.until || (T.voiceEnd || 10) + 1.5;
      var hoodie = o.hoodie || (window.BRAND && window.BRAND.palette && window.BRAND.palette.accent) || "#E8462F";
      var PAL = {
        K: "#2B1D16", H: o.hair || "#3A2A22", h: o.hairLight || "#5C4336", S: o.skin || "#F0C29B", s: o.skinShade || "#D9A27A",
        W: "#FFFFFF", G: "#1E1C1A", E: "#1E1C1A", R: hoodie, r: o.hoodieShade || darken(hoodie, 0.78), D: "#F4F1EC",
        P: "#F2A08F", M: "#7A2F2A", T: "#E07A6A",
      };
      var half = [
        "..........KKKKKK", "........KKHHHHHH", ".......KHHHhHHHH", "......KHHHHHHHHH", ".....KHHhHHHHHHH", ".....KHHHHHHHHHH",
        "....KHHHHHHHHHHH", "....KHHHSSHHHHHH", "....KHSSSSSSHHSS", "...KKSSSSSSSSSSS", "...KSGGGGGGGGSSS", "..KSSGWWEEWWGGGG",
        "..KSSGWWEEWWGSSS", "...KSGGGGGGGGSSS", "...KSSSSSSSSSSSS", "...KSSPPSSSSSSSs", "...KSSPPSSSSSSss", "....KSSSSSSSSSSS",
        "....KSSSSSSSSSSS", ".....KSSSSSSSSSS", "......KSSSSSSSSS", ".......KKSSSSSSS", ".........KKKSSSS", "...........KsSSS",
        "...........KsSSS", "......KKKKKRRRRR", "....KKRRRRRRrRRR", "...KRRRRRRRRRrRR", "..KRRRRRRRRRDRRR", "..KRRRRRRRRRDRRR",
        ".KRRRRRRRRRRDRRR", ".KRrRRRRRRRRRRRR", ".KRrRRRRRRRRRRRR", "KRRrRRRRRRRRRRRR", "KRRrRRRRRRRRRRRR", "KRRrRRRRRRRRRRRR",
      ];
      var rows = half.map(function (h) {
        return h + h.split("").reverse().join("");
      });
      var runs = function (grid, ox, oy) {
        var out = "";
        grid.forEach(function (row, y) {
          for (var x = 0; x < row.length; ) {
            var c = row[x],
              e = x;
            while (e < row.length && row[e] === c) e++;
            if (c !== ".")
              out += '<rect x="' + ((ox || 0) + x) * PX + '" y="' + ((oy || 0) + y) * PX + '" width="' + (e - x) * PX + '" height="' + PX + '" fill="' + PAL[c] + '"/>';
            x = e;
          }
        });
        return out;
      };
      var MOUTHS = [
        ["........", "..KKKK..", "........", "........"],
        ["........", "..KKKK..", "..KMMK..", "........"],
        ["........", ".KKKKKK.", ".KMMMMK.", "..KKKK.."],
        [".KKKKKK.", ".KMMMMK.", ".KMTTMK.", "..KKKK.."],
        ["..KKKK..", ".KMMMMK.", ".KMTTMK.", "..KKKK.."],
      ];
      // Thumbs-up: thumb on the side, closed fist with finger creases. Never a single centred finger.
      var HAND = [
        ".KK.......", "KSSK......", "KSSK......", "KSSKKKKKK.", "KSSSSSSSSK", "KSSSSKKKSK",
        "KSSSSSSSSK", "KSSSSKKKSK", "KSSSSSSSSK", ".KSSSKKKK.", "..KRRRRK..", "..KRRRRK..",
      ];
      var mouths = MOUTHS.map(function (m, i) {
        return '<g class="crp-mo crp-mo' + i + '"' + (i ? ' style="visibility:hidden;opacity:0"' : "") + ">" + runs(m, 12, 17) + "</g>";
      }).join("");
      var lid = ["SSSSSS", "KKKKKK"];
      var w = 32 * PX,
        h = 36 * PX,
        parent = document.querySelector(o.parent || "[data-composition-id]");
      var root = parent.getBoundingClientRect ? parent : document.body;
      var x = o.x != null ? o.x : (parseFloat(root.getAttribute("data-width")) || 1080) - w - 6,
        y = o.y != null ? o.y : (parseFloat(root.getAttribute("data-height")) || 1920) - h;
      var holder = document.createElement("div");
      holder.className = "crp";
      holder.style.cssText = "position:absolute;left:" + x + "px;top:" + y + "px;width:" + w + "px;height:" + h + "px;z-index:" + (o.z || 7) + ";overflow:hidden"; // the hidden hand waits below the sprite
      holder.innerHTML =
        '<svg viewBox="0 0 ' + w + " " + h + '" width="' + w + '" height="' + h + '" shape-rendering="crispEdges" style="overflow:hidden">' +
        '<g class="crp-body">' + runs(rows.slice(25), 0, 25) + "</g>" +
        '<g class="crp-head">' + runs(rows.slice(0, 25)) + mouths +
        '<g class="crp-lid" style="visibility:hidden;opacity:0">' + runs(lid, 6, 11) + runs(lid, 20, 11) + "</g></g>" +
        '<g class="crp-hand" style="transform:translateY(' + 12 * PX + 'px)">' + runs(HAND, 22, 24) + "</g></svg>";
      parent.appendChild(holder);
      var q = function (s) {
        return holder.querySelectorAll(s);
      };
      // Mouth from loudness: fast attack, quick release, 5 shapes.
      var env = T.envelope || { fps: 30, db: [] },
        level = 0,
        prev = -1;
      for (var i = 0; i < env.db.length; i++) {
        level = Math.max(Math.min(1, Math.max(0, (env.db[i] + 42) / 26)), level * 0.55);
        var shape = Math.round(level * 4);
        if (shape !== prev) {
          tl.set(q(".crp-mo"), { autoAlpha: 0 }, r3(i / env.fps));
          tl.set(q(".crp-mo" + shape), { autoAlpha: 1 }, r3(i / env.fps));
          prev = shape;
        }
      }
      var end = r3((T.voiceEnd || 0) + 0.05);
      tl.set(q(".crp-mo"), { autoAlpha: 0 }, end);
      tl.set(q(".crp-mo0"), { autoAlpha: 1 }, end);
      var seed = o.seed || 11,
        rnd = function () {
          return (seed = (seed * 16807) % 2147483647) / 2147483647;
        };
      for (var b = 1.1; b < until - 0.3; b += 2.2 + rnd() * 1.8) {
        tl.set(q(".crp-lid"), { autoAlpha: 1 }, r3(b));
        tl.set(q(".crp-lid"), { autoAlpha: 0 }, r3(b + 0.1));
      }
      for (var t = 0, k = 0; t < until - 0.5; t += 0.5, k++) {
        tl.set(q(".crp-head"), { y: k % 2 ? PX : 0 }, r3(t));
        tl.set(q(".crp-body"), { y: k % 4 === 1 ? PX / 2 : 0 }, r3(t));
      }
      var hand = function (at) {
        tl.to(q(".crp-hand"), { y: 0, duration: 0.2, ease: "steps(4)" }, r3(at));
        tl.to(q(".crp-hand"), { y: 12 * PX, duration: 0.2, ease: "steps(4)" }, r3(at + (o.hold || 1.6)));
      };
      (o.thumbs || []).forEach(hand);
      return { el: holder, hand: hand };
    },
  };
  window.CR = CR;
})();
