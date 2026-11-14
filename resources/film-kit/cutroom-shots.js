/*
 * CutRoom shot engine (CRS): a film directed as a list of shots over drawn sets.
 *
 * The AI draws each set (and any prop) as SVG, the engine does the rest: a camera with parallax,
 * the pixel avatars acting in set coordinates, animated props, weather and particles, transitions
 * between shots, word-timed text, and a "look" (pixel art, watercolour, oil paint, crayon, comic ink,
 * gouache, retro film, clean vector, neon) applied to every frame.
 * Hand-made looks are drawn "on twos" (12 fps) so they feel animated by hand.
 *
 *   CRS.film({ tl, film: "#film", duration: D, plan: PLAN, engine: window.AvatarEngine,
 *              cast: { "Vini": window.FILM_AVATAR, "Bia": S.companion }, captions: true });
 *
 * Load after gsap, timing.js, cutroom-kit.js and cutroom-motion.js (CRM.avatar). Every frame is a pure
 * function of time, so seeking always gives the same pixels.
 */
(function () {
  "use strict";
  var T = window.TIMING || { words: [], envelope: { fps: 30, db: [] }, voiceEnd: 0 };

  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function lerp(a, b, p) { return a + (b - a) * p; }
  function smooth(p) { return p * p * (3 - 2 * p); }
  function inOut(p) { return p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2; }
  function rng(seed) {
    var s = (Math.abs(Math.floor(seed)) % 2147483646) + 1;
    return function () { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; };
  }
  function hash(n) { var x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); }
  function nrm(s) { return String(s).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]/g, ""); }
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function hexRgb(h) { var n = parseInt(String(h || "#000").replace("#", "").replace(/^(.)(.)(.)$/, "$1$1$2$2$3$3"), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }

  /* ------------------------------------------------------------------ looks */
  var LOOKS = {
    pixel: { fps: 12, boil: 0, block: 6, quantize: true, font: "Silkscreen", text: "pixel", outline: "ink", glow: false, vignette: 0.22, avatar: "crisp" },
    aquarela: { fps: 12, boil: 7, boilFreq: 0.012, soften: 2.6, paper: "wash", paperAlpha: 0.85, bleed: 0.3, edges: 0.35, filter: "saturate(.82) contrast(.92) brightness(1.08)", font: "Fredoka", text: "paper", outline: "ink", glow: false, vignette: 0.1, avatar: "soft" },
    oleo: { fps: 12, boil: 10, boilFreq: 0.02, soften: 2, paper: "canvas", paperAlpha: 0.45, brush: 0.6, filter: "saturate(1.16) contrast(1.08)", font: "InstrumentSerif", text: "serif", outline: "ink", glow: false, vignette: 0.28, avatar: "soft" },
    giz: { fps: 8, boil: 6, boilFreq: 0.05, soften: 1.6, paper: "crayon", paperAlpha: 0.9, filter: "saturate(1.08)", font: "Caveat", text: "hand", outline: "ink", glow: false, vignette: 0.12, avatar: "soft" },
    hq: { fps: 12, boil: 2, boilFreq: 0.02, halftone: 0.32, filter: "contrast(1.22) saturate(.9)", font: "Anton", text: "comic", outline: "ink", glow: false, vignette: 0.18, avatar: "crisp", ink: 1 },
    guache: { fps: 12, boil: 4, boilFreq: 0.015, soften: 1.8, paper: "paper", paperAlpha: 0.5, filter: "saturate(1.04)", font: "Fredoka", text: "paper", outline: "ink", glow: false, vignette: 0.12, avatar: "soft" },
    retro: { fps: 12, boil: 2, boilFreq: 0.02, soften: 1.5, grain: 0.18, filter: "sepia(.38) saturate(.78) contrast(1.06)", font: "InstrumentSerif", text: "serif", outline: "ink", glow: false, vignette: 0.55, weave: 2.2, scratches: true, avatar: "soft" },
    vetor: { fps: 30, boil: 0, filter: "none", font: "Fredoka", text: "clean", outline: "accent", glow: false, vignette: 0.14, avatar: "crisp" },
    neon: { fps: 30, boil: 0, filter: "saturate(1.25)", glow: 0.38, font: "Montserrat", text: "neon", outline: "accent", vignette: 0.4, avatar: "crisp" },
  };
  var FONTS = {
    Silkscreen: "'Silkscreen', monospace", Fredoka: "'Fredoka', sans-serif", InstrumentSerif: "'Instrument Serif', serif",
    Caveat: "'Caveat', cursive", Anton: "'Anton', sans-serif", Montserrat: "'Montserrat', sans-serif", Instrument: "'Instrument Sans', sans-serif",
  };

  /* ------------------------------------------------------------------ kit (recolourable SVG symbols) */
  // Each symbol paints with var(--a) main, var(--b) shade, var(--c) light/accent, var(--d) dark; <use style="--a:#..">.
  function F(v, d) { return "style=\"fill:var(--" + v + "," + d + ")\""; }
  var KIT = [
    '<symbol id="kit-tree" viewBox="0 0 200 260"><rect x="88" y="150" width="24" height="110" rx="6" ' + F("d", "#6B4A32") + '/><circle cx="100" cy="100" r="78" ' + F("a", "#5E8C4A") + '/><circle cx="62" cy="128" r="48" ' + F("b", "#46713A") + '/><circle cx="140" cy="122" r="52" ' + F("a", "#5E8C4A") + '/><circle cx="84" cy="70" r="34" ' + F("c", "#86B061") + '/></symbol>',
    '<symbol id="kit-pine" viewBox="0 0 160 280"><rect x="70" y="220" width="20" height="60" ' + F("d", "#5A3D2A") + '/><path d="M80 0 L150 120 L112 120 L158 200 L106 200 L150 240 L10 240 L54 200 L2 200 L48 120 L10 120Z" ' + F("a", "#3F6E52") + '/><path d="M80 0 L150 120 L112 120 L158 200 L106 200 L150 240 L80 240Z" ' + F("b", "#2F5741") + '/></symbol>',
    '<symbol id="kit-bush" viewBox="0 0 200 110"><ellipse cx="60" cy="70" rx="58" ry="40" ' + F("b", "#46713A") + '/><ellipse cx="130" cy="64" rx="66" ry="46" ' + F("a", "#5E8C4A") + '/><ellipse cx="110" cy="44" rx="34" ry="22" ' + F("c", "#86B061") + '/></symbol>',
    '<symbol id="kit-cloud" viewBox="0 0 260 120"><path d="M30 110 Q0 110 6 84 Q14 60 44 66 Q50 26 92 30 Q118 0 156 22 Q200 10 214 52 Q256 56 252 88 Q248 112 220 110Z" ' + F("a", "#FFFFFF") + '/><path d="M30 110 Q12 108 10 96 Q60 100 120 94 Q190 100 250 92 Q246 110 220 110Z" ' + F("b", "#DCE6F2") + '/></symbol>',
    '<symbol id="kit-sun" viewBox="0 0 200 200"><circle cx="100" cy="100" r="96" ' + F("c", "#FFE7A3") + ' opacity=".45"/><circle cx="100" cy="100" r="66" ' + F("a", "#FFC94A") + '/><circle cx="84" cy="84" r="30" ' + F("c", "#FFE7A3") + '/></symbol>',
    '<symbol id="kit-moon" viewBox="0 0 160 160"><circle cx="80" cy="80" r="76" ' + F("c", "#FFF6D8") + ' opacity=".25"/><circle cx="80" cy="80" r="52" ' + F("a", "#F4EFCF") + '/><circle cx="64" cy="66" r="10" ' + F("b", "#DCD5B0") + '/><circle cx="96" cy="96" r="7" ' + F("b", "#DCD5B0") + '/></symbol>',
    '<symbol id="kit-mountain" viewBox="0 0 600 360"><path d="M0 360 L210 40 L300 160 L380 80 L600 360Z" ' + F("a", "#7C8DB5") + '/><path d="M210 40 L300 160 L250 360 L0 360Z" ' + F("b", "#62739C") + '/><path d="M210 40 L250 100 L230 96 L210 120 L188 92 L172 98Z" ' + F("c", "#F2F4FA") + '/><path d="M380 80 L420 132 L398 128 L382 146 L362 120Z" ' + F("c", "#F2F4FA") + '/></symbol>',
    '<symbol id="kit-hills" viewBox="0 0 1080 300"><path d="M0 120 Q200 20 420 110 Q640 200 840 90 Q980 30 1080 80 L1080 300 L0 300Z" ' + F("a", "#7FB069") + '/><path d="M0 200 Q260 120 520 190 Q780 260 1080 170 L1080 300 L0 300Z" ' + F("b", "#5E8C4A") + '/></symbol>',
    '<symbol id="kit-building" viewBox="0 0 240 620"><rect x="0" y="20" width="240" height="600" ' + F("a", "#3E4A6B") + '/><rect x="0" y="0" width="240" height="30" ' + F("d", "#2A334C") + '/><rect x="170" y="20" width="70" height="600" ' + F("b", "#323C58") + '/>' +
      (function () { var s = ""; for (var y = 60; y < 580; y += 64) for (var x = 22; x < 200; x += 54) s += '<rect x="' + x + '" y="' + y + '" width="30" height="40" ' + F((x * 7 + y) % 3 ? "c" : "d", (x * 7 + y) % 3 ? "#FFD56B" : "#2A334C") + '/>'; return s; })() + "</symbol>",
    '<symbol id="kit-house" viewBox="0 0 300 300"><rect x="30" y="130" width="240" height="170" ' + F("a", "#E8D3B0") + '/><rect x="180" y="130" width="90" height="170" ' + F("b", "#D4BB92") + '/><path d="M0 140 L150 20 L300 140Z" ' + F("d", "#B5523B") + '/><rect x="120" y="200" width="60" height="100" ' + F("d", "#6B4A32") + '/><rect x="58" y="170" width="44" height="44" ' + F("c", "#9FD3F0") + '/><rect x="204" y="170" width="44" height="44" ' + F("c", "#9FD3F0") + '/></symbol>',
    '<symbol id="kit-lamp" viewBox="0 0 60 420"><rect x="26" y="60" width="8" height="360" ' + F("d", "#2B2B33") + '/><rect x="10" y="30" width="40" height="34" rx="6" ' + F("d", "#2B2B33") + '/><rect x="16" y="38" width="28" height="22" ' + F("c", "#FFE08A") + '/><circle cx="30" cy="50" r="30" ' + F("c", "#FFE08A") + ' opacity=".25"/></symbol>',
    '<symbol id="kit-desk" viewBox="0 0 520 260"><rect x="0" y="40" width="520" height="30" rx="6" ' + F("a", "#A87B55") + '/><rect x="0" y="62" width="520" height="12" ' + F("b", "#8A6244") + '/><rect x="30" y="72" width="24" height="188" ' + F("b", "#8A6244") + '/><rect x="466" y="72" width="24" height="188" ' + F("b", "#8A6244") + '/><rect x="330" y="74" width="140" height="90" ' + F("a", "#A87B55") + '/><rect x="384" y="112" width="34" height="8" rx="4" ' + F("d", "#5C4030") + '/></symbol>',
    '<symbol id="kit-laptop" viewBox="0 0 260 180"><rect x="30" y="0" width="200" height="140" rx="10" ' + F("d", "#23232B") + '/><rect x="42" y="12" width="176" height="114" rx="4" ' + F("c", "#7C5CFF") + '/><rect x="56" y="30" width="90" height="12" rx="6" fill="#FFFFFF" opacity=".85"/><rect x="56" y="54" width="140" height="8" rx="4" fill="#FFFFFF" opacity=".5"/><rect x="56" y="70" width="120" height="8" rx="4" fill="#FFFFFF" opacity=".5"/><path d="M0 150 L260 150 L240 180 L20 180Z" ' + F("b", "#3A3A46") + '/></symbol>',
    '<symbol id="kit-phone" viewBox="0 0 120 220"><rect x="0" y="0" width="120" height="220" rx="20" ' + F("d", "#1E1E26") + '/><rect x="8" y="16" width="104" height="188" rx="12" ' + F("c", "#7C5CFF") + '/><rect x="20" y="40" width="80" height="60" rx="8" fill="#FFFFFF" opacity=".8"/><rect x="20" y="112" width="64" height="10" rx="5" fill="#FFFFFF" opacity=".6"/><rect x="20" y="130" width="80" height="10" rx="5" fill="#FFFFFF" opacity=".45"/></symbol>',
    '<symbol id="kit-cup" viewBox="0 0 90 100"><path d="M6 30 L70 30 L64 96 L12 96Z" ' + F("a", "#F4F1EA") + '/><path d="M44 30 L70 30 L64 96 L40 96Z" ' + F("b", "#DAD5CA") + '/><path d="M70 44 Q90 46 86 64 Q82 78 66 76" fill="none" stroke="#DAD5CA" stroke-width="8"/><rect x="6" y="30" width="64" height="10" ' + F("d", "#6B3E26") + '/><path d="M30 20 Q24 10 32 2 M46 22 Q40 12 48 4" fill="none" stroke="#FFFFFF" stroke-width="4" opacity=".6"/></symbol>',
    '<symbol id="kit-plant" viewBox="0 0 140 220"><path d="M30 150 L110 150 L100 220 L40 220Z" ' + F("d", "#B5523B") + '/><path d="M70 150 Q40 90 10 80 Q40 120 62 150Z" ' + F("a", "#5E8C4A") + '/><path d="M70 150 Q100 70 134 56 Q104 110 80 150Z" ' + F("b", "#46713A") + '/><path d="M70 150 Q66 60 74 10 Q86 70 78 150Z" ' + F("c", "#86B061") + '/></symbol>',
    '<symbol id="kit-window" viewBox="0 0 320 400"><rect x="0" y="0" width="320" height="400" ' + F("d", "#FFFFFF") + '/><rect x="16" y="16" width="288" height="368" ' + F("c", "#9BD6F6") + '/><circle cx="220" cy="110" r="40" ' + F("a", "#FFFFFF") + ' opacity=".7"/><rect x="152" y="16" width="16" height="368" ' + F("d", "#FFFFFF") + '/><rect x="16" y="192" width="288" height="16" ' + F("d", "#FFFFFF") + '/></symbol>',
    '<symbol id="kit-door" viewBox="0 0 220 440"><rect x="0" y="0" width="220" height="440" ' + F("b", "#8A6244") + '/><rect x="14" y="14" width="192" height="426" ' + F("a", "#A87B55") + '/><rect x="36" y="40" width="148" height="150" rx="6" ' + F("b", "#8A6244") + '/><rect x="36" y="230" width="148" height="180" rx="6" ' + F("b", "#8A6244") + '/><circle cx="178" cy="226" r="10" ' + F("c", "#FFD56B") + '/></symbol>',
    '<symbol id="kit-sofa" viewBox="0 0 520 240"><rect x="40" y="20" width="440" height="120" rx="30" ' + F("b", "#4E5FA8") + '/><rect x="0" y="100" width="520" height="110" rx="28" ' + F("a", "#6274C4") + '/><rect x="60" y="110" width="190" height="60" rx="18" ' + F("c", "#8191D8") + '/><rect x="270" y="110" width="190" height="60" rx="18" ' + F("c", "#8191D8") + '/><rect x="40" y="206" width="20" height="34" ' + F("d", "#2B2B33") + '/><rect x="460" y="206" width="20" height="34" ' + F("d", "#2B2B33") + '/></symbol>',
    '<symbol id="kit-wave" viewBox="0 0 1080 140"><path d="M0 50 Q90 0 180 50 T360 50 T540 50 T720 50 T900 50 T1080 50 L1080 140 L0 140Z" ' + F("a", "#3C7FB0") + '/><path d="M0 50 Q90 0 180 50 T360 50 T540 50 T720 50 T900 50 T1080 50" fill="none" ' + "style=\"stroke:var(--c,#CDEBFF)\"" + ' stroke-width="10" stroke-linecap="round"/></symbol>',
    '<symbol id="kit-rock" viewBox="0 0 200 120"><path d="M10 120 L30 50 L90 14 L160 30 L194 120Z" ' + F("a", "#8D8A99") + '/><path d="M90 14 L160 30 L194 120 L110 120Z" ' + F("b", "#6E6B7B") + '/><path d="M30 50 L90 14 L80 50Z" ' + F("c", "#B3B0BE") + '/></symbol>',
    '<symbol id="kit-bird" viewBox="0 0 80 40"><path d="M0 20 Q20 0 40 20 Q60 0 80 20 Q60 10 40 28 Q20 10 0 20Z" ' + F("d", "#2B2B33") + '/></symbol>',
    '<symbol id="kit-star" viewBox="0 0 40 40"><path d="M20 0 L25 15 L40 20 L25 25 L20 40 L15 25 L0 20 L15 15Z" ' + F("c", "#FFF4C2") + '/></symbol>',
    '<symbol id="kit-shelf" viewBox="0 0 420 300"><rect x="0" y="0" width="420" height="300" ' + F("b", "#8A6244") + '/><rect x="12" y="12" width="396" height="130" ' + F("d", "#5C4030") + '/><rect x="12" y="158" width="396" height="130" ' + F("d", "#5C4030") + '/>' +
      (function () { var s = "", c = ["#B5523B", "#3F6E52", "#E7B85C", "#4E5FA8", "#C9502E", "#7C5CFF"]; for (var r = 0; r < 2; r++) for (var i = 0; i < 9; i++) { var h = 90 + ((i * 37 + r * 11) % 30); s += '<rect x="' + (22 + i * 42) + '" y="' + (142 + r * 146 - h) + '" width="34" height="' + h + '" fill="' + c[(i + r * 2) % c.length] + '"/>'; } return s; })() + "</symbol>",
  ].join("");

  /* ------------------------------------------------------------------ textures (generated once) */
  function noiseCanvas(w, h, seed, fn) {
    var c = document.createElement("canvas"); c.width = w; c.height = h;
    var x = c.getContext("2d"), img = x.createImageData(w, h), r = rng(seed);
    for (var i = 0; i < w * h; i++) { var v = fn(r, i % w, Math.floor(i / w)); img.data[i * 4] = v[0]; img.data[i * 4 + 1] = v[1]; img.data[i * 4 + 2] = v[2]; img.data[i * 4 + 3] = v[3]; }
    x.putImageData(img, 0, 0);
    return c;
  }
  var TEX = {};
  function texture(kind, W, H) {
    if (TEX[kind]) return TEX[kind];
    var w = Math.round(W / 2), h = Math.round(H / 2), c;
    if (kind === "paper" || kind === "wash") {
      c = noiseCanvas(w, h, 11, function (r, x, y) { var n = r(), fib = hash(Math.floor(x / 3) * 3.1 + Math.floor(y / 11) * 7.7); var v = 255 - n * 34 - fib * 16; return [v, v - 3, v - 10, 255]; });
      if (kind === "wash") {
        // Pigment pooling: a few big soft stains over the grain.
        var cx = c.getContext("2d"), blot = document.createElement("canvas"); blot.width = 18; blot.height = 32;
        var bx2 = blot.getContext("2d"), br2 = rng(5);
        for (var yy2 = 0; yy2 < 32; yy2++) for (var xx2 = 0; xx2 < 18; xx2++) { var g2 = Math.round(255 - br2() * 70); bx2.fillStyle = "rgb(" + g2 + "," + (g2 - 2) + "," + (g2 - 8) + ")"; bx2.fillRect(xx2, yy2, 1, 1); }
        cx.globalCompositeOperation = "multiply"; cx.imageSmoothingEnabled = true; cx.imageSmoothingQuality = "high"; cx.drawImage(blot, 0, 0, w, h); cx.globalCompositeOperation = "source-over";
      }
    } else if (kind === "crayon") {
      c = noiseCanvas(w, h, 23, function (r, x, y) { var n = r(), s = hash(Math.floor(y / 2) * 7.3 + Math.floor(x / 9)); var v = 255 - (n > 0.62 ? 110 : 0) - s * 50; return [v, v - 3, v - 8, 255]; });
    } else if (kind === "canvas") {
      c = noiseCanvas(w, h, 31, function (r, x, y) { var weave = ((x % 6 < 3) ^ (y % 6 < 3)) ? 14 : 0; var v = 250 - weave - r() * 22; return [v, v - 6, v - 16, 255]; });
    } else if (kind === "brush") {
      c = document.createElement("canvas"); c.width = w; c.height = h;
      var bx = c.getContext("2d"), br = rng(41);
      bx.fillStyle = "#808080"; bx.fillRect(0, 0, w, h);
      for (var i = 0; i < 2600; i++) {
        var px = br() * w, py = br() * h, a = (Math.sin(px * 0.01) + Math.cos(py * 0.013)) * 1.2 + br() * 0.6, len = 12 + br() * 30;
        bx.strokeStyle = br() > 0.5 ? "rgba(255,255,255,.22)" : "rgba(0,0,0,.2)"; bx.lineWidth = 2 + br() * 5; bx.lineCap = "round";
        bx.beginPath(); bx.moveTo(px, py); bx.lineTo(px + Math.cos(a) * len, py + Math.sin(a) * len); bx.stroke();
      }
    } else if (kind === "halftone") {
      c = document.createElement("canvas"); c.width = w; c.height = h;
      var hx = c.getContext("2d"); hx.fillStyle = "#FFFFFF"; hx.fillRect(0, 0, w, h); hx.fillStyle = "#000";
      for (var yy = 0; yy < h; yy += 9) for (var xx = (yy / 9) % 2 ? 4.5 : 0; xx < w; xx += 9) { var rr = 1.1 + 1.3 * (0.5 + 0.5 * Math.sin(xx * 0.004 + yy * 0.003)); hx.beginPath(); hx.arc(xx, yy, rr, 0, Math.PI * 2); hx.fill(); }
    } else if (/^grain/.test(kind)) {
      var seed = +kind.slice(5) || 1;
      c = noiseCanvas(Math.round(w / 2), Math.round(h / 2), 97 + seed * 13, function (r) { var v = r() * 255; return [v, v, v, 255]; });
    }
    TEX[kind] = c;
    return c;
  }

  /* ------------------------------------------------------------------ SVG rasterising */
  var PARSER = typeof DOMParser !== "undefined" ? new DOMParser() : null;
  var holder = null;
  function holderEl() {
    if (holder) return holder;
    holder = document.createElement("div");
    holder.style.cssText = "position:absolute;left:-99999px;top:0;width:1px;height:1px;overflow:hidden;opacity:0;pointer-events:none";
    document.body.appendChild(holder);
    return holder;
  }
  /** An <img> in the document, so the page load waits for it before the first frame. */
  function svgImage(svgText) {
    var img = document.createElement("img");
    img.decoding = "sync";
    img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svgText);
    holderEl().appendChild(img);
    if (img.decode) img.decode().catch(function () {});
    return img;
  }
  function paletteStyle() { return ""; }
  function boilDefs(look, seed) {
    if (!look.boil) return "";
    return '<filter id="crsBoil" x="-5%" y="-5%" width="110%" height="110%"><feTurbulence type="fractalNoise" baseFrequency="' + (look.boilFreq || 0.015) + '" numOctaves="2" seed="' + seed + '"/>' +
      '<feDisplacementMap in="SourceGraphic" scale="' + look.boil + '" xChannelSelector="R" yChannelSelector="G"/></filter>';
  }
  /** Splits a set into depth layers (top-level <g data-depth>), each rasterised with N boil variants. */
  function rasterSet(svg, look, scale) {
    var doc = PARSER.parseFromString(svg, "image/svg+xml"), root = doc.documentElement;
    var vb = (root.getAttribute("viewBox") || "0 0 1080 1920").split(/[\s,]+/).map(Number);
    var vw = vb[2] || 1080, vh = vb[3] || 1920;
    var defs = "", runs = [], cur = null;
    Array.prototype.forEach.call(root.childNodes, function (n) {
      if (n.nodeType !== 1) return;
      var markup = new XMLSerializer().serializeToString(n);
      if (n.nodeName === "defs") { defs += markup; return; }
      var depth = n.getAttribute && n.getAttribute("data-depth");
      var d = depth == null || depth === "" ? null : clamp(+depth || 0, 0, 2);
      if (!cur || (d != null && d !== cur.depth) || (d == null && cur.explicit)) { cur = { depth: d == null ? 1 : d, explicit: d != null, parts: [] }; runs.push(cur); }
      cur.parts.push(markup);
    });
    var variants = look.boil ? 3 : 1;
    return {
      w: vw, h: vh,
      layers: runs.map(function (run, li) {
        var imgs = [];
        for (var v = 0; v < variants; v++) {
          var text = '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 ' + vw + " " + vh + '" width="' + Math.round(vw * scale) + '" height="' + Math.round(vh * scale) + '">' +
            paletteStyle(look) + "<defs>" + KIT + boilDefs(look, 3 + v * 17 + li * 5) + "</defs>" + defs +
            (look.boil ? '<g filter="url(#crsBoil)">' : "<g>") + run.parts.join("") + "</g></svg>";
          imgs.push(svgImage(text));
        }
        return { depth: run.depth, imgs: imgs };
      }),
    };
  }
  function rasterProp(svg, look, scale) {
    var doc = PARSER.parseFromString(svg, "image/svg+xml"), root = doc.documentElement;
    var vb = (root.getAttribute("viewBox") || "0 0 200 200").split(/[\s,]+/).map(Number);
    var vw = vb[2] || 200, vh = vb[3] || 200, inner = "";
    Array.prototype.forEach.call(root.childNodes, function (n) { if (n.nodeType === 1) inner += new XMLSerializer().serializeToString(n); });
    var variants = look.boil ? 3 : 1, imgs = [];
    for (var v = 0; v < variants; v++)
      imgs.push(svgImage('<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 ' + vw + " " + vh + '" width="' + Math.round(vw * scale) + '" height="' + Math.round(vh * scale) + '">' +
        paletteStyle(look) + "<defs>" + KIT + boilDefs(look, 7 + v * 23) + "</defs>" + (look.boil ? '<g filter="url(#crsBoil)">' : "<g>") + inner + "</g></svg>"));
    return { w: vw, h: vh, imgs: imgs };
  }

  /* ------------------------------------------------------------------ camera */
  var SIZE = { s: 3.5, m: 5.5, l: 7.5, xl: 10.5 };
  var BODY = 86; // sprite rows from feet to the top of the head
  function camAt(shot, set, p, W, H) {
    var sw = set.w * (H / set.h), sh = H, k = H / set.h;
    var c = shot.camera || {}, move = c.move || "wide";
    var castX = 0, castY = 0, n = 0, tall = 0;
    (shot.cast || []).forEach(function (a) { castX += a.x * k; castY += a.y * k; tall = Math.max(tall, (SIZE[a.size] || SIZE.m) * BODY * k); n++; });
    var fx = c.focus ? c.focus[0] * k : n ? castX / n : sw / 2;
    var fy = c.focus ? c.focus[1] * k : n ? castY / n - tall * (move === "close" ? 0.72 : 0.42) : sh * 0.55;
    var e = inOut(clamp(p, 0, 1)), z = 1, x = fx, y = fy, rot = 0;
    var zIn = c.zoom || 0;
    switch (move) {
      case "medium": z = lerp(1.32, 1.4, e); break;
      case "close": z = lerp(1.9, 2.02, e); break;
      case "push-in": z = lerp(1, 1.55, e); break;
      case "pull-out": z = lerp(1.6, 1, e); break;
      case "pan-left": z = sw > W * 1.15 ? 1 : 1.3; x = lerp(sw, 0, e); break;
      case "pan-right": z = sw > W * 1.15 ? 1 : 1.3; x = lerp(0, sw, e); break;
      case "tilt-up": z = 1.35; y = lerp(sh, 0, e); break;
      case "tilt-down": z = 1.35; y = lerp(0, sh, e); break;
      case "dutch": z = lerp(1.3, 1.38, e); rot = lerp(-5, -7, e); break;
      case "shake": z = 1.3; break;
      case "orbit": z = lerp(1.25, 1.4, e); x = fx + Math.sin(e * Math.PI) * 80; rot = lerp(-2, 2, e); break;
      default: z = lerp(1, 1.06, e); x = fx; y = sh / 2;
    }
    if (zIn) z = Math.max(z, zIn);
    var vw = W / z, vh = H / z;
    x = sw <= vw ? sw / 2 : clamp(x, vw / 2, sw - vw / 2);
    y = sh <= vh ? sh / 2 : clamp(y, vh / 2, sh - vh / 2);
    return { x: x, y: y, z: z, rot: rot, sw: sw, sh: sh, k: k, move: move };
  }

  /* ------------------------------------------------------------------ props motion */
  function propMotion(kind, t, seed) {
    var o = { dx: 0, dy: 0, rot: 0, s: 1, a: 1 }, ph = seed * 1.7;
    switch (kind) {
      case "bob": o.dy = Math.sin(t * 2.2 + ph) * 14; o.rot = Math.sin(t * 1.6 + ph) * 3; break;
      case "sway": o.rot = Math.sin(t * 1.4 + ph) * 6; break;
      case "drift": o.dx = ((t * 40 + seed * 300) % 1400) - 300; break;
      case "drift-left": o.dx = -(((t * 50 + seed * 300) % 1600) - 300); break;
      case "spin": o.rot = (t * 90 + seed * 40) % 360; break;
      case "pulse": o.s = 1 + Math.sin(t * 5 + ph) * 0.06; break;
      case "fly-left": o.dx = -t * 220; o.dy = Math.sin(t * 6 + ph) * 10; break;
      case "fly-right": o.dx = t * 220; o.dy = Math.sin(t * 6 + ph) * 10; break;
      case "rise": o.dy = -t * 120; break;
      case "fall": o.dy = t * 260; o.rot = t * 40; break;
      case "shake": o.dx = Math.sin(t * 50) * 6; o.rot = Math.sin(t * 43) * 2; break;
      case "grow": o.s = Math.min(1, 0.2 + t * 1.6); break;
      case "blink": o.a = 0.55 + 0.45 * Math.max(0, Math.sin(t * 3 + ph)); break;
    }
    return o;
  }

  /* ------------------------------------------------------------------ weather / particles */
  function drawFx(ctx, kind, t, W, H, look, seed) {
    var r = rng(seed * 31 + 7), i, n;
    ctx.save();
    if (kind === "rain") {
      ctx.strokeStyle = "rgba(200,220,255,.55)"; ctx.lineWidth = 3;
      for (i = 0; i < 160; i++) { var x0 = r() * (W + 300), sp = 1600 + r() * 900, y0 = ((r() * H + t * sp) % (H + 200)) - 100; ctx.beginPath(); ctx.moveTo(x0 - y0 * 0.18, y0); ctx.lineTo(x0 - y0 * 0.18 - 10, y0 + 46); ctx.stroke(); }
    } else if (kind === "snow") {
      ctx.fillStyle = "rgba(255,255,255,.9)";
      for (i = 0; i < 140; i++) { var sx = (r() * W + Math.sin(t * 0.8 + i) * 30), sy = (r() * H + t * (80 + r() * 90)) % H; ctx.beginPath(); ctx.arc(sx, sy, 3 + r() * 6, 0, 6.29); ctx.fill(); }
    } else if (kind === "dust" || kind === "fireflies") {
      for (i = 0; i < (kind === "dust" ? 70 : 40); i++) {
        var dx = (r() * W + Math.sin(t * 0.5 + i * 2) * 60), dy = (r() * H - t * (10 + r() * 30) + H) % H, a = 0.25 + 0.5 * Math.max(0, Math.sin(t * 2 + i));
        ctx.fillStyle = kind === "dust" ? "rgba(255,248,220," + a * 0.6 + ")" : "rgba(255,236,120," + a + ")";
        if (kind === "fireflies") { ctx.shadowColor = "#FFE878"; ctx.shadowBlur = 18; }
        ctx.beginPath(); ctx.arc(dx, dy, kind === "dust" ? 2 + r() * 3 : 5 + r() * 4, 0, 6.29); ctx.fill();
      }
    } else if (kind === "stars") {
      for (i = 0; i < 90; i++) { var a2 = 0.3 + 0.7 * Math.abs(Math.sin(t * (0.6 + r()) + i)); ctx.fillStyle = "rgba(255,250,220," + a2 + ")"; ctx.fillRect(r() * W, r() * H * 0.55, 3 + r() * 3, 3 + r() * 3); }
    } else if (kind === "confetti" || kind === "sparks" || kind === "leaves") {
      var cols = kind === "leaves" ? ["#D9822B", "#C9502E", "#E7B85C", "#8A9A3B"] : kind === "sparks" ? ["#FFF3B0", "#FFD23F", "#FFFFFF"] : (look.palette && look.palette.length ? look.palette : ["#FF5A5F", "#FFD23F", "#3EC1D3", "#7C5CFF"]);
      n = kind === "sparks" ? 50 : 90;
      for (i = 0; i < n; i++) {
        var cx = r() * W + Math.sin(t * 1.3 + i) * 50, cy = kind === "sparks" ? H * 0.6 - ((t * (300 + r() * 400) + r() * H) % (H * 0.8)) : ((t * (160 + r() * 200) + r() * H) % (H + 100)) - 50;
        ctx.save(); ctx.translate(cx, cy); ctx.rotate(t * (2 + r() * 4) + i); ctx.fillStyle = cols[i % cols.length];
        if (kind === "leaves") { ctx.beginPath(); ctx.ellipse(0, 0, 16, 8, 0, 0, 6.29); ctx.fill(); }
        else if (kind === "sparks") { ctx.globalAlpha = 0.8; ctx.fillRect(-3, -3, 6, 6); }
        else ctx.fillRect(-9, -5, 18, 10);
        ctx.restore();
      }
    } else if (kind === "smoke") {
      for (i = 0; i < 26; i++) { var life = (t * 0.25 + r()) % 1, sx2 = W * (0.2 + r() * 0.6) + Math.sin(life * 6 + i) * 60, sy2 = H * 0.85 - life * H * 0.7; ctx.fillStyle = "rgba(220,220,230," + (0.18 * (1 - life)) + ")"; ctx.beginPath(); ctx.arc(sx2, sy2, 60 + life * 160, 0, 6.29); ctx.fill(); }
    } else if (kind === "light-rays") {
      ctx.globalCompositeOperation = "lighter";
      for (i = 0; i < 6; i++) { var ang = -0.5 + i * 0.18 + Math.sin(t * 0.4 + i) * 0.03; ctx.fillStyle = "rgba(255,240,200,.07)"; ctx.beginPath(); ctx.moveTo(W * 0.15, -50); ctx.lineTo(W * 0.15 + Math.cos(ang) * 2600 - 90, Math.sin(ang + 1.6) * 2600); ctx.lineTo(W * 0.15 + Math.cos(ang) * 2600 + 90, Math.sin(ang + 1.6) * 2600); ctx.closePath(); ctx.fill(); }
    } else if (kind === "speed-lines") {
      ctx.strokeStyle = "rgba(255,255,255,.55)";
      for (i = 0; i < 46; i++) { var aa = r() * Math.PI * 2, r0 = 380 + r() * 300 + ((t * 900 + r() * 400) % 300); ctx.lineWidth = 2 + r() * 5; ctx.beginPath(); ctx.moveTo(W / 2 + Math.cos(aa) * r0, H / 2 + Math.sin(aa) * r0); ctx.lineTo(W / 2 + Math.cos(aa) * (r0 + 260), H / 2 + Math.sin(aa) * (r0 + 260)); ctx.stroke(); }
    }
    ctx.restore();
  }

  /* ------------------------------------------------------------------ the film */
  var CRS = { looks: LOOKS, kit: KIT };

  CRS.resolveLook = function (spec) {
    spec = spec || {};
    var base = LOOKS[spec.preset] || LOOKS.vetor, look = {};
    for (var key in base) look[key] = base[key];
    look.preset = LOOKS[spec.preset] ? spec.preset : "vetor";
    look.palette = (spec.palette || []).filter(function (c) { return /^#[0-9a-f]{3,6}$/i.test(c); });
    look.paperColor = /^#[0-9a-f]{6}$/i.test(spec.paper || "") ? spec.paper : null;
    look.inkColor = /^#[0-9a-f]{6}$/i.test(spec.ink || "") ? spec.ink : "#1B1A22";
    look.accent = /^#[0-9a-f]{6}$/i.test(spec.accent || "") ? spec.accent : look.palette[2] || "#FFD23F";
    if (typeof spec.boil === "number") look.boil = clamp(spec.boil, 0, 16);
    if (typeof spec.grain === "number") look.grain = clamp(spec.grain, 0, 0.4);
    if (typeof spec.pixel === "number" && look.preset === "pixel") look.block = clamp(Math.round(spec.pixel), 3, 12);
    return look;
  };

  /** Maps shots to the spoken words (each shot's `say`, in order). */
  CRS.timeShots = function (shots, words, D) {
    var counts = shots.map(function (s) { return String(s.say || "").split(/\s+/).filter(function (w) { return nrm(w); }).length; });
    var total = counts.reduce(function (a, b) { return a + b; }, 0), offset = 0, cum = 0;
    return shots.map(function (shot, i) {
      var seg = [];
      if (words.length && total) {
        cum += counts[i];
        var end = words.length === total ? offset + counts[i] : Math.round(words.length * cum / total);
        end = Math.min(words.length, Math.max(offset + (counts[i] ? 1 : 0), end));
        seg = words.slice(offset, end); offset = end;
      }
      return { words: seg };
    }).map(function (x, i, all) {
      var start = i === 0 ? 0 : x.words.length ? Math.max(0, x.words[0].start - 0.12) : null;
      return { words: x.words, start: start };
    }).map(function (x, i, all) {
      if (x.start == null) { var prev = all[i - 1]; x.start = prev ? prev.start + Math.max(0.6, (D - prev.start) / (all.length - i + 1)) : 0; }
      return x;
    }).map(function (x, i, all) {
      var end = i === all.length - 1 ? D : Math.max(x.start + 0.4, all[i + 1].start);
      return { words: x.words, start: x.start, end: end };
    });
  };

  CRS.film = function (o) {
    var tl = o.tl, root = document.querySelector(o.film || "#film"), D = o.duration, plan = o.plan || {};
    var W = +root.getAttribute("data-width") || 1080, H = +root.getAttribute("data-height") || 1920;
    var look = CRS.resolveLook(plan.look);
    var shots = (plan.shots || []).filter(function (s) { return s && plan.sets && plan.sets.some(function (x) { return x.id === s.set; }); });
    if (!shots.length) throw new Error("CRS.film: o plano não tem tomadas com cenário.");
    var timing = CRS.timeShots(shots, T.words || [], D);
    shots.forEach(function (s, i) { s.start = timing[i].start; s.end = timing[i].end; s.words = timing[i].words; });
    var scaleSet = look.block ? 1 : look.boil ? 1.2 : 1.6;
    var SETS = {}, PROPS = {};
    (plan.sets || []).forEach(function (s) { SETS[s.id] = rasterSet(s.svg, look, scaleSet); });
    (plan.props || []).forEach(function (p) { PROPS[p.id] = rasterProp(p.svg, look, 2); });
    // Real brand material (screenshots, photos): shown as a card floating in the shot.
    var PROOFS = {};
    var proofFiles = o.proofs || {};
    Object.keys(proofFiles).forEach(function (id) {
      PROOFS[id] = (proofFiles[id] || []).slice(0, 4).map(function (file) {
        var img = document.createElement("img"); img.decoding = "sync"; img.src = file; holderEl().appendChild(img); return img;
      });
    });

    var ink = look.inkColor, accent = look.accent, font = FONTS[look.font] || FONTS.Fredoka;
    root.style.background = look.paperColor || "#141318";

    // DOM: display canvas, text layer, flash.
    var css = document.createElement("style");
    css.textContent =
      "#crs-view{position:absolute;left:0;top:0;width:" + W + "px;height:" + H + "px}" +
      ".crs-t{position:absolute;z-index:30;visibility:hidden;opacity:0}" +
      ".crs-cap{left:70px;right:70px;bottom:" + Math.round(H * 0.16) + "px;text-align:center;font:" + (look.text === "pixel" ? "400 54px/1.3" : look.text === "hand" ? "700 84px/1.05" : look.text === "comic" ? "400 82px/1.05" : look.text === "serif" ? "400 86px/1.02" : "600 74px/1.08") + " " + font + ";color:#fff;" +
        (look.text === "neon" ? "text-shadow:0 0 18px " + accent + ",0 0 40px " + accent + ";" : look.text === "pixel" ? "text-shadow:4px 4px 0 " + ink + ";" : "text-shadow:0 6px 0 rgba(0,0,0,.45), 0 0 26px rgba(0,0,0,.45);") + (look.text === "comic" ? "text-transform:uppercase;letter-spacing:1px;-webkit-text-stroke:3px " + ink + ";paint-order:stroke fill;" : "") + "}" +
      ".crs-cap .w{display:inline-block;opacity:0}.crs-cap .w.key{color:" + accent + "}" +
      ".crs-cap .w{padding:" + (look.text === "pixel" ? ".16em .2em" : ".06em .17em") + ";margin:0;line-height:1.45;" +
        (look.text === "pixel" ? "background:" + ink + "E6;box-shadow:0 0 0 6px " + ink + "E6;" : look.text === "clean" || look.text === "neon" ? "background:rgba(10,10,20,.55);border-radius:18px;" : look.text === "comic" ? "background:#FFF6D6;color:" + ink + ";border:5px solid " + ink + ";text-shadow:none;-webkit-text-stroke:0;" : "background:rgba(255,253,246,.88);color:" + ink + ";border-radius:14px;text-shadow:none;") + "}" +
      ".crs-bub{max-width:" + (W - 160) + "px;padding:" + (look.text === "pixel" ? "26px 30px" : "28px 40px") + ";background:#FFFDF6;color:" + ink + ";font:" + (look.text === "pixel" ? "400 40px/1.35" : look.text === "hand" ? "700 64px/1.05" : look.text === "serif" ? "400 64px/1.05" : look.text === "comic" ? "400 60px/1.08" : "600 56px/1.12") + " " + font + ";" +
        (look.text === "pixel" ? "border:6px solid " + ink + ";box-shadow:8px 8px 0 " + ink + ";border-radius:0;" : look.text === "comic" ? "border:7px solid " + ink + ";border-radius:46% 54% 50% 50% / 60% 55% 45% 40%;text-transform:uppercase;" : "border:5px solid " + ink + ";border-radius:38px;box-shadow:0 12px 0 rgba(0,0,0,.18);") + "}" +
      ".crs-bub b{display:block;margin-bottom:8px;font-size:.55em;letter-spacing:2px;text-transform:uppercase;color:" + (look.palette[0] || accent) + "}" +
      ".crs-bub .w{display:inline-block}.crs-bub .w.on{color:" + ink + "}.crs-bub .w{color:" + ink + "99}" +
      ".crs-bub::after{content:'';position:absolute;bottom:-38px;left:var(--tail,90px);border:20px solid transparent;border-top:26px solid " + ink + "}" +
      ".crs-title{left:60px;right:60px;top:" + Math.round(H * 0.2) + "px;text-align:center;color:#fff;font:" + (look.text === "pixel" ? "400 92px/1.15" : look.text === "hand" ? "700 150px/.95" : look.text === "serif" ? "400 150px/.95" : "400 140px/.98") + " " + (look.text === "clean" || look.text === "neon" || look.text === "comic" ? FONTS.Anton : font) + ";text-transform:" + (look.text === "serif" || look.text === "hand" ? "none" : "uppercase") + ";" +
        (look.text === "pixel" ? "text-shadow:6px 6px 0 " + ink + ";" : look.text === "neon" ? "text-shadow:0 0 20px " + accent + ",0 0 60px " + accent + ";" : "text-shadow:0 10px 0 rgba(0,0,0,.35);") + "}" +
      ".crs-title small{display:block;font-size:.36em;letter-spacing:4px;margin-bottom:22px;color:" + accent + "}" +
      ".crs-sign{left:80px;right:80px;top:" + Math.round(H * 0.1) + "px;text-align:center;padding:22px 30px;background:" + accent + ";color:" + ink + ";font:" + (look.text === "pixel" ? "400 50px/1.25" : "400 70px/1.05") + " " + (look.text === "pixel" ? font : FONTS.Anton) + ";text-transform:uppercase;transform:rotate(-1.5deg);border:6px solid " + ink + "}" +
      ".crs-flash{position:absolute;inset:0;background:#fff;z-index:40;visibility:hidden;opacity:0}";
    document.head.appendChild(css);
    var view = document.createElement("canvas"); view.id = "crs-view"; view.width = W; view.height = H; root.appendChild(view);
    var vx = view.getContext("2d");
    var work = document.createElement("canvas"); work.width = W; work.height = H; var wx = work.getContext("2d");
    var prevC = document.createElement("canvas"); prevC.width = W; prevC.height = H; var px = prevC.getContext("2d");
    var block = look.block || 0, small = null, sx = null, softC = null, softX = null;
    if (block) { small = document.createElement("canvas"); small.width = Math.ceil(W / block); small.height = Math.ceil(H / block); sx = small.getContext("2d", { willReadFrequently: true }); }
    var quant = block && look.quantize ? (look.palette.length ? look.palette : []).concat([ink, "#FFFFFF", "#0E0D12"]).map(hexRgb) : null;

    // Cast: one CRM.avatar per name, acting per shot.
    var CAST = {};
    var names = [];
    shots.forEach(function (s) { (s.cast || []).forEach(function (c) { if (names.indexOf(c.who) < 0) names.push(c.who); }); });
    var presenter = plan.presenter || null;
    function speaker(t) { for (var i = 0; i < shots.length; i++) if (t >= shots[i].start && t < shots[i].end) { var w = shots[i].who; return w && !/^narrador/i.test(w) ? w : presenter; } return null; }
    function talking(name) {
      return function (t) {
        if (speaker(t) !== name) return false;
        var ws = T.words || [];
        for (var i = 0; i < ws.length; i++) if (t >= ws[i].start - 0.05 && t <= ws[i].end + 0.12) return true;
        return false;
      };
    }
    names.forEach(function (name, i) {
      var pkg = (o.cast && o.cast[name]) || (o.fallback && o.fallback[i % o.fallback.length]);
      if (!pkg || !o.engine || !window.CRM || !CRM.avatar) return;
      var A = CRM.avatar({ engine: o.engine, avatar: pkg, outline: look.outline === "accent" ? accent : ink, speaks: talking(name) });
      A.glow = false; A.shadow = true;
      CAST[name] = A;
    });
    shots.forEach(function (s, si) {
      var acted = {};
      (s.cast || []).forEach(function (c) {
        var A = CAST[c.who]; if (!A || acted[c.who]) return; acted[c.who] = 1;
        A.act(s.start, c.pose || (speaker(s.start + 0.01) === c.who ? "explaining" : "neutral"), c.expression || "neutral");
        if (speaker(s.start + 0.01) === c.who && !c.pose) A.talk(s.start, s.end, ["explaining", "neutral", "pointing"]);
        if (c.enter) A.enter(s.start + 0.05, c.enter);
        if (c.hop) A.hop(s.start + 0.15, 20);
      });
    });

    // Text per shot: dialogue bubbles, titles, signs; captions follow the words.
    var lastTitleAt = -1;
    shots.forEach(function (s, si) {
      var t0 = s.start, t1 = s.end;
      if (s.text && s.text.content) {
        var el = document.createElement("div");
        el.className = "crs-t " + (s.text.kind === "sign" ? "crs-sign" : "crs-title");
        el.innerHTML = s.text.kind === "title" && s.text.kicker ? "<small>" + esc(s.text.kicker) + "</small>" + esc(s.text.content) : esc(s.text.content);
        root.appendChild(el);
        if (window.CRM && CRM.popIn && s.text.kind !== "sign") CRM.popIn(tl, el, t0 + 0.05, { rot: -3 });
        else tl.fromTo(el, { autoAlpha: 0, y: -30 }, { autoAlpha: 1, y: 0, duration: 0.3, ease: "back.out(2)" }, t0 + 0.05);
        tl.to(el, { autoAlpha: 0, duration: 0.15 }, Math.max(t0 + 0.4, t1 - 0.15));
        lastTitleAt = si;
      }
      var who = s.who && !/^narrador/i.test(s.who) ? s.who : null;
      if (who && s.words.length && o.bubbles !== false) {
        var b = document.createElement("div"); b.className = "crs-t crs-bub";
        b.innerHTML = "<b>" + esc(who) + "</b><span>" + s.words.map(function (w) { return '<i class="w">' + esc(w.text) + "</i>"; }).join(" ") + "</span>";
        var c = (s.cast || []).filter(function (x) { return x.who === who; })[0];
        var set = SETS[s.set], k = H / set.h;
        var cam = camAt(s, set, 0.5, W, H);
        var screenX = c ? (c.x * k - cam.x) * cam.z + W / 2 : W / 2;
        var headY = c ? ((c.y - (SIZE[c.size] || SIZE.m) * BODY) * k - cam.y) * cam.z + H / 2 : H * 0.4;
        var top = Math.round(clamp(headY - 330, H * 0.05, H * 0.42));
        var left = clamp(screenX - 300, 50, W - 50 - Math.min(W - 160, 820));
        b.style.left = left + "px"; b.style.top = top + "px"; b.style.setProperty("--tail", clamp(screenX - left - 20, 60, 700) + "px");
        root.appendChild(b);
        tl.fromTo(b, { autoAlpha: 0, scale: 0.5, y: 30 }, { autoAlpha: 1, scale: 1, y: 0, duration: 0.28, ease: "back.out(2.2)" }, t0 + 0.02);
        var ws = b.querySelectorAll(".w");
        s.words.forEach(function (w, wi) { tl.set(ws[wi], { className: "w on" }, Math.max(t0, w.start - 0.03)); });
        tl.to(b, { autoAlpha: 0, duration: 0.12 }, Math.max(t0 + 0.3, t1 - 0.12));
      }
    });
    if (o.captions) {
      // Word-timed captions in groups of up to 4 words, for narration (not over dialogue bubbles).
      var groups = [];
      shots.forEach(function (s) {
        if (s.who && !/^narrador/i.test(s.who)) return;
        if (s.text && s.text.content && s.text.kind !== "sign") return;
        for (var i = 0; i < s.words.length; i += 4) groups.push(s.words.slice(i, i + 4));
      });
      groups.forEach(function (g, gi) {
        var el = document.createElement("div"); el.className = "crs-t crs-cap";
        el.innerHTML = g.map(function (w) { var key = /^[A-ZÁÉÍÓÚÂÊÔÃÕÇ0-9]/.test(w.text) && w.text.length > 3 || /\d/.test(w.text); return '<i class="w' + (key ? " key" : "") + '">' + esc(w.text) + "</i>"; }).join("");
        root.appendChild(el);
        var start = Math.max(0, g[0].start - 0.06), next = Math.min(g[g.length - 1].end + 0.45, groups[gi + 1] ? Math.max(start + 0.2, groups[gi + 1][0].start - 0.06) : D);
        tl.set(el, { autoAlpha: 1 }, start);
        var ws = el.querySelectorAll(".w");
        g.forEach(function (w, wi) { tl.fromTo(ws[wi], { opacity: 0, y: 18 }, { opacity: 1, y: 0, duration: 0.12, ease: "power2.out" }, Math.max(start, w.start - 0.04)); });
        tl.set(el, { autoAlpha: 0 }, next);
      });
    }
    var flash = document.createElement("div"); flash.className = "crs-flash"; root.appendChild(flash);
    shots.forEach(function (s) { if (s.transition === "flash") { tl.fromTo(flash, { autoAlpha: 0.95 }, { autoAlpha: 0, duration: 0.3 }, s.start); } });

    /* ------------------------------ drawing */
    function stepped(t) { return look.fps >= 30 ? t : Math.floor(t * look.fps) / look.fps; }
    function variant(t, n) { return n <= 1 ? 0 : Math.floor(t * (look.fps >= 30 ? 8 : look.fps / 2)) % n; }
    function drawImg(ctx, im, x, y, w, h) { if (im && im.complete && im.naturalWidth) ctx.drawImage(im, x, y, w, h); }

    function drawShot(ctx, s, t) {
      var set = SETS[s.set]; if (!set) return;
      var dur = Math.max(0.01, s.end - s.start), p = clamp((t - s.start) / dur, 0, 1);
      var cam = camAt(s, set, p, W, H), tq = stepped(t);
      if (cam.move === "shake" || look.fps < 30) {
        var amp = cam.move === "shake" ? 9 : 2.2, j = Math.floor(tq * 24);
        cam.x += (hash(j) - 0.5) * amp * 2; cam.y += (hash(j + 99) - 0.5) * amp * 2;
      }
      var csx = cam.sw / 2, csy = cam.sh / 2;
      ctx.fillStyle = look.paperColor || "#141318"; ctx.fillRect(0, 0, W, H);
      set.layers.forEach(function (layer) {
        var d = layer.depth, f = 0.35 + 0.65 * d, lx = csx + (cam.x - csx) * f, ly = csy + (cam.y - csy) * f, lz = 1 + (cam.z - 1) * (0.5 + 0.5 * d);
        ctx.save(); ctx.translate(W / 2, H / 2); ctx.rotate(cam.rot * Math.PI / 180); ctx.scale(lz, lz); ctx.translate(-lx, -ly);
        drawImg(ctx, layer.imgs[variant(tq, layer.imgs.length)], 0, 0, cam.sw, cam.sh);
        ctx.restore();
      });
      ctx.save(); ctx.translate(W / 2, H / 2); ctx.rotate(cam.rot * Math.PI / 180); ctx.scale(cam.z, cam.z); ctx.translate(-cam.x, -cam.y);
      var items = [];
      (s.props || []).forEach(function (pp, pi) { items.push({ y: pp.y, kind: "prop", v: pp, i: pi }); });
      (s.cast || []).forEach(function (c, ci) { items.push({ y: c.y, kind: "cast", v: c, i: ci }); });
      items.sort(function (a, b) { return (a.v.z || 0) - (b.v.z || 0) || a.y - b.y; });
      items.forEach(function (it) {
        if (it.kind === "prop") {
          var pr = PROPS[it.v.id]; if (!pr) return;
          var m = propMotion(it.v.motion, tq - s.start, it.i + 1), sc = (it.v.scale || 1) * m.s * cam.k;
          var w = pr.w * sc, h = pr.h * sc;
          ctx.save(); ctx.globalAlpha = m.a; ctx.translate(it.v.x * cam.k + m.dx, it.v.y * cam.k + m.dy); ctx.rotate(((it.v.rotate || 0) + m.rot) * Math.PI / 180);
          if (it.v.flip) ctx.scale(-1, 1);
          drawImg(ctx, pr.imgs[variant(tq + it.i * 0.17, pr.imgs.length)], -w / 2, -h, w, h);
          ctx.restore();
        } else {
          var A = CAST[it.v.who]; if (!A) return;
          var scale = (SIZE[it.v.size] || SIZE.m) * cam.k, fx = it.v.x * cam.k, fy = it.v.y * cam.k;
          A.shots = [{ t: 0, x: fx, y: fy, scale: scale, d: 0 }];
          ctx.save();
          if (it.v.facing === "left") { ctx.translate(fx, 0); ctx.scale(-1, 1); ctx.translate(-fx, 0); }
          A.draw(ctx, tq);
          ctx.restore();
        }
      });
      ctx.restore();
      if (s.proof && PROOFS[s.proof] && PROOFS[s.proof].length) drawProof(ctx, PROOFS[s.proof], s, t, tq);
      (s.fx || []).forEach(function (k, ki) { drawFx(ctx, k, tq, W, H, look, ki + 1 + shots.indexOf(s) * 3); });
    }

    function roundRect(ctx, x, y, w, h, r) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }
    function drawProof(ctx, imgs, s, t, tq) {
      var dur = Math.max(0.5, s.end - s.start), p = clamp((t - s.start) / dur, 0, 1);
      var img = imgs[Math.min(imgs.length - 1, Math.floor(p * imgs.length))];
      if (!img || !img.complete || !img.naturalWidth) return;
      var maxW = W * 0.8, maxH = H * 0.46, ar = img.naturalWidth / img.naturalHeight;
      var w = Math.min(maxW, maxH * ar), h = w / ar;
      var pop = clamp((t - s.start) / 0.35, 0, 1), k = pop < 1 ? 1 - Math.pow(1 - pop, 3) * (1 - 0.2) : 1;
      var cx = W / 2, cy = H * 0.4 + Math.sin(tq * 1.6) * 8 - (1 - k) * 60, rot = (-2.2 + Math.sin(tq * 0.9) * 0.8) * Math.PI / 180;
      var zoom = 1 + p * 0.06;
      ctx.save();
      ctx.translate(cx, cy); ctx.rotate(rot); ctx.scale(k * zoom, k * zoom); ctx.globalAlpha = clamp(pop * 1.6, 0, 1);
      ctx.shadowColor = "rgba(0,0,0,.45)"; ctx.shadowBlur = 50; ctx.shadowOffsetY = 24;
      ctx.fillStyle = "#FFFFFF"; roundRect(ctx, -w / 2 - 16, -h / 2 - 16, w + 32, h + 32, 34); ctx.fill();
      ctx.shadowColor = "transparent";
      ctx.save(); roundRect(ctx, -w / 2, -h / 2, w, h, 22); ctx.clip(); ctx.drawImage(img, -w / 2, -h / 2, w, h); ctx.restore();
      ctx.restore();
    }

    function transitionAt(t) {
      for (var i = 1; i < shots.length; i++) {
        var s = shots[i], kind = s.transition || "cut";
        if (kind === "cut" || kind === "flash") continue;
        var dur = kind === "whip" ? 0.28 : kind === "iris" ? 0.6 : 0.45;
        if (t >= s.start && t < s.start + dur) return { from: shots[i - 1], to: s, p: (t - s.start) / dur, kind: kind };
      }
      return null;
    }
    function shotAt(t) { var cur = shots[0]; for (var i = 0; i < shots.length; i++) if (shots[i].start <= t) cur = shots[i]; return cur; }

    function post(t) {
      var tq = stepped(t);
      vx.save();
      vx.clearRect(0, 0, W, H);
      if (block) {
        sx.imageSmoothingEnabled = true; sx.clearRect(0, 0, small.width, small.height);
        sx.drawImage(work, 0, 0, small.width, small.height);
        if (quant && quant.length) {
          var img = sx.getImageData(0, 0, small.width, small.height), d = img.data;
          for (var i = 0; i < d.length; i += 4) {
            var best = 0, bd = 1e9;
            for (var q = 0; q < quant.length; q++) { var dr = d[i] - quant[q][0], dg = d[i + 1] - quant[q][1], db = d[i + 2] - quant[q][2], dd = dr * dr * 0.3 + dg * dg * 0.59 + db * db * 0.11; if (dd < bd) { bd = dd; best = q; } }
            // Keep shading: blend toward the nearest palette colour (posterised), not a hard snap.
            d[i] = (d[i] * 0.35 + quant[best][0] * 0.65) & 0xF8; d[i + 1] = (d[i + 1] * 0.35 + quant[best][1] * 0.65) & 0xF8; d[i + 2] = (d[i + 2] * 0.35 + quant[best][2] * 0.65) & 0xF8;
          }
          sx.putImageData(img, 0, 0);
        }
        vx.imageSmoothingEnabled = false;
        vx.drawImage(small, 0, 0, W, H);
      } else {
        var src = work;
        if (look.soften) {
          // Downsample + smooth upscale: one soft "painted" surface for sets and characters alike.
          if (!softC) { softC = document.createElement("canvas"); softC.width = Math.round(W / look.soften); softC.height = Math.round(H / look.soften); softX = softC.getContext("2d"); }
          softX.imageSmoothingEnabled = true; softX.imageSmoothingQuality = "high";
          softX.drawImage(work, 0, 0, softC.width, softC.height);
          src = softC;
        }
        vx.imageSmoothingEnabled = true; vx.imageSmoothingQuality = "high";
        if (look.filter && look.filter !== "none") vx.filter = look.filter;
        var wv = look.weave ? (hash(Math.floor(tq * 12)) - 0.5) * look.weave * 2 : 0;
        vx.drawImage(src, wv, wv * 0.6, W, H);
        vx.filter = "none";
        if (look.edges) {
          // Wet edges: pigment collects where colour changes (a dark halo from a blurred difference).
          vx.globalAlpha = look.edges; vx.globalCompositeOperation = "multiply"; vx.filter = "blur(2px) contrast(1.6) brightness(.92)"; vx.drawImage(src, 1.5, 1.5, W, H); vx.filter = "none"; vx.globalCompositeOperation = "source-over"; vx.globalAlpha = 1;
        }
        if (look.bleed) { vx.globalAlpha = look.bleed; vx.filter = "blur(5px)"; vx.globalCompositeOperation = "multiply"; vx.drawImage(src, 0, 0, W, H); vx.filter = "none"; vx.globalCompositeOperation = "source-over"; vx.globalAlpha = 1; }
        if (look.glow) { vx.globalAlpha = look.glow; vx.filter = "blur(14px)"; vx.globalCompositeOperation = "lighter"; vx.drawImage(src, 0, 0, W, H); vx.filter = "none"; vx.globalCompositeOperation = "source-over"; vx.globalAlpha = 1; }
        if (look.brush) { vx.globalAlpha = look.brush; vx.globalCompositeOperation = "soft-light"; vx.drawImage(texture("brush", W, H), 0, 0, W, H); vx.globalCompositeOperation = "source-over"; vx.globalAlpha = 1; }
        if (look.paper) { vx.globalAlpha = look.paperAlpha; vx.globalCompositeOperation = "multiply"; vx.drawImage(texture(look.paper, W, H), 0, 0, W, H); vx.globalCompositeOperation = "source-over"; vx.globalAlpha = 1; }
        if (look.halftone) { vx.globalAlpha = look.halftone; vx.globalCompositeOperation = "multiply"; vx.drawImage(texture("halftone", W, H), 0, 0, W, H); vx.globalCompositeOperation = "source-over"; vx.globalAlpha = 1; }
        if (look.grain) { vx.globalAlpha = look.grain; vx.globalCompositeOperation = "overlay"; vx.drawImage(texture("grain" + (Math.floor(tq * 12) % 4 + 1), W, H), 0, 0, W, H); vx.globalCompositeOperation = "source-over"; vx.globalAlpha = 1; }
        if (look.scratches) {
          var sr = rng(Math.floor(tq * 12) + 5);
          if (sr() > 0.55) { vx.strokeStyle = "rgba(255,250,235,.35)"; vx.lineWidth = 2; var lx2 = sr() * W; vx.beginPath(); vx.moveTo(lx2, 0); vx.lineTo(lx2 + sr() * 20 - 10, H); vx.stroke(); }
          if (sr() > 0.8) { vx.fillStyle = "rgba(20,15,10,.5)"; vx.beginPath(); vx.arc(sr() * W, sr() * H, 3 + sr() * 6, 0, 6.29); vx.fill(); }
        }
      }
      if (look.vignette) {
        var g = vx.createRadialGradient(W / 2, H * 0.52, H * 0.25, W / 2, H * 0.52, H * 0.78);
        g.addColorStop(0, "rgba(0,0,0,0)"); g.addColorStop(1, "rgba(0,0,0," + look.vignette + ")");
        vx.fillStyle = g; vx.fillRect(0, 0, W, H);
      }
      vx.restore();
    }

    var st = { t: 0 };
    function frame() {
      var t = st.t, tr = transitionAt(t);
      if (!tr) { drawShot(wx, shotAt(t), t); }
      else {
        drawShot(px, tr.from, t); drawShot(wx, tr.to, t);
        var p = smooth(clamp(tr.p, 0, 1));
        wx.save();
        if (tr.kind === "fade" || tr.kind === "dissolve") { wx.globalAlpha = 1 - p; wx.drawImage(prevC, 0, 0); }
        else if (tr.kind === "wipe") { wx.beginPath(); wx.rect(W * p, 0, W * (1 - p), H); wx.clip(); wx.drawImage(prevC, 0, 0); }
        else if (tr.kind === "iris") { wx.beginPath(); wx.rect(0, 0, W, H); wx.arc(W / 2, H * 0.48, Math.max(1, p * H * 0.75), 0, Math.PI * 2, true); wx.clip("evenodd"); wx.drawImage(prevC, 0, 0); }
        else if (tr.kind === "whip") {
          var off = W * p;
          wx.globalAlpha = 1 - p * 0.3; wx.filter = "blur(" + Math.round(18 * Math.sin(p * Math.PI)) + "px)"; wx.drawImage(prevC, -off, 0);
        }
        wx.restore();
      }
      post(t);
    }
    tl.to(st, { t: D, duration: D, ease: "none", onUpdate: frame }, 0);
    frame();
    return { shots: shots, look: look };
  };

  window.CRS = CRS;
})();
