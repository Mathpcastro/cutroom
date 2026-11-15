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
  var MEASURE = null;
  /** Width of a text in a CSS font, measured on a canvas (fonts are loaded before the first frame). */
  function textWidth(text, font) {
    if (!MEASURE) MEASURE = document.createElement("canvas").getContext("2d");
    MEASURE.font = font;
    return MEASURE.measureText(text).width;
  }
  function lum(h) { var c = hexRgb(h); return (0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]) / 255; }
  function hexRgb(h) { var n = parseInt(String(h || "#000").replace("#", "").replace(/^(.)(.)(.)$/, "$1$1$2$2$3$3"), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }

  /* ------------------------------------------------------------------ looks */
  var LOOKS = {
    pixel: { fps: 12, boil: 0, block: 6, quantize: true, font: "Silkscreen", text: "pixel", outline: "ink", glow: false, vignette: 0.22, avatar: "crisp" },
    aquarela: { fps: 12, boil: 7, boilFreq: 0.012, soften: 2.6, paper: "wash", paperAlpha: 0.5, bleed: 0.25, edges: 0.3, filter: "saturate(.82) contrast(.92) brightness(1.08)", font: "Fredoka", text: "paper", outline: "ink", glow: false, vignette: 0.1, avatar: "soft" },
    oleo: { fps: 12, boil: 10, boilFreq: 0.02, soften: 2, paper: "canvas", paperAlpha: 0.45, brush: 0.6, filter: "saturate(1.16) contrast(1.08)", font: "InstrumentSerif", text: "serif", outline: "ink", glow: false, vignette: 0.28, avatar: "soft" },
    giz: { fps: 8, boil: 6, boilFreq: 0.05, soften: 1.6, paper: "crayon", paperAlpha: 0.9, filter: "saturate(1.08)", font: "Caveat", text: "hand", outline: "ink", glow: false, vignette: 0.12, avatar: "soft" },
    hq: { fps: 12, boil: 2, boilFreq: 0.02, halftone: 0.32, filter: "contrast(1.22) saturate(.9)", font: "Anton", text: "comic", outline: "ink", glow: false, vignette: 0.18, avatar: "crisp", ink: 1 },
    guache: { fps: 12, boil: 4, boilFreq: 0.015, soften: 1.8, paper: "paper", paperAlpha: 0.5, filter: "saturate(1.04)", font: "Fredoka", text: "paper", outline: "ink", glow: false, vignette: 0.12, avatar: "soft" },
    retro: { fps: 12, boil: 2, boilFreq: 0.02, soften: 1.5, grain: 0.18, filter: "sepia(.38) saturate(.78) contrast(1.06)", font: "InstrumentSerif", text: "serif", outline: "ink", glow: false, vignette: 0.55, weave: 2.2, scratches: true, avatar: "soft" },
    vetor: { fps: 30, boil: 0, filter: "none", font: "Fredoka", text: "clean", outline: "accent", glow: false, vignette: 0.14, avatar: "crisp" },
    rabisco: { fps: 12, boil: 2.5, boilFreq: 0.03, paper: "grid", paperAlpha: 1, filter: "none", font: "Caveat", text: "hand", outline: "ink", glow: false, vignette: 0, avatar: "crisp", paperDefault: "#FDFDFC", stick: true },
    tv: { fps: 15, boil: 0, crt: true, filter: "saturate(1.15) contrast(1.12)", grain: 0.1, font: "JetBrains", text: "mono", outline: "ink", glow: false, vignette: 0.62, avatar: "crisp" },
    interface: { fps: 30, boil: 0, filter: "none", font: "Instrument", text: "clean", outline: "accent", glow: false, vignette: 0.08, avatar: "crisp", paperDefault: "#0E0F1A" },
    neon: { fps: 30, boil: 0, filter: "saturate(1.25)", glow: 0.38, font: "Montserrat", text: "neon", outline: "accent", vignette: 0.4, avatar: "crisp" },
  };
  var FONTS = {
    Silkscreen: "'Silkscreen', monospace", Fredoka: "'Fredoka', sans-serif", InstrumentSerif: "'Instrument Serif', serif",
    Caveat: "'Caveat', cursive", JetBrains: "'JetBrains Mono', monospace", Anton: "'Anton', sans-serif", Montserrat: "'Montserrat', sans-serif", Instrument: "'Instrument Sans', sans-serif",
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
    // Interface kit (Motion UI, product videos): clean app pieces with soft drop shadows, recolourable.
    // Light is white and see-through, so it works on any palette: a sheen from the top, a glass reflection.
    '<linearGradient id="kit-sheen" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".55"/><stop offset=".55" stop-color="#fff" stop-opacity=".08"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>' +
    '<linearGradient id="kit-glass" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".0"/><stop offset=".42" stop-color="#fff" stop-opacity=".0"/><stop offset=".5" stop-color="#fff" stop-opacity=".22"/><stop offset=".62" stop-color="#fff" stop-opacity=".0"/></linearGradient>' +
    '<linearGradient id="kit-shade" x1="0" y1="0" x2="0" y2="1"><stop offset=".5" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".14"/></linearGradient>',
    '<symbol id="kit-ui-phone" viewBox="0 0 300 610"><rect x="14" y="22" width="286" height="588" rx="52" fill="#000" opacity=".10"/><rect x="0" y="0" width="290" height="590" rx="50" ' + F("d", "#1C1C1E") + '/><rect x="12" y="12" width="266" height="566" rx="40" ' + F("a", "#FFFFFF") + '/>' +
      '<rect x="105" y="26" width="80" height="24" rx="12" ' + F("d", "#1C1C1E") + '/><rect x="34" y="74" width="120" height="18" rx="9" ' + F("b", "#E5E5EA") + '/><circle cx="246" cy="83" r="14" ' + F("b", "#E5E5EA") + '/>' +
      '<rect x="34" y="112" width="222" height="196" rx="24" ' + F("c", "#007AFF") + ' opacity=".14"/><circle cx="145" cy="200" r="54" ' + F("c", "#007AFF") + ' opacity=".55"/><rect x="34" y="330" width="170" height="20" rx="10" ' + F("d", "#1C1C1E") + '/>' +
      '<rect x="34" y="364" width="222" height="14" rx="7" ' + F("b", "#E5E5EA") + '/><rect x="34" y="390" width="160" height="14" rx="7" ' + F("b", "#E5E5EA") + '/><rect x="34" y="426" width="104" height="78" rx="18" ' + F("b", "#F2F2F7") + '/><rect x="152" y="426" width="104" height="78" rx="18" ' + F("b", "#F2F2F7") + '/>' +
      '<rect x="34" y="520" width="222" height="40" rx="20" ' + F("c", "#007AFF") + '/><rect x="34" y="520" width="222" height="40" rx="20" fill="url(#kit-sheen)"/><rect x="110" y="536" width="70" height="8" rx="4" fill="#FFFFFF" opacity=".9"/>' +
      '<rect x="12" y="12" width="266" height="566" rx="40" fill="url(#kit-glass)"/><rect x="2" y="2" width="286" height="586" rx="49" fill="none" stroke="#fff" stroke-opacity=".18" stroke-width="3"/></symbol>',
    '<symbol id="kit-ui-browser" viewBox="0 0 660 440"><rect x="14" y="20" width="646" height="420" rx="26" fill="#000" opacity=".09"/><rect x="0" y="0" width="640" height="420" rx="24" ' + F("a", "#FFFFFF") + '/><path d="M0 24 Q0 0 24 0 H616 Q640 0 640 24 V54 H0Z" ' + F("b", "#F2F2F7") + '/>' +
      '<circle cx="30" cy="27" r="8" fill="#FF5F57"/><circle cx="56" cy="27" r="8" fill="#FEBC2E"/><circle cx="82" cy="27" r="8" fill="#28C840"/><rect x="190" y="14" width="260" height="26" rx="13" ' + F("a", "#FFFFFF") + '/>' +
      '<rect x="32" y="84" width="300" height="28" rx="10" ' + F("d", "#1C1C1E") + '/><rect x="32" y="128" width="250" height="14" rx="7" ' + F("b", "#E5E5EA") + '/><rect x="32" y="152" width="210" height="14" rx="7" ' + F("b", "#E5E5EA") + '/><rect x="32" y="190" width="140" height="42" rx="21" ' + F("c", "#007AFF") + '/>' +
      '<rect x="368" y="80" width="240" height="170" rx="20" ' + F("c", "#007AFF") + ' opacity=".14"/><circle cx="488" cy="165" r="52" ' + F("c", "#007AFF") + ' opacity=".5"/>' +
      '<rect x="32" y="280" width="176" height="108" rx="18" ' + F("b", "#F2F2F7") + '/><rect x="232" y="280" width="176" height="108" rx="18" ' + F("b", "#F2F2F7") + '/><rect x="432" y="280" width="176" height="108" rx="18" ' + F("b", "#F2F2F7") + '/></symbol>',
    '<symbol id="kit-ui-card" viewBox="0 0 420 250"><rect x="10" y="16" width="410" height="234" rx="34" fill="#000" opacity=".08"/><rect x="0" y="0" width="400" height="230" rx="32" ' + F("a", "#FFFFFF") + '/><circle cx="66" cy="66" r="34" ' + F("c", "#007AFF") + '/>' +
      '<rect x="118" y="44" width="170" height="20" rx="10" ' + F("d", "#1C1C1E") + '/><rect x="118" y="76" width="120" height="14" rx="7" ' + F("b", "#C7C7CC") + '/><rect x="34" y="128" width="332" height="14" rx="7" ' + F("b", "#E5E5EA") + '/><rect x="34" y="156" width="260" height="14" rx="7" ' + F("b", "#E5E5EA") + '/><rect x="34" y="186" width="96" height="20" rx="10" ' + F("c", "#007AFF") + ' opacity=".25"/><rect x="0" y="0" width="400" height="230" rx="32" fill="url(#kit-shade)"/></symbol>',
    '<symbol id="kit-ui-chart" viewBox="0 0 420 300"><rect x="10" y="16" width="410" height="284" rx="34" fill="#000" opacity=".08"/><rect x="0" y="0" width="400" height="280" rx="32" ' + F("a", "#FFFFFF") + '/><rect x="32" y="30" width="140" height="18" rx="9" ' + F("d", "#1C1C1E") + '/>' +
      '<rect x="40" y="170" width="44" height="76" rx="10" ' + F("b", "#E5E5EA") + '/><rect x="104" y="140" width="44" height="106" rx="10" ' + F("b", "#E5E5EA") + '/><rect x="168" y="118" width="44" height="128" rx="10" ' + F("b", "#E5E5EA") + '/><rect x="232" y="92" width="44" height="154" rx="10" ' + F("b", "#E5E5EA") + '/><rect x="296" y="62" width="44" height="184" rx="10" ' + F("c", "#007AFF") + '/>' +
      '<path d="M50 150 L126 120 L190 100 L254 74 L318 44" fill="none" stroke="#34C759" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/><circle cx="318" cy="44" r="10" fill="#34C759"/><rect x="296" y="62" width="44" height="184" rx="10" fill="url(#kit-sheen)"/></symbol>',
    '<symbol id="kit-ui-button" viewBox="0 0 320 100"><rect x="8" y="16" width="312" height="84" rx="42" fill="#000" opacity=".12"/><rect x="0" y="0" width="300" height="84" rx="42" ' + F("c", "#007AFF") + '/><rect x="0" y="0" width="300" height="84" rx="42" fill="url(#kit-sheen)"/><rect x="90" y="34" width="120" height="16" rx="8" ' + F("a", "#FFFFFF") + '/></symbol>',
    '<symbol id="kit-ui-toggle" viewBox="0 0 170 96"><rect x="0" y="0" width="160" height="90" rx="45" ' + F("c", "#34C759") + '/><rect x="0" y="0" width="160" height="90" rx="45" fill="url(#kit-sheen)"/><circle cx="115" cy="45" r="37" fill="#000" opacity=".12"/><circle cx="114" cy="42" r="37" ' + F("a", "#FFFFFF") + '/></symbol>',
    '<symbol id="kit-ui-check" viewBox="0 0 130 130"><circle cx="68" cy="70" r="60" fill="#000" opacity=".10"/><circle cx="64" cy="64" r="60" ' + F("c", "#34C759") + '/><circle cx="64" cy="64" r="60" fill="url(#kit-sheen)"/><path d="M36 66 L56 86 L94 44" fill="none" stroke="#FFFFFF" stroke-width="13" stroke-linecap="round" stroke-linejoin="round"/></symbol>',
    '<symbol id="kit-ui-bell" viewBox="0 0 150 160"><path d="M70 20 Q118 20 120 74 L122 104 L136 124 H8 L22 104 L24 74 Q26 20 70 20Z" ' + F("c", "#FF9500") + '/><path d="M70 20 Q96 22 106 46 Q86 30 70 32Z" fill="#FFFFFF" opacity=".35"/><circle cx="72" cy="138" r="16" ' + F("c", "#FF9500") + '/>' +
      '<circle cx="120" cy="30" r="26" ' + F("d", "#FF3B30") + '/><rect x="114" y="18" width="12" height="24" rx="4" fill="#FFFFFF"/></symbol>',
    '<symbol id="kit-ui-bubble" viewBox="0 0 380 170"><path d="M30 0 H350 Q380 0 380 30 V100 Q380 130 350 130 H70 L26 166 L34 130 H30 Q0 130 0 100 V30 Q0 0 30 0Z" ' + F("c", "#007AFF") + '/><rect x="34" y="34" width="250" height="18" rx="9" fill="#FFFFFF" opacity=".95"/><rect x="34" y="70" width="180" height="18" rx="9" fill="#FFFFFF" opacity=".7"/></symbol>',
    '<symbol id="kit-ui-avatar" viewBox="0 0 150 150"><circle cx="75" cy="75" r="72" ' + F("b", "#E5E5EA") + '/><circle cx="75" cy="60" r="26" ' + F("a", "#8E8E93") + '/><path d="M28 128 Q75 74 122 128 Q100 146 75 146 Q50 146 28 128Z" ' + F("a", "#8E8E93") + '/></symbol>',
    '<symbol id="kit-ui-bag" viewBox="0 0 220 240"><ellipse cx="110" cy="232" rx="90" ry="8" fill="#000" opacity=".10"/><path d="M70 70 Q70 18 110 18 Q150 18 150 70" fill="none" ' + "style=\"stroke:var(--d,#1C1C1E)\"" + ' stroke-width="12" stroke-linecap="round"/>' +
      '<path d="M24 62 H196 L184 226 H36Z" ' + F("c", "#007AFF") + '/><path d="M24 62 H196 L184 226 H36Z" fill="url(#kit-shade)"/><path d="M24 62 H110 L104 110 H28Z" fill="#fff" opacity=".14"/><path d="M150 62 H196 L184 226 H160Z" ' + F("b", "#0062CC") + '/><circle cx="70" cy="96" r="8" ' + F("d", "#1C1C1E") + '/><circle cx="150" cy="96" r="8" ' + F("d", "#1C1C1E") + '/></symbol>',
    '<symbol id="kit-ui-cart" viewBox="0 0 260 220"><path d="M10 20 H52 L84 150 H214 L240 62 H64" fill="none" ' + "style=\"stroke:var(--d,#1C1C1E)\"" + ' stroke-width="14" stroke-linecap="round" stroke-linejoin="round"/><path d="M70 74 H226 L206 138 H86Z" ' + F("c", "#007AFF") + '/>' +
      '<circle cx="100" cy="192" r="18" ' + F("d", "#1C1C1E") + '/><circle cx="196" cy="192" r="18" ' + F("d", "#1C1C1E") + '/></symbol>',
    '<symbol id="kit-ui-paycard" viewBox="0 0 360 230"><rect x="12" y="18" width="348" height="212" rx="26" fill="#000" opacity=".12"/><rect x="0" y="0" width="340" height="212" rx="26" ' + F("c", "#007AFF") + '/><rect x="0" y="0" width="340" height="212" rx="26" fill="url(#kit-sheen)" opacity=".7"/><path d="M200 0 H314 Q340 0 340 26 V212 H120Z" fill="#FFFFFF" opacity=".12"/>' +
      '<rect x="30" y="56" width="58" height="44" rx="10" fill="#F5D06F"/><rect x="30" y="134" width="200" height="16" rx="8" fill="#FFFFFF" opacity=".9"/><rect x="30" y="164" width="110" height="12" rx="6" fill="#FFFFFF" opacity=".6"/><circle cx="276" cy="168" r="22" fill="#FFFFFF" opacity=".55"/><circle cx="300" cy="168" r="22" fill="#FFFFFF" opacity=".35"/></symbol>',
    '<symbol id="kit-ui-box" viewBox="0 0 240 230"><ellipse cx="120" cy="220" rx="104" ry="10" fill="#000" opacity=".10"/><path d="M120 10 L230 60 L120 110 L10 60Z" ' + F("a", "#E9B872") + '/><path d="M120 10 L230 60 L120 110 L10 60Z" fill="#fff" opacity=".18"/><path d="M10 60 L120 110 V216 L10 166Z" ' + F("b", "#D49A4A") + '/><path d="M230 60 L120 110 V216 L230 166Z" ' + F("c", "#C4873A") + '/>' +
      '<path d="M65 35 L175 85 V120 L150 110 V96 L42 46Z" ' + F("d", "#F4E3C1") + ' opacity=".9"/></symbol>',
    '<symbol id="kit-ui-tshirt" viewBox="0 0 280 260"><ellipse cx="140" cy="252" rx="100" ry="8" fill="#000" opacity=".10"/><path d="M96 10 Q140 40 184 10 L270 50 L238 112 L208 98 V246 H72 V98 L42 112 L10 50Z" ' + F("a", "#007AFF") + '/>' +
      '<path d="M184 10 L270 50 L238 112 L208 98 V246 H170 V60Z" ' + F("b", "#0062CC") + '/><path d="M96 10 Q140 40 184 10 Q172 34 140 36 Q108 34 96 10Z" ' + F("d", "#00438C") + '/></symbol>',
    '<symbol id="kit-ui-heart" viewBox="0 0 130 120"><path d="M65 116 Q6 76 6 38 Q6 6 36 6 Q56 6 65 26 Q74 6 94 6 Q124 6 124 38 Q124 76 65 116Z" ' + F("c", "#FF2D55") + '/><ellipse cx="38" cy="34" rx="14" ry="9" fill="#FFFFFF" opacity=".35" transform="rotate(-30 38 34)"/></symbol>',
    '<symbol id="kit-ui-play" viewBox="0 0 150 150"><circle cx="79" cy="81" r="68" fill="#000" opacity=".10"/><circle cx="75" cy="75" r="68" ' + F("c", "#007AFF") + '/><circle cx="75" cy="75" r="68" fill="url(#kit-sheen)"/><path d="M60 46 L108 75 L60 104Z" ' + F("a", "#FFFFFF") + '/></symbol>',
    '<symbol id="kit-ui-sparkle" viewBox="0 0 100 100"><path d="M50 0 Q56 44 100 50 Q56 56 50 100 Q44 56 0 50 Q44 44 50 0Z" ' + F("c", "#FFCC00") + '/></symbol>',
    '<symbol id="kit-ui-blob" viewBox="0 0 400 400"><path d="M210 18 Q320 24 362 120 Q402 214 340 300 Q270 392 170 374 Q62 356 30 254 Q0 150 70 80 Q130 14 210 18Z" ' + F("a", "#007AFF") + ' opacity=".14"/></symbol>',
    '<symbol id="kit-ui-cursor" viewBox="0 0 80 110"><path d="M6 4 L6 88 L28 68 L44 104 L60 96 L44 62 L74 62Z" fill="#FFFFFF" ' + "style=\"stroke:var(--d,#1C1C1E)\"" + ' stroke-width="6" stroke-linejoin="round"/></symbol>',
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
        for (var yy2 = 0; yy2 < 32; yy2++) for (var xx2 = 0; xx2 < 18; xx2++) { var g2 = Math.round(255 - br2() * 34); bx2.fillStyle = "rgb(" + g2 + "," + (g2 - 2) + "," + (g2 - 8) + ")"; bx2.fillRect(xx2, yy2, 1, 1); }
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
    } else if (kind === "grid") {
      // Warm near-white paper with an extremely faint square grid (hand-drawn notebook).
      c = document.createElement("canvas"); c.width = W; c.height = H;
      var gx = c.getContext("2d"); gx.fillStyle = "#FFFFFF"; gx.fillRect(0, 0, W, H);
      gx.strokeStyle = "rgba(76,90,105,.07)"; gx.lineWidth = 1.2;
      var step = Math.round(Math.min(W, H) / 17);
      for (var gxx = step; gxx < W; gxx += step) { gx.beginPath(); gx.moveTo(gxx + 0.5, 0); gx.lineTo(gxx + 0.5, H); gx.stroke(); }
      for (var gyy = step; gyy < H; gyy += step) { gx.beginPath(); gx.moveTo(0, gyy + 0.5); gx.lineTo(W, gyy + 0.5); gx.stroke(); }
    } else if (kind === "scan") {
      c = document.createElement("canvas"); c.width = W; c.height = H;
      var sxx = c.getContext("2d"); sxx.fillStyle = "#FFFFFF"; sxx.fillRect(0, 0, W, H); sxx.fillStyle = "rgba(0,0,0,.28)";
      for (var sy = 0; sy < H; sy += 4) sxx.fillRect(0, sy, W, 2);
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
    Array.prototype.forEach.call(root.childNodes, function (n) { if (n.nodeType === 1 && n.nodeName === "defs") defs += new XMLSerializer().serializeToString(n); });
    Array.prototype.forEach.call(root.childNodes, function (n) {
      if (n.nodeType !== 1) return;
      if (n.nodeName === "defs") return;
      var depth = n.getAttribute && n.getAttribute("data-depth");
      var d = depth == null || depth === "" ? null : clamp(+depth || 0, 0, 2);
      if (!cur || (d != null && d !== cur.depth) || (d == null && cur.explicit)) { cur = { depth: d == null ? 1 : d, explicit: d != null, parts: [], living: [] }; runs.push(cur); }
      // Living elements (data-motion, outermost only) leave the still layer and become sprites of their own.
      var LIVE = "[data-motion],[data-el]";
      var marked = Array.prototype.filter.call(n.querySelectorAll ? n.querySelectorAll(LIVE) : [], function (el) { return !el.parentNode.closest || !el.parentNode.closest(LIVE); });
      if (n.getAttribute && (n.getAttribute("data-motion") || n.getAttribute("data-el"))) marked = [n];
      marked.slice(0, 12).forEach(function (el) {
        // Keep what the element inherits from its groups (transform, fill, stroke, opacity) when it is cut out.
        var markup = new XMLSerializer().serializeToString(el);
        for (var anc = el.parentNode; anc && anc !== n.parentNode && anc.nodeType === 1; anc = anc.parentNode) {
          var at = Array.prototype.filter.call(anc.attributes, function (x) { return !/^(data-|id$|class$)/.test(x.name); }).map(function (x) { return x.name + '="' + String(x.value).replace(/"/g, "") + '"'; }).join(" ");
          if (at) markup = "<g " + at + ">" + markup + "</g>";
        }
        cur.living.push({ motion: el.getAttribute("data-motion") || "none", name: el.getAttribute("data-el") || null, delay: +(el.getAttribute("data-delay") || 0) || 0, markup: markup });
        if (el !== n) el.parentNode.removeChild(el);
      });
      if (marked[0] !== n) cur.parts.push(new XMLSerializer().serializeToString(n));
    });
    var variants = look.boil ? 3 : 1, order = 0;
    var out = {
      w: vw, h: vh,
      layers: runs.map(function (run, li) {
        var imgs = [];
        for (var v = 0; v < variants; v++) {
          var text = '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 ' + vw + " " + vh + '" width="' + Math.round(vw * scale) + '" height="' + Math.round(vh * scale) + '">' +
            paletteStyle(look) + "<defs>" + KIT + boilDefs(look, 3 + v * 17 + li * 5) + "</defs>" + defs +
            (look.boil ? '<g filter="url(#crsBoil)">' : "<g>") + run.parts.join("") + "</g></svg>";
          imgs.push(svgImage(text));
        }
        var sprites = run.living.map(function (lv) {
          var box = measureSvg(lv.markup, defs, vw, vh);
          if (!box || box.width < 2 || box.height < 2) return null;
          var pad = Math.max(box.width, box.height) * 0.08 + (look.boil ? look.boil * 2 : 6);
          var bx = box.x - pad, by = box.y - pad, bw = box.width + pad * 2, bh = box.height + pad * 2, simgs = [];
          for (var v2 = 0; v2 < variants; v2++)
            simgs.push(svgImage('<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="' + [bx, by, bw, bh].join(" ") + '" width="' + Math.max(1, Math.round(bw * scale)) + '" height="' + Math.max(1, Math.round(bh * scale)) + '">' +
              "<defs>" + KIT + boilDefs(look, 11 + v2 * 19 + li * 7) + "</defs>" + defs + (look.boil ? '<g filter="url(#crsBoil)">' : "<g>") + lv.markup + "</g></svg>"));
          return { motion: lv.motion, name: lv.name, delay: lv.delay, x: bx, y: by, w: bw, h: bh, cx: box.x + box.width / 2, cy: box.y + box.height / 2, by2: box.y + box.height, imgs: simgs, i: order++ };
        }).filter(Boolean);
        return { depth: run.depth, imgs: imgs, sprites: sprites };
      }),
    };
    // Named elements (data-el), for word cues, camera targets and elements shared between sets.
    out.els = {};
    out.layers.forEach(function (layer) { layer.sprites.forEach(function (sp2) { if (sp2.name && !out.els[sp2.name]) out.els[sp2.name] = { sp: sp2, depth: layer.depth }; }); });
    return out;
  }
  /** Bounding box of one element in set units (drawn once off-screen and measured). */
  function measureSvg(markup, defs, vw, vh) {
    try {
      var host = document.createElement("div");
      host.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + vw + " " + vh + '" width="' + vw + '" height="' + vh + '"><defs>' + KIT + "</defs>" + defs + '<g class="m">' + markup + "</g></svg>";
      holderEl().appendChild(host);
      var b = host.querySelector("g.m").getBBox(), out = { x: b.x, y: b.y, width: b.width, height: b.height };
      holderEl().removeChild(host);
      return out;
    } catch (e) { return null; }
  }
  /**
   * How a living element moves at time gt (film) and et (since its set appeared). Continuous motions
   * loop forever; entrance motions land on a spring and then breathe a little.
   */
  function elementMotion(sp2, gt, et, W, cues, calm) {
    var i = sp2.i, ph = i * 1.7, h = sp2.h, m = { dx: 0, dy: 0, rot: 0, s: 1, a: 1, ox: sp2.cx, oy: sp2.cy };
    var entrance = /^(pop|rise|drop|slide-left|slide-right)$/.test(sp2.motion);
    // An entrance with a word cue waits for that word; without one it plays when the set appears.
    var since = entrance && cues && cues.length ? gt - cues[0] : et - sp2.delay - 0.05;
    var k = sp(since, SPR.bouncy), k2 = clamp(k, 0, 1.3);
    switch (sp2.motion) {
      case "float": m.dy = Math.sin(gt * 1.5 + ph) * Math.min(26, h * 0.06 + 6); m.rot = Math.sin(gt * 1.1 + ph) * 1.5; break;
      case "sway": m.rot = Math.sin(gt * 1.8 + ph) * 6; m.oy = sp2.by2; break;
      case "spin": m.rot = gt * 36 + i * 40; break;
      case "pulse": m.s = 1 + 0.07 * Math.sin(gt * 4 + ph); break;
      case "blink": m.a = 0.3 + 0.7 * Math.abs(Math.sin(gt * 2.4 + ph)); break;
      case "drift": m.dx = Math.sin(gt * 0.35 + ph) * W * 0.08; break;
      case "bounce": m.dy = -Math.abs(Math.sin(gt * 3.4 + ph)) * Math.min(60, h * 0.18 + 10); break;
      case "orbit": m.dx = Math.cos(gt * 1.3 + ph) * 18; m.dy = Math.sin(gt * 1.3 + ph) * 18; break;
      case "shake": m.dx = Math.sin(gt * 40 + ph) * 4; m.rot = Math.sin(gt * 33 + ph) * 2; break;
      case "pop": m.s = Math.max(0.001, k2); m.oy = sp2.by2; m.a = clamp(k * 2, 0, 1); break;
      case "rise": m.dy = (1 - k2) * (h * 0.6 + 120); m.a = clamp(k * 1.6, 0, 1); break;
      case "drop": m.dy = -(1 - k2) * (h * 0.6 + 160); m.a = clamp(k * 1.6, 0, 1); break;
      case "slide-left": m.dx = (1 - k2) * W * 0.7; m.a = clamp(k * 1.6, 0, 1); break;
      case "slide-right": m.dx = -(1 - k2) * W * 0.7; m.a = clamp(k * 1.6, 0, 1); break;
    }
    // Entrances do not freeze after landing: they ease into a gentle float and tilt of their own.
    // Hierarchy: in a shot that names its heroes, everyone else keeps only a hint of their idle motion.
    if (calm != null && calm < 1 && !entrance) { m.dx *= calm; m.dy *= calm; m.rot *= calm; m.s = 1 + (m.s - 1) * calm; m.a = 1 - (1 - m.a) * calm; }
    // Every other cue of the element is a highlight: a quick spring bump when its word is said.
    (cues || []).forEach(function (c, ci) {
      if (entrance && ci === 0) return;
      var lt = gt - c; if (lt >= 0 && lt < 0.6) { var b = Math.sin(lt / 0.6 * Math.PI) * (1 - lt / 0.6 * 0.4); m.s *= 1 + 0.13 * b; m.rot += Math.sin(lt * 26) * 3 * (1 - lt / 0.6); }
    });
    if (entrance) {
      var settle = clamp((since - 0.55) / 0.8, 0, 1);
      m.dy += Math.sin(gt * 1.4 + ph) * Math.min(14, h * 0.035 + 4) * settle; m.rot += Math.sin(gt * 1.05 + ph) * 1.2 * settle;
    }
    return m;
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
    (shot.cast || []).forEach(function (a) { castX += a.x * k; castY += a.y * k; tall = Math.max(tall, (SIZE[a.size] || SIZE.m) * BODY * H / 1920); n++; });
    var fx = c.focus ? c.focus[0] * k : n ? castX / n : sw / 2;
    var fy = c.focus ? c.focus[1] * k : n ? castY / n - tall * (move === "close" ? 0.8 : 0.42) : sh * 0.55;
    // Mostly linear with a soft start: the frame is always travelling, never parked at either end.
    var pc = clamp(p, 0, 1), e = pc * 0.8 + inOut(pc) * 0.2, z = 1, x = fx, y = fy, rot = 0;
    var zIn = c.zoom || 0;
    switch (move) {
      case "medium": z = lerp(1.28, 1.46, e); x = fx + (e - 0.5) * W * 0.06; break;
      case "close": z = lerp(1.58, 1.8, e) / Math.max(1, tall / (H * 0.36)); z = Math.max(1.15, z); break;
      case "push-in": z = lerp(1, 1.65, e); break;
      case "pull-out": z = lerp(1.7, 1, e); break;
      case "pan-left": z = sw > W * 1.15 ? 1 : 1.3; x = lerp(sw, 0, e); break;
      case "pan-right": z = sw > W * 1.15 ? 1 : 1.3; x = lerp(0, sw, e); break;
      case "tilt-up": z = 1.35; y = lerp(sh, 0, e); break;
      case "tilt-down": z = 1.35; y = lerp(0, sh, e); break;
      case "dutch": z = lerp(1.28, 1.44, e); rot = lerp(-4, -8, e); break;
      case "shake": z = 1.3; break;
      case "orbit": z = lerp(1.25, 1.4, e); x = fx + Math.sin(e * Math.PI) * 80; rot = lerp(-2, 2, e); break;
      default: z = lerp(1, 1.16, e); x = fx + (e - 0.5) * Math.min(sw, W) * 0.08; y = sh / 2;
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
  function hexA(hex, a) {
    var m = /^#?([0-9a-f]{6})$/i.exec(String(hex || "").trim()), n = m ? parseInt(m[1], 16) : 0xffffff;
    return "rgba(" + ((n >> 16) & 255) + "," + ((n >> 8) & 255) + "," + (n & 255) + "," + a + ")";
  }
  function roundRectFx(ctx, x, y, w, h, r) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }
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
    } else if (kind === "bokeh") {
      // Soft out-of-focus discs drifting up, in the palette.
      var bc = look.palette && look.palette.length ? look.palette : ["#FFD23F", "#7C5CFF", "#3EC1D3"];
      ctx.globalCompositeOperation = "lighter";
      for (i = 0; i < 34; i++) {
        var br = 40 + r() * 120, bx = r() * W + Math.sin(t * 0.3 + i) * 40, by = (r() * (H + 400) - t * (20 + r() * 40) + H * 4) % (H + 400) - 200;
        var bg2 = ctx.createRadialGradient(bx, by, 0, bx, by, br); bg2.addColorStop(0, hexA(bc[i % bc.length], 0.28 + 0.12 * Math.sin(t + i))); bg2.addColorStop(1, hexA(bc[i % bc.length], 0));
        ctx.fillStyle = bg2; ctx.beginPath(); ctx.arc(bx, by, br, 0, 6.29); ctx.fill();
      }
    } else if (kind === "matrix") {
      // Falling glyph columns (code, data, "inside the machine").
      var col = 40, ncol = Math.ceil(W / col), glyphs = "01アイウエオカキクケコ$#%<>/";
      ctx.font = "700 30px 'JetBrains Mono', monospace"; ctx.textAlign = "center";
      for (i = 0; i < ncol; i++) {
        var speed = 260 + r() * 420, len = 8 + Math.floor(r() * 14), head = ((t * speed + r() * H * 2) % (H + len * 34)) ;
        for (var k = 0; k < len; k++) {
          var gy = head - k * 34; if (gy < -34 || gy > H + 34) continue;
          var ch = glyphs[Math.floor((r() * 97 + Math.floor(t * 12) + k * 7) % glyphs.length)];
          ctx.fillStyle = k === 0 ? "rgba(220,255,230,.9)" : "rgba(60,230,120," + (0.55 * (1 - k / len)) + ")";
          ctx.fillText(ch, i * col + col / 2, gy);
        }
      }
    } else if (kind === "film-burn") {
      // Warm light leaks breathing in from the edges, like burnt film.
      ctx.globalCompositeOperation = "screen";
      for (i = 0; i < 3; i++) {
        var ph = t * (0.35 + i * 0.13) + i * 2.1, lx = (0.5 + 0.55 * Math.sin(ph)) * W, ly = (0.5 + 0.6 * Math.cos(ph * 0.8 + i)) * H, lr = Math.max(W, H) * (0.35 + 0.15 * Math.sin(ph * 1.7));
        var lg = ctx.createRadialGradient(lx, ly, 0, lx, ly, lr); lg.addColorStop(0, "rgba(255,150,60," + (0.34 + 0.16 * Math.sin(ph * 2.3)) + ")"); lg.addColorStop(0.5, "rgba(255,70,40,.12)"); lg.addColorStop(1, "rgba(255,40,20,0)");
        ctx.fillStyle = lg; ctx.fillRect(0, 0, W, H);
      }
    } else if (kind === "grain") {
      // Moving film grain (a new pattern a few times per second).
      var gr = rng(seed * 13 + Math.floor(t * 12));
      for (i = 0; i < 2600; i++) { ctx.fillStyle = gr() > 0.5 ? "rgba(255,255,255,.07)" : "rgba(0,0,0,.08)"; ctx.fillRect(gr() * W, gr() * H, 2 + gr() * 3, 2 + gr() * 3); }
    } else if (kind === "sound-wave") {
      // An audio waveform pulsing across the lower third (podcast, voice, music).
      var wc = (look.palette && look.palette.length ? look.palette[look.palette.length - 1] : "#FFFFFF"), nb = 48, bw2 = W / nb, cy2 = H * 0.66;
      ctx.fillStyle = hexA(wc, 0.75);
      for (i = 0; i < nb; i++) {
        var amp = (0.25 + 0.75 * Math.abs(Math.sin(t * 5.2 + i * 0.55) * Math.sin(t * 2.3 + i * 0.21))) * H * 0.08 * (0.5 + 0.5 * Math.sin(i / nb * Math.PI));
        roundRectFx(ctx, i * bw2 + bw2 * 0.22, cy2 - amp, bw2 * 0.56, amp * 2, bw2 * 0.28); ctx.fill();
      }
    } else if (kind === "speed-lines") {
      ctx.strokeStyle = "rgba(255,255,255,.55)";
      for (i = 0; i < 46; i++) { var aa = r() * Math.PI * 2, r0 = 380 + r() * 300 + ((t * 900 + r() * 400) % 300); ctx.lineWidth = 2 + r() * 5; ctx.beginPath(); ctx.moveTo(W / 2 + Math.cos(aa) * r0, H / 2 + Math.sin(aa) * r0); ctx.lineTo(W / 2 + Math.cos(aa) * (r0 + 260), H / 2 + Math.sin(aa) * (r0 + 260)); ctx.stroke(); }
    }
    ctx.restore();
  }



  /* ------------------------------------------------------------------ springs and morphs (Fluid core) */
  // Exact closed-form springs from @usefluid/motion (window.FLUID, MIT): the value at any frame is a pure
  // function of time, so seeking renders the same pixels.
  var FL = window.FLUID || null;
  var SPR = { snappy: { w: 22, z: 0.8 }, soft: { w: 13, z: 0.86 }, bouncy: { w: 17, z: 0.58 }, firm: { w: 32, z: 1 }, pop: { w: 20, z: 0.5 } };
  function springStep(x0, v0, target, w, z, t) {
    if (FL) return FL.stepSpring(x0, v0, target, w, z, t).x;
    return target + (x0 - target) * Math.exp(-w * z * t) * Math.cos(w * Math.sqrt(Math.max(0, 1 - z * z)) * t);
  }
  /** 0 → 1 on a spring that starts at t = 0. */
  function sp(t, cfg) { return t <= 0 ? 0 : springStep(0, 0, 1, (cfg || SPR.snappy).w, (cfg || SPR.snappy).z, t); }
  var MCACHE = {};
  /** Contour morph from path a to path b, t seconds after it starts (Metamorph, solved per point). */
  function morphPath(a, b, t, cfg) {
    cfg = cfg || { w: 14, z: 0.8, spread: 0.22, points: 120 };
    if (!FL || !FL.sampleContours) return t > 0.25 ? b : a;
    if (t <= 0) return a;
    var key = a + "|" + b + "|" + cfg.w, m = MCACHE[key];
    if (!m) {
      var n = cfg.points || 120, A = FL.sampleContours(a, n), B = FL.sampleContours(b, n), pairs = [];
      for (var k = 0; k < Math.max(A.length, B.length); k++) {
        var ca = A[k], cb = B[k], from, to;
        from = ca ? { x: ca.x, y: ca.y } : { x: new Float64Array(n).fill(cb.cx), y: new Float64Array(n).fill(cb.cy) };
        if (cb) {
          var best = 0, bc = Infinity;
          for (var off = 0; off < n; off += 2) { var c = 0; for (var i = 0; i < n; i += 4) { var j = (i + off) % n, dx = from.x[i] - cb.x[j], dy = from.y[i] - cb.y[j]; c += dx * dx + dy * dy; } if (c < bc) { bc = c; best = off; } }
          to = { x: new Float64Array(n), y: new Float64Array(n) };
          for (var i2 = 0; i2 < n; i2++) { var j2 = (i2 + best) % n; to.x[i2] = cb.x[j2]; to.y[i2] = cb.y[j2]; }
        } else {
          var cx = 0, cy = 0; for (var q = 0; q < n; q++) { cx += ca.x[q] / n; cy += ca.y[q] / n; }
          to = { x: new Float64Array(n).fill(cx), y: new Float64Array(n).fill(cy) };
        }
        var ws = new Float64Array(n);
        for (var r = 0; r < n; r++) { var an = (r / n) * Math.PI * 2, ph = k * 1.7; ws[r] = cfg.w * (1 + (cfg.spread || 0.22) * (0.6 * Math.sin(an * 2 + ph) + 0.4 * Math.sin(an * 5 + ph * 2))); }
        pairs.push({ from: from, to: to, w: ws });
      }
      m = MCACHE[key] = { pairs: pairs, n: n };
    }
    var d = "", done = true;
    m.pairs.forEach(function (pr) {
      for (var i = 0; i < m.n; i++) {
        var u = springStep(0, 0, 1, pr.w[i], cfg.z, t);
        if (Math.abs(1 - u) > 0.003) done = false;
        d += (i ? "L" : "M") + (pr.from.x[i] + (pr.to.x[i] - pr.from.x[i]) * u).toFixed(1) + " " + (pr.from.y[i] + (pr.to.y[i] - pr.from.y[i]) * u).toFixed(1);
      }
      d += "Z";
    });
    return done ? b : d;
  }
  var CHECK = "M30 62 L52 84 L92 38";

  /* ------------------------------------------------------------------ stick figures (drawn in code) */
  // Angles in degrees from straight down; positive = outward from the body. Forearms/shins are absolute.
  var STICK_POSES = {
    neutral: { aL: [10, 4], aR: [10, 4], lL: [6, 0], lR: [6, 0], lean: 0 },
    explaining: { aL: [12, 6], aR: [48, 120], lL: [7, 0], lR: [7, 0], lean: -2 },
    pointing: { aL: [10, 4], aR: [92, 92], lL: [8, 0], lR: [5, 0], lean: -4 },
    surprised: { aL: [140, 172], aR: [140, 172], lL: [12, 4], lR: [12, 4], lean: 3 },
    celebrating: { aL: [150, 128], aR: [150, 128], lL: [16, -8], lR: [16, -8], lean: 0 },
    thinking: { aL: [12, 6], aR: [30, 200], lL: [6, 0], lR: [6, 0], lean: 2 },
  };
  var STICK_HAIR = ["none", "spiky", "ponytail", "cap", "bun", "long"];
  function stickActor(opts) {
    var A = { shots: [], acts: [], talks: [], enters: [], hops: [], ink: opts.ink || "#1B1A22", fill: opts.fill || "#FFFFFF", accent: opts.accent || "#E63946", hair: opts.hair || "none", speaks: opts.speaks, jitter: opts.jitter || 0 };
    A.act = function (t, pose, expression) { A.acts.push({ t: t, pose: pose, expression: expression }); A.acts.sort(function (a, b) { return a.t - b.t; }); return A; };
    A.talk = function (from, to, poses) { A.talks.push({ from: from, to: to, poses: poses || ["explaining", "neutral"] }); return A; };
    A.enter = function (t, kind) { A.enters.push({ t: t, kind: kind || "pop" }); return A; };
    A.hop = function (t, h) { A.hops.push({ t: t, h: h || 18 }); return A; };
    A.shot = function () { return A; };
    function latestAct(t, key) { var v = null, at = 0; A.acts.forEach(function (a) { if (a.t <= t && a[key]) { v = a[key]; at = a.t; } }); return { v: v, t: at }; }
    function poseAt(t) {
      var base = latestAct(t, "pose"), pose = base.v || "neutral", since = base.t;
      for (var i = 0; i < A.talks.length; i++) {
        var k = A.talks[i]; if (t < k.from || t > k.to) continue;
        var n = 0; (T.words || []).forEach(function (w) { if (w.start >= k.from && w.start <= t) n++; });
        if (n) { var g = Math.floor((n - 1) / 3); pose = k.poses[g % k.poses.length]; since = Math.max(since, k.from + g * 0.6); }
      }
      return { pose: STICK_POSES[pose] ? pose : "neutral", since: since };
    }
    function mix(a, b, p) { return a + (b - a) * p; }
    function joints(t) {
      var cur = poseAt(t), prev = poseAt(Math.max(0, cur.since - 0.01)), p = clamp((t - cur.since) / 0.22, 0, 1), e = p * p * (3 - 2 * p);
      var A0 = STICK_POSES[prev.pose], B0 = STICK_POSES[cur.pose], out = {};
      ["aL", "aR", "lL", "lR"].forEach(function (k) { out[k] = [mix(A0[k][0], B0[k][0], e), mix(A0[k][1], B0[k][1], e)]; });
      out.lean = mix(A0.lean, B0.lean, e);
      return out;
    }
    function blink(t) { var r = rng(11), at = 0.6; while (at < t + 1) { if (t >= at && t < at + 0.1) return true; at += 2.4 + r() * 2.2; } return false; }
    A.draw = function (ctx, t) {
      var sh = A.shots[0] || { x: 540, y: 1500, scale: 5.5 }, h = sh.scale * BODY * (opts.landscape ? 1 : 0.82), x = sh.x, y = sh.y, alpha = 1, dx = 0, sy = 1;
      var firstEnter = A.enters.length ? Math.min.apply(null, A.enters.map(function (e) { return e.t; })) : -1;
      if (firstEnter >= 0 && t < firstEnter) return;
      A.enters.forEach(function (en) { var q = (t - en.t) / 0.45; if (q < 0 || q >= 1) return; if (en.kind === "left" || en.kind === "right") dx += (en.kind === "left" ? -1 : 1) * (1 - q * q * (3 - 2 * q)) * h * 1.6; else if (en.kind === "drop") y -= (1 - q) * (1 - q) * h * 1.8; else sy *= 0.3 + 0.7 * q + Math.sin(q * Math.PI) * 0.12; });
      A.hops.forEach(function (hp) { var q = (t - hp.t) / 0.42; if (q >= 0 && q < 1) y -= Math.sin(q * Math.PI) * hp.h * h / 120; });
      var speaking = !A.speaks || A.speaks(t), lv = speaking ? CRM.level(t) : 0;
      y -= lv * h * 0.012 + Math.sin(t * 2.1) * h * 0.004;
      var J = joints(t), f = Math.floor(t * 12);
      function jit(n) { return A.jitter ? (hash(f * 7.3 + n) - 0.5) * h * A.jitter : 0; }
      function dir(a, side) { var r = a * Math.PI / 180; return [side * Math.sin(r), Math.cos(r)]; }
      ctx.save();
      ctx.globalAlpha *= alpha;
      ctx.translate(x + dx, y); ctx.scale(1, sy);
      // Shadow.
      ctx.fillStyle = "rgba(0,0,0,.16)"; ctx.beginPath(); ctx.ellipse(0, 0, h * 0.2, h * 0.025, 0, 0, Math.PI * 2); ctx.fill();
      ctx.lineCap = "round"; ctx.lineJoin = "round"; ctx.strokeStyle = A.ink; ctx.lineWidth = Math.max(2, h * 0.03);
      var hip = [0, -0.42 * h], lean = J.lean * Math.PI / 180;
      var sho = [hip[0] + Math.sin(lean) * 0.26 * h, hip[1] - Math.cos(lean) * 0.26 * h];
      var neck = [sho[0] + Math.sin(lean) * 0.06 * h, sho[1] - Math.cos(lean) * 0.06 * h];
      var hc = [neck[0] + Math.sin(lean) * 0.12 * h, neck[1] - Math.cos(lean) * 0.12 * h], hr = 0.12 * h;
      function limb(start, a, side, l1, l2, n) {
        var d1 = dir(a[0], side), d2 = dir(a[1], side);
        var mid = [start[0] + d1[0] * l1 + jit(n), start[1] + d1[1] * l1 + jit(n + 1)], end = [mid[0] + d2[0] * l2 + jit(n + 2), mid[1] + d2[1] * l2 + jit(n + 3)];
        ctx.beginPath(); ctx.moveTo(start[0], start[1]); ctx.lineTo(mid[0], mid[1]); ctx.lineTo(end[0], end[1]); ctx.stroke();
        return end;
      }
      // Legs, torso, arms.
      var fL = limb(hip, J.lL, -1, 0.22 * h, 0.2 * h, 1), fR = limb(hip, J.lR, 1, 0.22 * h, 0.2 * h, 5);
      ctx.fillStyle = A.ink;
      [fL, fR].forEach(function (ft, i) { ctx.beginPath(); ctx.ellipse(ft[0] + (i ? 1 : -1) * h * 0.02, ft[1], h * 0.035, h * 0.016, 0, 0, Math.PI * 2); ctx.fill(); });
      ctx.beginPath(); ctx.moveTo(hip[0], hip[1]); ctx.lineTo(neck[0] + jit(9), neck[1]); ctx.stroke();
      var hL = limb(sho, J.aL, -1, 0.19 * h, 0.17 * h, 11), hR = limb(sho, J.aR, 1, 0.19 * h, 0.17 * h, 15);
      [hL, hR].forEach(function (hd) { ctx.beginPath(); ctx.arc(hd[0], hd[1], h * 0.022, 0, Math.PI * 2); ctx.fill(); });
      // Scarf in the character colour.
      ctx.strokeStyle = A.accent; ctx.lineWidth = Math.max(3, h * 0.04);
      ctx.beginPath(); ctx.moveTo(neck[0] - h * 0.05, neck[1] + h * 0.01); ctx.lineTo(neck[0] + h * 0.05, neck[1] + h * 0.01); ctx.lineTo(neck[0] + h * 0.07, neck[1] + h * 0.08); ctx.stroke();
      ctx.strokeStyle = A.ink; ctx.lineWidth = Math.max(2, h * 0.03);
      // Hair behind the head.
      ctx.fillStyle = A.ink;
      if (A.hair === "long") { ctx.beginPath(); ctx.moveTo(hc[0] - hr * 1.05, hc[1]); ctx.quadraticCurveTo(hc[0] - hr * 1.2, hc[1] + hr * 1.6, hc[0] - hr * 0.6, hc[1] + hr * 1.7); ctx.lineTo(hc[0] + hr * 0.6, hc[1] + hr * 1.7); ctx.quadraticCurveTo(hc[0] + hr * 1.2, hc[1] + hr * 1.6, hc[0] + hr * 1.05, hc[1]); ctx.fill(); }
      if (A.hair === "ponytail") { ctx.beginPath(); ctx.ellipse(hc[0] + hr * 1.15, hc[1] - hr * 0.2, hr * 0.32, hr * 0.62, -0.5, 0, Math.PI * 2); ctx.fill(); }
      if (A.hair === "bun") { ctx.beginPath(); ctx.arc(hc[0], hc[1] - hr * 1.15, hr * 0.38, 0, Math.PI * 2); ctx.fill(); }
      // Head.
      ctx.fillStyle = A.fill; ctx.beginPath(); ctx.arc(hc[0], hc[1], hr, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      if (A.hair === "spiky") { ctx.beginPath(); for (var k2 = -2; k2 <= 2; k2++) { var a2 = -Math.PI / 2 + k2 * 0.32; ctx.moveTo(hc[0] + Math.cos(a2) * hr, hc[1] + Math.sin(a2) * hr); ctx.lineTo(hc[0] + Math.cos(a2) * hr * 1.35, hc[1] + Math.sin(a2) * hr * 1.35); } ctx.stroke(); }
      if (A.hair === "cap") { ctx.fillStyle = A.accent; ctx.beginPath(); ctx.arc(hc[0], hc[1] - hr * 0.1, hr * 1.02, Math.PI, 0); ctx.fill(); ctx.stroke(); ctx.beginPath(); ctx.moveTo(hc[0], hc[1] - hr * 0.12); ctx.lineTo(hc[0] + hr * 1.55, hc[1] - hr * 0.05); ctx.stroke(); }
      if (A.hair === "long" || A.hair === "ponytail" || A.hair === "bun") { ctx.fillStyle = A.ink; ctx.beginPath(); ctx.arc(hc[0], hc[1] - hr * 0.05, hr * 1.02, Math.PI * 1.05, Math.PI * 1.95); ctx.quadraticCurveTo(hc[0], hc[1] - hr * 0.35, hc[0] - hr * 0.98, hc[1] - hr * 0.25); ctx.fill(); }
      // Face: eyes, brows, mouth.
      var expr = latestAct(t, "expression").v || "neutral", closed = blink(t);
      ctx.fillStyle = A.ink; ctx.strokeStyle = A.ink; ctx.lineWidth = Math.max(1.5, h * 0.016);
      [-1, 1].forEach(function (sd) {
        var ex = hc[0] + sd * hr * 0.38, ey = hc[1] - hr * 0.08;
        if (closed) { ctx.beginPath(); ctx.moveTo(ex - hr * 0.1, ey); ctx.lineTo(ex + hr * 0.1, ey); ctx.stroke(); }
        else { ctx.beginPath(); ctx.ellipse(ex, ey, hr * 0.085, hr * (expr === "surprised" ? 0.15 : 0.12), 0, 0, Math.PI * 2); ctx.fill(); }
        var by = ey - hr * (expr === "surprised" ? 0.36 : 0.27), tilt = expr === "serious" ? sd * 0.1 : expr === "thinking" && sd > 0 ? -0.12 : expr === "happy" ? -0.04 : 0;
        ctx.beginPath(); ctx.moveTo(ex - hr * 0.14, by + tilt * hr * -sd); ctx.lineTo(ex + hr * 0.14, by + tilt * hr * sd); ctx.stroke();
      });
      var my = hc[1] + hr * 0.45, mouth = speaking ? CRM.mouthAt(t) : "X", open = { X: 0, A: 0.05, B: 0.14, C: 0.22, D: 0.3, E: 0.18, F: 0.1 }[mouth] || 0;
      if (open > 0) { ctx.beginPath(); ctx.ellipse(hc[0], my, hr * (0.18 + open * 0.3), hr * open, 0, 0, Math.PI * 2); ctx.fill(); }
      else if (expr === "surprised") { ctx.beginPath(); ctx.ellipse(hc[0], my, hr * 0.1, hr * 0.13, 0, 0, Math.PI * 2); ctx.stroke(); }
      else if (expr === "serious" || expr === "thinking") { ctx.beginPath(); ctx.moveTo(hc[0] - hr * 0.18, my); ctx.lineTo(hc[0] + hr * (expr === "thinking" ? 0.08 : 0.18), my + (expr === "thinking" ? hr * 0.04 : 0)); ctx.stroke(); }
      else { ctx.beginPath(); ctx.arc(hc[0], my - hr * 0.14, hr * (expr === "happy" || expr === "confident" ? 0.26 : 0.18), Math.PI * 0.18, Math.PI * 0.82); ctx.stroke(); }
      ctx.restore();
    };
    return A;
  }

  /* ------------------------------------------------------------------ the film */
  var CRS = { looks: LOOKS, kit: KIT };

  CRS.resolveLook = function (spec) {
    spec = spec || {};
    var base = LOOKS[spec.preset] || LOOKS.vetor, look = {};
    for (var key in base) look[key] = base[key];
    look.preset = LOOKS[spec.preset] ? spec.preset : "vetor";
    look.palette = (spec.palette || []).filter(function (c) { return /^#[0-9a-f]{3,6}$/i.test(c); });
    look.paperColor = /^#[0-9a-f]{6}$/i.test(spec.paper || "") ? spec.paper : base.paperDefault || null;
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
    // On the beat: when the film has composed music, a cut close to a beat moves onto it (a little earlier
    // rather than later, so the picture never lags the voice).
    var BEAT = o.beat && o.beat.bpm ? 60 / o.beat.bpm : 0;
    if (BEAT) shots.forEach(function (s, i) {
      if (i === 0) return;
      var b = Math.round(s.start / BEAT) * BEAT, prev = shots[i - 1];
      if (b >= s.start - 0.2 && b <= s.start + 0.08 && b > prev.start + 0.4 && b < s.end - 0.4) { s.start = b; prev.end = b; }
    });
    // Word cues: {el, at} → the moment that word is spoken in the shot. Runs are consecutive shots on one set.
    function nw(x) { return String(x || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, ""); }
    var runN = 0, RUNCUES = {};
    shots.forEach(function (s, i) {
      if (i > 0 && shots[i - 1].set !== s.set) runN++;
      s._run = runN;
      s._cueT = (s.cues || []).map(function (c) {
        var key = nw(String(c.at || "").split(/\s+/)[0]), hit = null;
        (s.words || []).some(function (w) { var tx = nw(w.text); if (key && (tx === key || tx.indexOf(key) === 0)) { hit = w; return true; } return false; });
        return { el: c.el, t: hit ? hit.start : s.start + 0.25 };
      });
      var m = RUNCUES[runN] || (RUNCUES[runN] = {});
      s._cueT.forEach(function (c) { (m[c.el] = m[c.el] || []).push(c.t); });
    });
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
    var lightPaper = !!look.paperColor && lum(look.paperColor) > 0.62;
    // Soft shadows under living elements, for the clean looks (no boil, smooth frame rate).
    var SOFT_SHADOW = !look.boil && look.fps >= 30 && !look.quantize ? (lightPaper ? "rgba(22,24,40,.16)" : "rgba(0,0,0,.42)") : "";
    // Key words in the captions: the accent, lifted toward white when it would sink into a dark backing.
    var capKey = (function () {
      var darkBacking = look.text === "pixel" || look.text === "clean" || look.text === "neon" || look.text === "mono";
      if (!darkBacking || lum(accent) > 0.55) return accent;
      var c = hexRgb(accent); return "rgb(" + c.map(function (v) { return Math.round(v + (255 - v) * 0.55); }).join(",") + ")";
    })();
    root.style.background = look.paperColor || "#141318";

    // DOM: display canvas, text layer, flash.
    var css = document.createElement("style");
    css.textContent =
      "#crs-view{position:absolute;left:0;top:0;width:" + W + "px;height:" + H + "px}" +
      ".crs-t{position:absolute;z-index:30;visibility:hidden;opacity:0}" +
      ".crs-cap{text-wrap:balance;left:70px;right:70px;bottom:" + Math.round(H * 0.16) + "px;text-align:center;font:" + (look.text === "pixel" ? "400 54px/1.3" : look.text === "hand" ? "700 84px/1.05" : look.text === "comic" ? "400 82px/1.05" : look.text === "serif" ? "400 86px/1.02" : "600 74px/1.08") + " " + font + ";color:#fff;" +
        (look.text === "neon" ? "text-shadow:0 0 18px " + accent + ",0 0 40px " + accent + ";" : look.text === "pixel" ? "text-shadow:4px 4px 0 " + ink + ";" : "text-shadow:0 6px 0 rgba(0,0,0,.45), 0 0 26px rgba(0,0,0,.45);") + (look.text === "comic" ? "text-transform:uppercase;letter-spacing:1px;-webkit-text-stroke:3px " + ink + ";paint-order:stroke fill;" : "") + "}" +
      ".crs-cap .w{display:inline-block;opacity:0}.crs-cap .w.key{color:" + capKey + "}" +
      ".crs-cap .w{padding:" + (look.text === "pixel" ? ".16em .2em" : ".06em .17em") + ";margin:0;line-height:1.45;" +
        (look.text === "pixel" ? "background:" + ink + "E6;box-shadow:0 0 0 6px " + ink + "E6;" : look.text === "clean" || look.text === "neon" ? "background:rgba(10,10,20,.55);border-radius:18px;" : look.text === "comic" ? "background:#FFF6D6;color:" + ink + ";border:5px solid " + ink + ";text-shadow:none;-webkit-text-stroke:0;" : "background:rgba(255,253,246,.88);color:" + ink + ";border-radius:14px;text-shadow:none;") + "}" +
      ".crs-bub{max-width:" + (W - 160) + "px;padding:" + (look.text === "pixel" ? "26px 30px" : "28px 40px") + ";background:#FFFDF6;color:" + ink + ";font:" + (look.text === "pixel" ? "400 40px/1.35" : look.text === "hand" ? "700 64px/1.05" : look.text === "serif" ? "400 64px/1.05" : look.text === "comic" ? "400 60px/1.08" : "600 56px/1.12") + " " + font + ";" +
        (look.text === "pixel" ? "border:6px solid " + ink + ";box-shadow:8px 8px 0 " + ink + ";border-radius:0;" : look.text === "comic" ? "border:7px solid " + ink + ";border-radius:44px 52px 48px 40px;text-transform:uppercase;padding:32px 46px;" : "border:5px solid " + ink + ";border-radius:38px;box-shadow:0 12px 0 rgba(0,0,0,.18);") + "}" +
      ".crs-bub{text-wrap:balance;overflow-wrap:anywhere;box-sizing:border-box}.crs-bub span{display:block}" +
      ".crs-bub b{display:block;margin-bottom:8px;font-size:.55em;letter-spacing:2px;text-transform:uppercase;color:" + (look.palette[0] || accent) + "}" +
      ".crs-bub .w{display:inline-block}.crs-bub .w.on{color:" + ink + "}.crs-bub .w{color:" + ink + "99}" +
      ".crs-bub::after{content:'';position:absolute;bottom:-38px;left:var(--tail,90px);border:20px solid transparent;border-top:26px solid " + ink + "}" +
      ".crs-title{left:60px;right:60px;top:" + Math.round(H * 0.2) + "px;text-align:center;color:" + (lightPaper ? ink : "#fff") + ";font:" + (look.text === "pixel" ? "400 92px/1.15" : look.text === "hand" ? "700 150px/.95" : look.text === "serif" ? "400 150px/.95" : "400 140px/.98") + " " + (look.text === "clean" || look.text === "neon" || look.text === "comic" ? FONTS.Anton : font) + ";text-transform:" + (look.text === "serif" || look.text === "hand" ? "none" : "uppercase") + ";" +
        (look.text === "pixel" ? "text-shadow:6px 6px 0 " + ink + ";" : look.text === "neon" ? "text-shadow:0 0 20px " + accent + ",0 0 60px " + accent + ";" : lightPaper ? "text-shadow:0 4px 0 rgba(255,255,255,.9),0 0 22px rgba(255,255,255,.9);" : "text-shadow:0 10px 0 rgba(0,0,0,.35);") + "}" +
      ".crs-title small{display:block;font-size:.36em;letter-spacing:4px;margin-bottom:22px;color:" + accent + "}" +
      ".crs-sign{left:80px;right:80px;top:" + Math.round(H * 0.1) + "px;text-align:center;padding:22px 30px;background:" + accent + ";color:" + ink + ";font:" + (look.text === "pixel" ? "400 50px/1.25" : "400 70px/1.05") + " " + (look.text === "pixel" ? font : FONTS.Anton) + ";text-transform:uppercase;transform:rotate(-1.5deg);border:6px solid " + ink + "}" +
      ".crs-flash{position:absolute;inset:0;background:#fff;z-index:40;visibility:hidden;opacity:0}";
    document.head.appendChild(css);
    var view = document.createElement("canvas"); view.id = "crs-view"; view.width = W; view.height = H; root.appendChild(view);
    var vx = view.getContext("2d");
    var work = document.createElement("canvas"); work.width = W; work.height = H; var wx = work.getContext("2d");
    var prevC = document.createElement("canvas"); prevC.width = W; prevC.height = H; var px = prevC.getContext("2d");
    var tmpC = document.createElement("canvas"); tmpC.width = W; tmpC.height = H; var tx2 = tmpC.getContext("2d");
    var block = look.block || 0, small = null, sx = null, softC = null, softX = null, baseC = null, baseX = null;
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
    var stickAll = plan.characters === "palito" || (look.stick && plan.characters !== "pixel");
    if (plan.characters === "nenhum") names = [];
    names.forEach(function (name, i) {
      var pkg = (o.cast && o.cast[name]) || (o.fallback && o.fallback[i % o.fallback.length]);
      if (stickAll || pkg === "stick") {
        var pal = look.palette.length ? look.palette : ["#E63946", "#2A9D8F", "#F4A261", "#457B9D"];
        CAST[name] = stickActor({ ink: ink, fill: look.paperColor && lum(look.paperColor) < 0.35 ? "#F4F1EA" : "#FFFFFF", accent: pal[i % pal.length], hair: STICK_HAIR[i % STICK_HAIR.length], speaks: talking(name), jitter: look.boil ? 0.004 : 0, landscape: W > H });
        return;
      }
      if (!pkg || typeof pkg !== "object" || !o.engine || !window.CRM || !CRM.avatar) return;
      var A = CRM.avatar({ engine: o.engine, avatar: pkg, outline: look.outline === "accent" ? accent : ink, speaks: talking(name) });
      A.glow = false; A.shadow = true;
      CAST[name] = A;
    });
    shots.forEach(function (s, si) {
      var prev = shots[si - 1], prevCast = {}, prevProps = {};
      if (prev && prev.set === s.set) { (prev.cast || []).forEach(function (c) { prevCast[c.who] = 1; }); (prev.props || []).forEach(function (p2) { prevProps[p2.id] = 1; }); }
      s._prevProps = prevProps;
      var acted = {};
      (s.cast || []).forEach(function (c) {
        var A = CAST[c.who]; if (!A || acted[c.who]) return; acted[c.who] = 1;
        A.act(s.start, c.pose || (speaker(s.start + 0.01) === c.who ? "explaining" : "neutral"), c.expression || "neutral");
        if (speaker(s.start + 0.01) === c.who && !c.pose) A.talk(s.start, s.end, ["explaining", "neutral", "pointing"]);
        if (c.enter) A.enter(s.start + 0.05, c.enter);
        else if (!prevCast[c.who]) A.enter(s.start + 0.03, "pop");
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
        // A title sharing the shot with a graphic goes to the very top, smaller, above the card.
        if (s.text.kind === "sign" && s.ui && s.ui.kind === "island") el.style.top = Math.round(H * 0.17) + "px";
        if (s.graphic && s.text.kind !== "sign") { el.style.top = Math.round(H * 0.035) + "px"; el.style.fontSize = Math.round((look.text === "pixel" ? 92 : look.text === "hand" || look.text === "serif" ? 150 : 140) * 0.62) + "px"; }
        el.innerHTML = s.text.kind === "title"
          ? (s.text.kicker ? "<small>" + esc(s.text.kicker) + "</small>" : "") + s.text.content.split(/\s+/).map(function (w) { return '<span class="tw" style="display:inline-block">' + esc(w) + "</span>"; }).join(" ")
          : esc(s.text.content);
        root.appendChild(el);
        if (s.text.kind === "title") {
          tl.set(el, { autoAlpha: 1 }, t0 + 0.04);
          el.querySelectorAll(".tw").forEach(function (w, wi) { tl.fromTo(w, { y: 90, autoAlpha: 0, rotation: wi % 2 ? 5 : -5, scale: 0.7 }, { y: 0, autoAlpha: 1, rotation: 0, scale: 1, duration: 0.42, ease: "back.out(2.4)" }, t0 + 0.06 + wi * 0.075); });
        } else tl.fromTo(el, { autoAlpha: 0, y: -40, rotation: -6 }, { autoAlpha: 1, y: 0, rotation: -1.5, duration: 0.36, ease: "back.out(2.6)" }, t0 + 0.05);
        tl.to(el, { autoAlpha: 0, duration: 0.15 }, Math.max(t0 + 0.4, t1 - 0.15));
        lastTitleAt = si;
      }
      var who = s.who && !/^narrador/i.test(s.who) ? s.who : null;
      if (who && s.words.length && o.bubbles !== false) {
        var b = document.createElement("div"); b.className = "crs-t crs-bub";
        b.innerHTML = "<b>" + esc(who) + "</b><span>" + s.words.map(function (w) { return '<i class="w">' + esc(w.text) + "</i>"; }).join(" ") + "</span>";
        // Size the bubble to its text: smaller type for long lines, a width that keeps 2-4 balanced lines.
        var said = s.words.map(function (w) { return w.text; }).join(" "), nWords = s.words.length;
        var baseSize = look.text === "pixel" ? 40 : look.text === "hand" ? 64 : look.text === "serif" ? 64 : look.text === "comic" ? 60 : 56;
        var fsz = Math.round(baseSize * (nWords <= 7 ? 1 : nWords <= 12 ? 0.88 : nWords <= 18 ? 0.76 : 0.66));
        var fam = look.text === "pixel" ? FONTS.Silkscreen : look.text === "hand" ? FONTS.Caveat : look.text === "serif" ? FONTS.InstrumentSerif : look.text === "comic" ? FONTS.Anton : font;
        var maxBw = Math.min(W - 100, W > H ? 900 : 880), oneLine = textWidth(look.text === "comic" ? said.toUpperCase() : said, "600 " + fsz + "px " + fam) + 100;
        var bw = Math.round(clamp(oneLine <= maxBw ? oneLine : Math.max(oneLine / Math.ceil(oneLine / maxBw), maxBw * 0.72), 300, maxBw));
        b.style.fontSize = fsz + "px"; b.style.width = bw + "px"; b.style.maxWidth = "none";
        var c = (s.cast || []).filter(function (x) { return x.who === who; })[0];
        var set = SETS[s.set], k = H / set.h;
        var cam = camAt(s, set, 0.5, W, H);
        var screenX = c ? (c.x * k - cam.x) * cam.z + W / 2 : W / 2;
        var headY = c ? ((c.y * k - (SIZE[c.size] || SIZE.m) * BODY * H / 1920) - cam.y) * cam.z + H / 2 : H * 0.4;
        // Anchored by its bottom just above the head, so a longer text grows upward and never covers the face.
        var bottom = Math.round(clamp(H - (headY - 50), H * 0.45, H * 0.93));
        var left = clamp(screenX - bw * 0.35, 40, W - 40 - bw);
        b.style.left = left + "px"; b.style.top = "auto"; b.style.bottom = bottom + "px"; b.style.maxHeight = Math.round(H - bottom - H * 0.03) + "px";
        b.style.setProperty("--tail", clamp(screenX - left - 20, 50, bw - 70) + "px");
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
        g.forEach(function (w, wi) { tl.fromTo(ws[wi], { opacity: 0, y: 14 }, { opacity: 1, y: 0, duration: 0.16, ease: "power2.out" }, Math.max(start, w.start - 0.04)); });
        tl.set(el, { autoAlpha: 0 }, next);
      });
    }

    /* ------------------------------ data graphics (crisp, over the scene) */
    var dark = lum(look.paperColor || "#141318") < 0.4;
    var gcss = document.createElement("style");
    var cardBg = look.text === "pixel" ? ink : look.text === "neon" ? "rgba(12,8,30,.82)" : look.text === "mono" ? "rgba(6,10,8,.84)" : dark ? "rgba(18,18,28,.86)" : "#FFFFFF";
    var cardFg = look.text === "pixel" || look.text === "neon" || look.text === "mono" || dark ? "#F7F5EF" : ink;
    var gFont = look.text === "hand" ? FONTS.Caveat : look.text === "pixel" ? FONTS.Silkscreen : look.text === "mono" ? FONTS.JetBrains : look.text === "serif" ? FONTS.InstrumentSerif : FONTS.Fredoka;
    var gNum = look.text === "pixel" ? FONTS.Silkscreen : look.text === "hand" ? FONTS.Caveat : look.text === "mono" ? FONTS.JetBrains : FONTS.Anton;
    var GW = Math.min(W * 0.84, 900), unit = Math.min(W, H) / 1080;
    gcss.textContent =
      ".crs-g{position:absolute;z-index:32;left:50%;top:" + Math.round(H * (W > H ? 0.1 : 0.12)) + "px;width:" + Math.round(GW) + "px;margin-left:" + Math.round(-GW / 2) + "px;visibility:hidden;opacity:0;font-family:" + gFont + ";color:" + cardFg + "}" +
      ".crs-g .card{background:" + cardBg + ";padding:" + Math.round(34 * unit) + "px " + Math.round(40 * unit) + "px;" + (look.text === "pixel" ? "border:6px solid " + accent + ";box-shadow:10px 10px 0 " + accent + ";" : look.text === "hand" ? "border:4px solid " + ink + ";border-radius:28px 34px 26px 38px;box-shadow:6px 8px 0 " + ink + "22;" : look.text === "neon" ? "border:3px solid " + accent + ";border-radius:26px;box-shadow:0 0 30px " + accent + "88;" : "border-radius:30px;box-shadow:0 24px 60px rgba(0,0,0,.28);") + "}" +
      ".crs-g h3{margin:0 0 " + Math.round(18 * unit) + "px;font:400 " + Math.round(44 * unit) + "px/1.1 " + gFont + ";opacity:.8;text-transform:" + (look.text === "hand" || look.text === "serif" ? "none" : "uppercase") + ";letter-spacing:1px}" +
      ".crs-g .num{font:400 " + Math.round(170 * unit) + "px/1 " + gNum + ";color:" + accent + ";letter-spacing:-1px}" +
      ".crs-g .lab{font-size:" + Math.round(46 * unit) + "px;line-height:1.15;margin-top:" + Math.round(10 * unit) + "px}" +
      ".crs-g .row{display:flex;align-items:center;gap:" + Math.round(18 * unit) + "px;margin:" + Math.round(16 * unit) + "px 0;font-size:" + Math.round(46 * unit) + "px;line-height:1.1;visibility:hidden;opacity:0}" +
      ".crs-g .bar{flex:1;height:" + Math.round(34 * unit) + "px;border-radius:99px;background:" + (dark || cardBg !== "#FFFFFF" ? "rgba(255,255,255,.14)" : "rgba(0,0,0,.08)") + ";overflow:hidden}.crs-g .bar i{display:block;height:100%;width:0;background:" + accent + ";border-radius:99px}" +
      ".crs-g .val{min-width:" + Math.round(120 * unit) + "px;text-align:right;font-family:" + gNum + "}" +
      ".crs-g .box{flex:none;width:" + Math.round(52 * unit) + "px;height:" + Math.round(52 * unit) + "px;border-radius:12px;border:4px solid currentColor;display:grid;place-items:center;font-size:" + Math.round(40 * unit) + "px;color:" + accent + "}.crs-g .row span{color:" + cardFg + "}" +
      ".crs-g .cols{display:flex;gap:" + Math.round(26 * unit) + "px;align-items:flex-end}.crs-g .col{flex:1;text-align:center}.crs-g .col .pillar{margin:" + Math.round(14 * unit) + "px auto 0;width:70%;height:0;border-radius:18px 18px 6px 6px}" +
      ".crs-g .col .v{font:400 " + Math.round(96 * unit) + "px/1 " + gNum + "}.crs-g .col .l{font-size:" + Math.round(40 * unit) + "px;margin-top:8px;opacity:.85}" +
      ".crs-g .toast{display:flex;gap:" + Math.round(20 * unit) + "px;align-items:center;background:" + cardBg + ";color:" + cardFg + ";padding:" + Math.round(22 * unit) + "px " + Math.round(28 * unit) + "px;border-radius:26px;margin-bottom:" + Math.round(16 * unit) + "px;box-shadow:0 14px 40px rgba(0,0,0,.25);visibility:hidden;opacity:0}" +
      ".crs-g .toast .ic{flex:none;width:" + Math.round(70 * unit) + "px;height:" + Math.round(70 * unit) + "px;border-radius:18px;background:" + accent + ";display:grid;place-items:center;color:" + ink + ";font:400 " + Math.round(40 * unit) + "px " + gNum + "}" +
      ".crs-g .toast b{display:block;font-size:" + Math.round(40 * unit) + "px}.crs-g .toast small{display:block;font-size:" + Math.round(34 * unit) + "px;opacity:.75}" +
      ".crs-g .steps{display:flex;flex-direction:column;gap:" + Math.round(14 * unit) + "px}.crs-g .steps .row{margin:0}.crs-g .steps .n{flex:none;width:" + Math.round(70 * unit) + "px;height:" + Math.round(70 * unit) + "px;border-radius:50%;background:" + accent + ";color:" + ink + ";display:grid;place-items:center;font:400 " + Math.round(40 * unit) + "px " + gNum + "}" +
      ".crs-g .q{font:400 " + Math.round(66 * unit) + "px/1.15 " + (look.text === "hand" ? FONTS.Caveat : FONTS.InstrumentSerif) + ";font-style:italic}.crs-g .q:before{content:'\\201C';display:block;font-size:2em;line-height:.6;color:" + accent + "}.crs-g .who{margin-top:" + Math.round(18 * unit) + "px;font-size:" + Math.round(38 * unit) + "px;opacity:.8}";
    document.head.appendChild(gcss);
    function fmt(v, decimals) { return Number(v).toLocaleString("pt-BR", { minimumFractionDigits: decimals, maximumFractionDigits: decimals }); }
    function decimalsOf(v) { var m = String(v).split(".")[1]; return m ? Math.min(2, m.length) : 0; }
    function counter(el, from, to, at, dur, pre, suf) {
      var d = decimalsOf(to), o2 = { v: from };
      el.textContent = (pre || "") + fmt(from, d) + (suf || "");
      tl.to(o2, { v: to, duration: dur, ease: "power2.out", onUpdate: function () { el.textContent = (pre || "") + fmt(o2.v, d) + (suf || ""); } }, at);
    }
    /** When each item of a graphic appears: spread over the shot, like the sound cues. */
    CRS.graphicTimes = function (n, start, end) { var span = Math.max(0.6, end - start - 0.6), out = []; for (var i = 0; i < n; i++) out.push(start + 0.25 + (n > 1 ? i * span / n : 0)); return out; };
    shots.forEach(function (s) {
      var g = s.graphic; if (!g) return;
      var el = document.createElement("div"); el.className = "crs-g";
      if (s.text && s.text.kind === "title") el.style.top = Math.round(H * (W > H ? 0.3 : 0.2)) + "px";
      var items = (g.items || []).slice(0, 5), times = CRS.graphicTimes(Math.max(1, items.length), s.start, s.end), t0 = s.start + 0.08;
      var html = "";
      if (g.kind === "stat") html = '<div class="card">' + (g.title ? "<h3>" + esc(g.title) + "</h3>" : "") + '<div class="num">0</div>' + (g.label ? '<div class="lab">' + esc(g.label) + "</div>" : "") + "</div>";
      else if (g.kind === "compare") html = '<div class="card">' + (g.title ? "<h3>" + esc(g.title) + "</h3>" : "") + '<div class="cols">' + [g.before, g.after].map(function (c, i) { return '<div class="col"><div class="v" style="color:' + (i ? accent : cardFg) + '">' + (c && c.value != null ? "0" : "") + '</div><div class="pillar" style="background:' + (i ? accent : (dark ? "rgba(255,255,255,.25)" : "rgba(0,0,0,.18)")) + '"></div><div class="l">' + esc((c && c.label) || (i ? "Depois" : "Antes")) + "</div></div>"; }).join("") + "</div></div>";
      else if (g.kind === "bars") html = '<div class="card">' + (g.title ? "<h3>" + esc(g.title) + "</h3>" : "") + items.map(function (it) { return '<div class="row"><span style="min-width:34%">' + esc(it.label) + '</span><div class="bar"><i></i></div><span class="val">' + (it.value != null ? "0" : "") + "</span></div>"; }).join("") + "</div>";
      else if (g.kind === "checklist") html = '<div class="card">' + (g.title ? "<h3>" + esc(g.title) + "</h3>" : "") + items.map(function (it) { return '<div class="row"><div class="box"><b style="opacity:0">✓</b></div><span>' + esc(it.label) + "</span></div>"; }).join("") + "</div>";
      else if (g.kind === "notifications") html = items.map(function (it) { return '<div class="toast"><div class="ic">' + esc((g.icon || "★").slice(0, 2)) + '</div><div><b>' + esc(it.label) + "</b>" + (it.note ? "<small>" + esc(it.note) + "</small>" : "") + "</div></div>"; }).join("");
      else if (g.kind === "steps") html = '<div class="card">' + (g.title ? "<h3>" + esc(g.title) + "</h3>" : "") + '<div class="steps">' + items.map(function (it, i) { return '<div class="row"><div class="n">' + (i + 1) + "</div><span>" + esc(it.label) + "</span></div>"; }).join("") + "</div></div>";
      else if (g.kind === "quote") html = '<div class="card"><div class="q">' + esc(g.quote || (items[0] && items[0].label) || "") + "</div>" + (g.author ? '<div class="who">— ' + esc(g.author) + "</div>" : "") + "</div>";
      if (!html) return;
      el.innerHTML = html; root.appendChild(el);
      tl.fromTo(el, { autoAlpha: 0, y: 40, scale: 0.92 }, { autoAlpha: 1, y: 0, scale: 1, duration: 0.32, ease: "back.out(1.8)" }, t0);
      tl.to(el, { autoAlpha: 0, y: -20, duration: 0.18 }, Math.max(t0 + 0.5, s.end - 0.18));
      var dur = Math.max(0.6, s.end - s.start);
      if (g.kind === "stat") {
        // A long prefix or suffix ("Mais de ", " pedidos") shrinks the figure so the line fits the card.
        var statNum = el.querySelector(".num"), statLen = ((g.prefix || "") + fmt(g.value != null ? g.value : 0, decimalsOf(g.value || 0)) + (g.suffix || "")).length;
        statNum.style.fontSize = Math.round(Math.min(170 * unit, (GW - 90 * unit) / Math.max(1, statLen * 0.5))) + "px"; statNum.style.whiteSpace = "nowrap";
        counter(statNum, g.from || 0, g.value != null ? g.value : 0, t0 + 0.15, Math.min(1.6, dur * 0.6), g.prefix, g.suffix);
      }
      if (g.kind === "compare") {
        var vs = el.querySelectorAll(".col .v"), ps = el.querySelectorAll(".pillar"), b = g.before || {}, a = g.after || {}, mx = Math.max(Math.abs(b.value || 0), Math.abs(a.value || 0), 1);
        [b, a].forEach(function (c, i) {
          var at = t0 + 0.2 + i * Math.min(1.2, dur * 0.35);
          if (c.value != null) counter(vs[i], 0, c.value, at, 0.8, g.prefix, g.suffix);
          tl.fromTo(ps[i], { height: 0 }, { height: Math.round((40 + 260 * Math.abs(c.value || 0) / mx) * unit), duration: 0.7, ease: "power3.out" }, at);
        });
      }
      if (g.kind === "bars") el.querySelectorAll(".row").forEach(function (row, i) {
        var it = items[i]; tl.fromTo(row, { autoAlpha: 0, x: -30 }, { autoAlpha: 1, x: 0, duration: 0.25 }, times[i]);
        tl.fromTo(row.querySelector(".bar i"), { width: "0%" }, { width: clamp(it.value != null ? it.value : 60, 0, 100) + "%", duration: 0.8, ease: "power3.out" }, times[i] + 0.1);
        if (it.value != null) counter(row.querySelector(".val"), 0, it.value, times[i] + 0.1, 0.8, "", g.suffix != null ? g.suffix : "%");
      });
      if (g.kind === "checklist") el.querySelectorAll(".row").forEach(function (row, i) {
        tl.fromTo(row, { autoAlpha: 0, x: -24 }, { autoAlpha: 1, x: 0, duration: 0.22 }, times[i]);
        tl.fromTo(row.querySelector(".box b"), { opacity: 0, scale: 2 }, { opacity: 1, scale: 1, duration: 0.25, ease: "back.out(3)" }, times[i] + 0.18);
      });
      if (g.kind === "notifications") el.querySelectorAll(".toast").forEach(function (row, i) { tl.fromTo(row, { autoAlpha: 0, y: -60, scale: 0.9 }, { autoAlpha: 1, y: 0, scale: 1, duration: 0.3, ease: "back.out(2)" }, times[i]); });
      if (g.kind === "steps") el.querySelectorAll(".row").forEach(function (row, i) { tl.fromTo(row, { autoAlpha: 0, x: 40 }, { autoAlpha: 1, x: 0, duration: 0.28, ease: "back.out(2)" }, times[i]); });
    });

    /* ------------------------------ Motion UI components (springs, updated every frame) */
    var UIS = [], uu = unit * (W > H ? 1.15 : 1.4), BIGFS = Math.round(Math.min(W, H) * (W > H ? 0.1 : 0.108));
    var ucss = document.createElement("style");
    var uiDark = cardBg !== "#FFFFFF", uiMuted = uiDark ? "rgba(255,255,255,.12)" : "rgba(0,0,0,.07)";
    ucss.textContent =
      ".crs-ui{position:absolute;z-index:33;left:0;top:0;width:" + W + "px;height:" + H + "px;pointer-events:none;visibility:hidden;font-family:" + gFont + ";color:" + cardFg + "}" +
      ".crs-ui .isl{position:absolute;left:50%;top:" + Math.round(H * 0.045) + "px;transform:translateX(-50%);background:#0A0A0F;color:#fff;border-radius:999px;overflow:hidden;display:flex;align-items:center;gap:" + Math.round(22 * uu) + "px;box-shadow:0 18px 50px rgba(0,0,0,.35)}" +
      ".crs-ui .isl .ic{flex:none;width:" + Math.round(84 * uu) + "px;height:" + Math.round(84 * uu) + "px;border-radius:50%;background:" + accent + ";color:" + ink + ";display:grid;place-items:center;font:400 " + Math.round(44 * uu) + "px " + gNum + "}" +
      ".crs-ui .isl b{display:block;font-size:" + Math.round(42 * uu) + "px;white-space:nowrap}.crs-ui .isl small{display:block;font-size:" + Math.round(32 * uu) + "px;opacity:.7;white-space:nowrap}" +
      ".crs-ui .phone{position:absolute;left:50%;transform:translateX(-50%);top:" + Math.round(H * (W > H ? 0.08 : 0.1)) + "px;width:" + Math.round(Math.min(W * 0.68, H * 0.48)) + "px;height:" + Math.round(H * (W > H ? 0.76 : 0.5)) + "px;background:" + cardBg + ";border-radius:" + Math.round(56 * uu) + "px;box-shadow:0 30px 80px rgba(0,0,0,.35);border:" + Math.round(12 * uu) + "px solid #0A0A0F;overflow:hidden;display:flex;flex-direction:column}" +
      ".crs-ui .phone .hd{padding:" + Math.round(26 * uu) + "px;display:flex;gap:" + Math.round(16 * uu) + "px;align-items:center;border-bottom:1px solid " + uiMuted + ";font-size:" + Math.round(36 * uu) + "px}.crs-ui .phone .hd i{width:" + Math.round(56 * uu) + "px;height:" + Math.round(56 * uu) + "px;border-radius:50%;background:" + accent + "}" +
      ".crs-ui .phone .msgs{flex:1;display:flex;flex-direction:column;justify-content:flex-end;gap:" + Math.round(14 * uu) + "px;padding:" + Math.round(24 * uu) + "px}" +
      ".crs-ui .msg{max-width:78%;padding:" + Math.round(18 * uu) + "px " + Math.round(24 * uu) + "px;border-radius:" + Math.round(30 * uu) + "px;font-size:" + Math.round(36 * uu) + "px;line-height:1.2}.crs-ui .msg.them{align-self:flex-start;background:" + uiMuted + ";border-bottom-left-radius:8px;transform-origin:0 100%}.crs-ui .msg.me{align-self:flex-end;background:" + accent + ";color:" + ink + ";border-bottom-right-radius:8px;transform-origin:100% 100%}" +
      ".crs-ui .dots{align-self:flex-start;background:" + uiMuted + ";padding:" + Math.round(20 * uu) + "px " + Math.round(26 * uu) + "px;border-radius:" + Math.round(30 * uu) + "px;display:flex;gap:" + Math.round(10 * uu) + "px}.crs-ui .dots i{width:" + Math.round(16 * uu) + "px;height:" + Math.round(16 * uu) + "px;border-radius:50%;background:currentColor;opacity:.6}" +
      ".crs-ui .btn{position:absolute;left:50%;top:" + Math.round(H * (W > H ? 0.36 : 0.3)) + "px;height:" + Math.round(150 * uu) + "px;border-radius:999px;background:" + accent + ";color:" + ink + ";display:grid;place-items:center;font:400 " + Math.round(58 * uu) + "px " + gNum + ";white-space:nowrap;overflow:hidden;box-shadow:0 22px 50px rgba(0,0,0,.3)}" +
      ".crs-ui .ripple{position:absolute;border-radius:50%;border:" + Math.round(6 * uu) + "px solid " + accent + "}.crs-ui .cursor{position:absolute;width:" + Math.round(90 * uu) + "px;filter:drop-shadow(0 8px 12px rgba(0,0,0,.35))}" +
      ".crs-ui .ok{position:absolute;left:50%;transform:translateX(-50%);width:max-content;max-width:" + Math.round(W * (W > H ? 0.3 : 0.5)) + "px;box-sizing:border-box;padding:" + Math.round(16 * uu) + "px " + Math.round(28 * uu) + "px;border-radius:" + Math.round(28 * uu) + "px;background:" + cardBg + ";color:" + cardFg + ";box-shadow:0 14px 40px rgba(0,0,0,.18);text-wrap:balance;line-height:1.15;text-align:center;top:" + Math.round(H * (W > H ? 0.36 : 0.3) + 190 * uu) + "px;font-size:" + Math.round(44 * uu) + "px}" +
      ".crs-ui .card{position:absolute;left:50%;transform:translateX(-50%);top:" + Math.round(H * 0.12) + "px;width:" + Math.round(GW) + "px;background:" + cardBg + ";border-radius:" + Math.round(40 * uu) + "px;padding:" + Math.round(30 * uu) + "px " + Math.round(36 * uu) + "px;box-shadow:0 24px 60px rgba(0,0,0,.28)}" +
      ".crs-ui .row{display:flex;align-items:center;justify-content:space-between;gap:" + Math.round(18 * uu) + "px;padding:" + Math.round(18 * uu) + "px 0;font-size:" + Math.round(44 * uu) + "px}.crs-ui .sw{position:relative;flex:none;width:" + Math.round(128 * uu) + "px;height:" + Math.round(70 * uu) + "px;border-radius:999px}.crs-ui .sw i{position:absolute;top:" + Math.round(7 * uu) + "px;left:" + Math.round(7 * uu) + "px;width:" + Math.round(56 * uu) + "px;height:" + Math.round(56 * uu) + "px;border-radius:50%;background:#fff;box-shadow:0 4px 10px rgba(0,0,0,.25)}" +
      ".crs-ui .tabs{position:relative;display:flex;background:" + uiMuted + ";border-radius:999px;padding:" + Math.round(10 * uu) + "px}.crs-ui .tabs span{position:relative;z-index:1;flex:1;text-align:center;padding:" + Math.round(20 * uu) + "px 0;font-size:" + Math.round(38 * uu) + "px;white-space:nowrap}.crs-ui .tabs .pill{position:absolute;top:" + Math.round(10 * uu) + "px;bottom:" + Math.round(10 * uu) + "px;border-radius:999px;background:" + accent + "}.crs-ui .tabnote{margin-top:" + Math.round(26 * uu) + "px;font-size:" + Math.round(46 * uu) + "px;min-height:1.2em}" +
      ".crs-ui .big{position:absolute;left:50%;transform:translateX(-50%);width:max-content;max-width:" + Math.round(W * 0.84) + "px;text-wrap:balance;top:" + Math.round(H * (W > H ? 0.22 : 0.18)) + "px;text-align:center;font:400 " + BIGFS + "px/1.04 " + (look.text === "clean" || look.text === "neon" ? FONTS.Anton : gNum) + ";color:" + (lightPaper ? ink : "#fff") + ";padding:" + Math.round(26 * uu) + "px " + Math.round(30 * uu) + "px;border-radius:" + Math.round(44 * uu) + "px;background:" + (lightPaper ? "rgba(255,255,255,.88)" : "rgba(8,8,18,.62)") + ";box-shadow:0 18px 50px rgba(0,0,0,.18)}" +
      ".crs-ui .big .w{display:inline-block;margin:0 .12em}.crs-ui .big .acc{color:" + accent + "}.crs-ui .slot{display:inline-block;overflow:hidden;vertical-align:bottom;height:1.08em;position:relative;text-align:left}.crs-ui .slot b{position:absolute;left:0;top:0;white-space:nowrap;font-weight:400;color:" + accent + "}" +
      ".crs-ui .splash{position:absolute;left:50%;top:" + Math.round(H * (W > H ? 0.14 : 0.2)) + "px;transform:translateX(-50%)}.crs-ui .splash svg{display:block}.crs-ui .splash .name{position:absolute;left:0;right:0;text-align:center;font:400 " + Math.round(86 * uu) + "px " + FONTS.Anton + ";color:" + ink + "}" +
      ".crs-ui .l3{position:absolute;left:" + Math.round(W * 0.06) + "px;top:" + Math.round(H * (W > H ? 0.66 : 0.62)) + "px;display:flex;align-items:stretch;overflow:hidden;border-radius:" + Math.round(18 * uu) + "px;box-shadow:0 18px 44px rgba(0,0,0,.3)}" +
      ".crs-ui .l3 .bar{flex:none;width:" + Math.round(16 * uu) + "px;background:" + accent + "}.crs-ui .l3 .tx{background:" + cardBg + ";padding:" + Math.round(20 * uu) + "px " + Math.round(34 * uu) + "px}" +
      ".crs-ui .l3 b{display:block;font:400 " + Math.round(58 * uu) + "px/1.05 " + gNum + ";white-space:nowrap}.crs-ui .l3 small{display:block;font-size:" + Math.round(34 * uu) + "px;opacity:.72;white-space:nowrap;margin-top:" + Math.round(6 * uu) + "px}" +
      ".crs-ui .cd{position:absolute;left:50%;top:" + Math.round(H * (W > H ? 0.14 : 0.18)) + "px;transform:translateX(-50%);text-align:center}.crs-ui .cd .lab{font-size:" + Math.round(46 * uu) + "px;margin-bottom:" + Math.round(18 * uu) + "px;color:" + (lightPaper ? ink : "#fff") + "}" +
      ".crs-ui .cd .ring{position:relative;margin:0 auto}.crs-ui .cd .ring svg{position:absolute;left:0;top:0}.crs-ui .cd .num{position:absolute;inset:0;display:grid;place-items:center;font:400 " + Math.round(220 * uu) + "px/1 " + (look.text === "clean" || look.text === "neon" ? FONTS.Anton : gNum) + ";color:" + (lightPaper ? ink : "#fff") + "}" +
      ".crs-ui .fol{position:absolute;left:50%;top:" + Math.round(H * (W > H ? 0.3 : 0.32)) + "px;transform:translateX(-50%);max-width:" + Math.round(W * 0.92) + "px;box-sizing:border-box;display:flex;align-items:center;gap:" + Math.round(18 * uu) + "px;background:" + cardBg + ";padding:" + Math.round(22 * uu) + "px " + Math.round(26 * uu) + "px;border-radius:999px;box-shadow:0 24px 60px rgba(0,0,0,.3)}" +
      ".crs-ui .fol .av{flex:none;width:" + Math.round(88 * uu) + "px;height:" + Math.round(88 * uu) + "px;border-radius:50%;background:" + accent + ";color:" + ink + ";display:grid;place-items:center;font:400 " + Math.round(56 * uu) + "px " + gNum + "}" +
      ".crs-ui .fol .who{font-size:" + Math.round(36 * uu) + "px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0;padding-right:" + Math.round(8 * uu) + "px}.crs-ui .fol .go{flex:none;border-radius:999px;padding:" + Math.round(18 * uu) + "px " + Math.round(30 * uu) + "px;font:400 " + Math.round(38 * uu) + "px " + gNum + ";white-space:nowrap}" +
      ".crs-ui .fol .bell{flex:none;font-size:" + Math.round(50 * uu) + "px;transform-origin:50% 10%}" +
      ".crs-ui.on .phone{border:0;box-shadow:none;border-radius:" + Math.round(24 * uu) + "px}.crs-ui.on .isl{box-shadow:none}" +
      ".crs-ui .loader{position:absolute;left:50%;top:" + Math.round(H * (W > H ? 0.2 : 0.22)) + "px;transform:translateX(-50%);text-align:center}.crs-ui .loader .lab{margin-top:" + Math.round(26 * uu) + "px;font-size:" + Math.round(50 * uu) + "px;white-space:nowrap}";
    document.head.appendChild(ucss);
    var SVGNS = "http://www.w3.org/2000/svg";
    function shapeSvg(size, fill) {
      var svg = document.createElementNS(SVGNS, "svg"); svg.setAttribute("viewBox", "0 0 120 120"); svg.setAttribute("width", size); svg.setAttribute("height", size);
      var path = document.createElementNS(SVGNS, "path"); path.setAttribute("fill", fill); svg.appendChild(path);
      return { svg: svg, path: path };
    }
    function vis(el, s, t, fadeIn) {
      var on = t >= s.start && t < s.end;
      el.style.visibility = on ? "visible" : "hidden";
      if (on) {
        el.style.opacity = String(clamp(Math.min((t - s.start) / (fadeIn || 0.12), (s.end - t) / 0.15), 0, 1));
        // Float: a slow bob and tilt that never stops, plus a slight push with the shot.
        var lt = t - s.start, pr = clamp(lt / Math.max(0.5, s.end - s.start), 0, 1);
        el.style.transform = "translate(" + (Math.sin(lt * 1.1) * 6 * uu) + "px," + (Math.sin(lt * 1.7) * 9 * uu) + "px) rotate(" + (Math.sin(lt * 0.9) * 0.6) + "deg) scale(" + (1 + pr * 0.04) + ")";
        el.style.transformOrigin = "50% 30%";
      }
      return on;
    }
    /** Item times inside a shot (same rule as the graphics and the sound cues). */
    function uiTimes(n, s) { return CRS.graphicTimes(Math.max(1, n), s.start, s.end); }
    var BRAND_NAME = (window.BRAND && window.BRAND.name) || "";
    shots.forEach(function (s) {
      var u = s.ui; if (!u) return;
      var box = document.createElement("div"); box.className = "crs-ui"; root.appendChild(box); s._uiBox = box;
      var items = (u.items || []).slice(0, 5), times = uiTimes(items.length || 1, s), dur = Math.max(0.6, s.end - s.start);
      // ui.on: the component lives inside a drawn element (the chat in the phone, the button in the browser).
      var onEl = u.on && SETS[s.set] && SETS[s.set].els && SETS[s.set].els[u.on] ? u.on : null;
      if (onEl) box.classList.add("on");
      if (u.kind === "island") {
        var isl = document.createElement("div"); isl.className = "isl"; box.appendChild(isl);
        var list = items.length ? items : [{ label: u.text || "Novo pedido", note: "" }];
        var maxW = Math.min(W * 0.88, 900 * uu), h0 = 64 * uu, h1 = 132 * uu;
        UIS.push(function (t) {
          if (!vis(box, s, t)) return;
          var k = 0; for (var i = 0; i < list.length; i++) if (t >= times[i]) k = i;
          var ti = times[k], next = times[k + 1] != null ? times[k + 1] : s.end + 1;
          var open = sp(t - ti, SPR.bouncy) * (1 - sp(t - (next - 0.32), SPR.firm));
          var w = h0 + (maxW - h0) * open, h = h0 + (h1 - h0) * open;
          isl.style.width = w + "px"; isl.style.height = h + "px"; isl.style.padding = "0 " + (24 * uu * open) + "px";
          var it = list[k];
          if (isl._k !== k) { isl._k = k; isl.innerHTML = '<div class="ic">' + esc((u.icon || "★").slice(0, 2)) + '</div><div class="tx"><b>' + esc(it.label) + "</b>" + (it.note ? "<small>" + esc(it.note) + "</small>" : "") + "</div>"; }
          var fade = clamp((open - 0.45) / 0.4, 0, 1), ic = isl.querySelector(".ic"), tx = isl.querySelector(".tx");
          if (ic) { ic.style.opacity = String(fade); ic.style.transform = "scale(" + (0.5 + 0.5 * fade) + ")"; }
          if (tx) { tx.style.opacity = String(fade); tx.style.transform = "translateY(" + ((1 - fade) * 10) + "px)"; }
        });
        box._R = function () { var top = Math.round(H * 0.045); return { x0: W / 2 - maxW / 2, y0: top, x1: W / 2 + maxW / 2, y1: top + h1 }; };
      } else if (u.kind === "chat") {
        var ph = document.createElement("div"); ph.className = "phone";
        ph.innerHTML = '<div class="hd"><i></i><b>' + esc(u.text || BRAND_NAME || "Cliente") + '</b></div><div class="msgs"></div>';
        box.appendChild(ph);
        var msgs = ph.querySelector(".msgs"), list2 = items.length ? items : [{ label: "Oi! Ainda tem?" }, { label: "Tem sim! Te mando o link." }];
        UIS.push(function (t) {
          if (!vis(box, s, t)) return;
          var rise = sp(t - s.start, SPR.soft);
          ph.style.transform = "translateX(-50%) translateY(" + ((1 - rise) * 120 * uu) + "px) scale(" + (0.9 + 0.1 * rise) + ")";
          var html = "";
          list2.forEach(function (m, i) {
            var me = i % 2 === 1, at = times[i] + (me ? 0 : 0.45);
            if (!me && t >= times[i] && t < at) { var d0 = (t * 6) % 3; html += '<div class="dots">' + [0, 1, 2].map(function (j) { return '<i style="transform:translateY(' + (Math.floor(d0) === j ? -6 * uu : 0) + 'px)"></i>'; }).join("") + "</div>"; }
            if (t >= at) { var k2 = sp(t - at, SPR.pop), grow = clamp(sp(t - at, SPR.soft), 0, 1); html += '<div class="msg ' + (me ? "me" : "them") + '" style="transform:scale(' + (0.6 + 0.4 * k2) + ');opacity:' + clamp(k2 * 1.5, 0, 1) + ';margin-top:' + (-(1 - grow) * 70 * uu) + 'px">' + esc(m.label) + "</div>"; }
          });
          msgs.innerHTML = html;
        });
        box._R = function () { var pw = Math.round(Math.min(W * 0.68, H * 0.48)), top = Math.round(H * (W > H ? 0.08 : 0.1)); return { x0: W / 2 - pw / 2, y0: top, x1: W / 2 + pw / 2, y1: top + Math.round(H * (W > H ? 0.76 : 0.5)) }; };
      } else if (u.kind === "click") {
        var btn = document.createElement("div"); btn.className = "btn"; btn.textContent = u.button || u.text || "Começar";
        var rip = document.createElement("div"); rip.className = "ripple";
        var cur = document.createElement("div"); cur.className = "cursor"; cur.innerHTML = '<svg viewBox="0 0 24 24" width="100%"><path d="M4 2 L4 19 L8.5 14.6 L11.6 21.5 L14.4 20.3 L11.4 13.5 L17.6 13.5 Z" fill="#fff" stroke="#111" stroke-width="1.4" stroke-linejoin="round"/></svg>';
        var ok = document.createElement("div"); ok.className = "ok"; ok.textContent = (items[0] && items[0].label) || "Pronto!";
        var chk = shapeSvg(150 * uu, ink); chk.svg.style.position = "absolute"; chk.path.setAttribute("fill", "none"); chk.path.setAttribute("stroke", ink); chk.path.setAttribute("stroke-width", "12"); chk.path.setAttribute("stroke-linecap", "round"); chk.path.setAttribute("stroke-linejoin", "round"); chk.path.setAttribute("d", CHECK);
        btn.appendChild(chk.svg); box.appendChild(rip); box.appendChild(btn); box.appendChild(cur); box.appendChild(ok);
        // The button fits its label and stays inside a phone screen: long labels get smaller type, never a wider pill.
        var maxBw = W * (W > H ? 0.3 : 0.5), label = btn.textContent, bfs = 58 * uu, bfont = function (f) { return "400 " + f + "px " + gNum; };
        while (bfs > 30 * uu && textWidth(label, bfont(bfs)) + 90 * uu > maxBw) bfs -= 2 * uu;
        btn.style.fontSize = Math.round(bfs) + "px";
        var bw = clamp(textWidth(label, bfont(bfs)) + 100 * uu, 220 * uu, maxBw), bh = 150 * uu, by = H * (W > H ? 0.36 : 0.3), press = s.start + Math.min(0.95, dur * 0.38), done = press + 0.4;
        UIS.push(function (t) {
          if (!vis(box, s, t)) return;
          var inn = sp(t - s.start, SPR.bouncy), pr = t >= press ? 1 - 0.1 * (1 - sp(t - press, SPR.pop)) : 1, toCircle = sp(t - done, SPR.snappy);
          var w = bw + (bh - bw) * toCircle;
          btn.style.width = w + "px"; btn.style.marginLeft = -w / 2 + "px"; btn.style.transform = "scale(" + (inn * pr) + ")";
          btn.style.color = toCircle > 0.3 ? "transparent" : ink;
          chk.svg.style.left = (w - 150 * uu) / 2 + "px"; chk.svg.style.top = "0px";
          chk.path.style.strokeDasharray = "120"; chk.path.style.strokeDashoffset = String(120 * (1 - sp(t - done - 0.12, SPR.soft)));
          var c0 = { x: W * 0.86, y: H * 0.86 }, c1 = { x: W / 2 + bw * 0.18, y: by + bh * 0.55 }, mv = sp(t - s.start - 0.15, SPR.soft);
          var cx = c0.x + (c1.x - c0.x) * mv, cy = c0.y + (c1.y - c0.y) * mv + Math.sin(mv * Math.PI) * -60 * uu;
          cur.style.left = cx + "px"; cur.style.top = cy + "px"; cur.style.transform = "scale(" + (t >= press && t < press + 0.18 ? 0.86 : 1) + ")"; cur.style.opacity = String(1 - sp(t - done - 0.2, SPR.firm));
          var rp = t >= press ? sp(t - press, SPR.soft) : 0, rr = 40 * uu + 260 * uu * rp;
          rip.style.left = (W / 2 - rr) + "px"; rip.style.top = (by + bh / 2 - rr) + "px"; rip.style.width = rip.style.height = rr * 2 + "px"; rip.style.opacity = String(t >= press ? 0.8 * (1 - rp) : 0);
          var okp = sp(t - done - 0.15, SPR.bouncy); ok.style.opacity = String(clamp(okp, 0, 1)); ok.style.transform = "translate(-50%," + ((1 - okp) * 40 * uu) + "px)";
        });
        box._R = function () { return { x0: W / 2 - maxBw / 2 - 20 * uu, y0: by - 30 * uu, x1: W / 2 + maxBw / 2 + 20 * uu, y1: by + 190 * uu + 150 * uu }; };
      } else if (u.kind === "toggle" || u.kind === "tabs") {
        var card = document.createElement("div"); card.className = "card"; box.appendChild(card);
        var list3 = items.length ? items : [{ label: "Postar todo dia" }, { label: "Responder rápido" }];
        if (u.kind === "toggle") {
          card.innerHTML = (u.text ? '<b style="display:block;font-size:' + Math.round(40 * uu) + 'px;opacity:.75;margin-bottom:6px">' + esc(u.text) + "</b>" : "") + list3.map(function (it) { return '<div class="row"><span>' + esc(it.label) + '</span><div class="sw"><i></i></div></div>'; }).join("");
          var sws = card.querySelectorAll(".sw"), travel = (128 - 70) * uu;
          UIS.push(function (t) {
            if (!vis(box, s, t)) return;
            var rise = sp(t - s.start, SPR.bouncy); card.style.transform = "translateX(-50%) scale(" + (0.85 + 0.15 * rise) + ")";
            sws.forEach(function (sw, i) { var k3 = sp(t - times[i] - 0.15, SPR.bouncy); sw.querySelector("i").style.transform = "translateX(" + travel * k3 + "px) scale(" + (1 + 0.15 * Math.sin(clamp(k3, 0, 1) * Math.PI)) + ")"; sw.style.background = k3 > 0.5 ? accent : uiMuted; });
          });
        } else {
          card.innerHTML = (u.text ? '<b style="display:block;font-size:' + Math.round(40 * uu) + 'px;opacity:.75;margin-bottom:14px">' + esc(u.text) + "</b>" : "") + '<div class="tabs"><i class="pill"></i>' + list3.slice(0, 4).map(function (it) { return "<span>" + esc(it.label) + "</span>"; }).join("") + '</div><div class="tabnote"></div>';
          var tabs = card.querySelector(".tabs"), pill = card.querySelector(".pill"), note = card.querySelector(".tabnote"), n = Math.min(4, list3.length);
          UIS.push(function (t) {
            if (!vis(box, s, t)) return;
            var rise = sp(t - s.start, SPR.bouncy); card.style.transform = "translateX(-50%) scale(" + (0.85 + 0.15 * rise) + ")";
            var k = 0; for (var i = 0; i < n; i++) if (t >= times[i]) k = i;
            var from = Math.max(0, k - 1), mv = k === 0 ? 1 : sp(t - times[k], SPR.bouncy), pos = from + (k - from) * mv;
            var tw = (tabs.clientWidth || GW - 72 * uu) - 20 * uu, cw = tw / n;
            pill.style.left = 10 * uu + pos * cw + "px"; pill.style.width = cw + "px";
            var it = list3[k], np = sp(t - times[k] - 0.1, SPR.soft);
            note.innerHTML = it && it.note ? '<span style="display:inline-block;opacity:' + np + ';transform:translateY(' + ((1 - np) * 30 * uu) + 'px)">' + esc(it.note) + "</span>" : "";
          });
        }
        box._R = function () { var top = Math.round(H * 0.12); return { x0: W / 2 - GW / 2, y0: top, x1: W / 2 + GW / 2, y1: top + (card.offsetHeight || 300 * uu) }; };
      } else if (u.kind === "wordcycle") {
        var big = document.createElement("div"); big.className = "big"; box.appendChild(big);
        var words = items.length ? items.map(function (i) { return i.label; }) : ["lojas.", "apps.", "marcas."];
        big.innerHTML = '<span class="w">' + esc(u.text || "Feito para") + '</span><br><span class="slot"></span>';
        var slot = big.querySelector(".slot"), fs = BIGFS;
        UIS.push(function (t) {
          if (!vis(box, s, t)) return;
          var k = 0; for (var i = 0; i < words.length; i++) if (t >= times[i]) k = i;
          var inP = sp(t - times[k], SPR.bouncy), out = k > 0 ? sp(t - times[k], SPR.snappy) : 1;
          var slotFont = "400 " + fs + "px " + (look.text === "clean" || look.text === "neon" ? FONTS.Anton : gNum);
          var wNow = textWidth(words[k], slotFont) + 8, wPrev = k > 0 ? textWidth(words[k - 1], slotFont) + 8 : wNow;
          slot.style.width = (wPrev + (wNow - wPrev) * inP) + "px";
          slot.innerHTML = (k > 0 && out < 1 ? '<b style="transform:translateY(' + (-110 * out) + '%)">' + esc(words[k - 1]) + "</b>" : "") + '<b style="transform:translateY(' + (110 * (1 - inP)) + '%)">' + esc(words[k]) + "</b>";
        });
      } else if (u.kind === "reveal") {
        var big2 = document.createElement("div"); big2.className = "big"; box.appendChild(big2);
        if ((s.cast || []).length) big2.style.top = Math.round(H * (W > H ? 0.08 : 0.07)) + "px";
        var txt = u.text || (items[0] && items[0].label) || "";
        var parts = txt.split(/\s+/).filter(Boolean);
        big2.innerHTML = parts.map(function (w) { var acc = /^\*.*\*$/.test(w); return '<span class="w' + (acc ? " acc" : "") + '">' + esc(w.replace(/\*/g, "")) + "</span>"; }).join(" ");
        var spans = big2.querySelectorAll(".w"), step = Math.min(0.12, (dur * 0.6) / Math.max(1, parts.length));
        UIS.push(function (t) {
          if (!vis(box, s, t, 0.01)) return;
          spans.forEach(function (el2, i) { var k4 = sp(t - s.start - 0.05 - i * step, SPR.snappy); el2.style.opacity = String(clamp(k4 * 1.6, 0, 1)); el2.style.transform = "translateY(" + ((1 - k4) * 36) + "px)"; });
        });
      } else if (u.kind === "lowerthird") {
        // Lower third: name and role slide in on a bar (who is talking, what this is).
        var l3 = document.createElement("div"); l3.className = "l3"; l3.innerHTML = '<div class="bar"></div><div class="tx"><b>' + esc(u.text || (items[0] && items[0].label) || BRAND_NAME || "") + "</b>" + ((items[0] && (u.text ? items[0].label : items[0].note)) ? "<small>" + esc(u.text ? items[0].label : items[0].note) + "</small>" : "") + "</div>"; box.appendChild(l3);
        var l3tx = l3.querySelector(".tx"), l3bar = l3.querySelector(".bar");
        UIS.push(function (t) {
          if (!vis(box, s, t, 0.01)) return;
          var kb = sp(t - s.start, SPR.snappy), kt = sp(t - s.start - 0.12, SPR.soft), out = sp(t - (s.end - 0.3), SPR.firm);
          l3bar.style.transform = "scaleY(" + clamp(kb, 0, 1.2) + ")";
          l3tx.style.clipPath = "inset(0 " + (100 - 100 * clamp(kt, 0, 1)) + "% 0 0)";
          l3.style.transform = "translateX(" + (-out * W * 0.7) + "px)";
        });
      } else if (u.kind === "countdown") {
        // Countdown: digits tick down inside a draining ring (offer ending, 3-2-1 launch).
        var from = Math.max(1, Math.min(10, Math.round((items[0] && items[0].value) || 3)));
        var cd = document.createElement("div"), rs = Math.round(Math.min(W, H) * 0.42); cd.className = "cd";
        cd.innerHTML = (u.text ? '<div class="lab">' + esc(u.text) + "</div>" : "") + '<div class="ring" style="width:' + rs + "px;height:" + rs + 'px"><svg viewBox="0 0 120 120" width="' + rs + '" height="' + rs + '"><circle cx="60" cy="60" r="52" fill="none" stroke="' + uiMuted.replace(".12", ".22").replace(".07", ".14") + '" stroke-width="9"/><circle class="arc" cx="60" cy="60" r="52" fill="none" stroke="' + accent + '" stroke-width="9" stroke-linecap="round" transform="rotate(-90 60 60)" stroke-dasharray="326.7"/></svg><div class="num"></div></div>';
        box.appendChild(cd);
        var arc = cd.querySelector(".arc"), num = cd.querySelector(".num"), stepD = Math.max(0.35, (dur - 0.3) / (from + 1));
        UIS.push(function (t) {
          if (!vis(box, s, t)) return;
          var lt = t - s.start, k = Math.min(from, Math.floor(lt / stepD)), val = from - k, kk = sp(lt - k * stepD, SPR.pop);
          num.textContent = val > 0 ? String(val) : (items[1] && items[1].label) || "Já!";
          num.style.transform = "scale(" + (1.5 - 0.5 * clamp(kk, 0, 1.2)) + ")"; num.style.opacity = String(clamp(kk * 1.6, 0, 1));
          arc.style.strokeDashoffset = String(326.7 * clamp(lt / (stepD * from), 0, 1));
          cd.style.transform = "translateX(-50%) scale(" + (0.85 + 0.15 * sp(lt, SPR.bouncy)) + ")";
        });
      } else if (u.kind === "follow") {
        // Follow reminder: profile pill, the button turns into "Seguindo ✓" and the bell rings.
        var handle = u.text || (window.BRAND && window.BRAND.handle ? "@" + String(window.BRAND.handle).replace(/^@/, "") : BRAND_NAME);
        var fol = document.createElement("div"); fol.className = "fol";
        fol.innerHTML = '<div class="av">' + esc((u.icon || (BRAND_NAME || handle || "V").replace(/^@/, "").slice(0, 1)).slice(0, 2).toUpperCase()) + '</div><div class="who">' + esc(handle) + '</div><div class="go"></div><div class="bell">🔔</div>';
        box.appendChild(fol);
        var go = fol.querySelector(".go"), bell = fol.querySelector(".bell"), tapAt = s.start + Math.min(1, dur * 0.42);
        var label0 = u.button || "Seguir", label1 = (items[0] && items[0].label) || "Seguindo ✓";
        UIS.push(function (t) {
          if (!vis(box, s, t)) return;
          var inn = sp(t - s.start, SPR.bouncy), tapped = t >= tapAt, kp = tapped ? sp(t - tapAt, SPR.pop) : 0;
          fol.style.transform = "translateX(-50%) scale(" + (0.7 + 0.3 * inn) + ")";
          go.textContent = tapped ? label1 : label0;
          go.style.background = tapped ? uiMuted : accent; go.style.color = tapped ? cardFg : ink;
          go.style.transform = "scale(" + (tapped ? 0.9 + 0.1 * kp : 1) + ")";
          var ring = tapped ? Math.max(0, 1 - (t - tapAt) / 1.1) : 0; bell.style.transform = "rotate(" + (Math.sin((t - tapAt) * 28) * 22 * ring) + "deg)";
        });
      } else if (u.kind === "splash" || u.kind === "loader") {
        var size = Math.min(W, H) * 0.42, wrap = document.createElement("div"); wrap.className = u.kind; box.appendChild(wrap);
        box._R = function () { var top = H * (u.kind === "splash" ? (W > H ? 0.14 : 0.2) : (W > H ? 0.2 : 0.22)); return { x0: W / 2 - size / 2 - 40 * uu, y0: top - 20 * uu, x1: W / 2 + size / 2 + 40 * uu, y1: top + size + 120 * uu }; };
        var shp = shapeSvg(size, accent); wrap.appendChild(shp.svg);
        if (u.kind === "splash") {
          var nm = document.createElement("div"); nm.className = "name"; nm.style.top = size * 0.38 + "px"; nm.textContent = (u.text || BRAND_NAME || "").slice(0, 14); wrap.appendChild(nm);
          var seq = FL ? [FL.shapes.dot, FL.shapes.circle, FL.shapes.flower, FL.shapes.square, FL.shapes.capsule] : [];
          var stepT = Math.min(0.55, (dur - 0.6) / Math.max(1, seq.length - 1));
          UIS.push(function (t) {
            if (!vis(box, s, t, 0.01) || !seq.length) return;
            var lt = t - s.start, k = Math.min(seq.length - 2, Math.max(0, Math.floor(lt / stepT)));
            shp.path.setAttribute("d", morphPath(seq[k], seq[k + 1], lt - k * stepT, { w: 15, z: 0.62, spread: 0.25, points: 110 }));
            var nmP = sp(lt - (seq.length - 1) * stepT, SPR.bouncy); nm.style.opacity = String(clamp(nmP, 0, 1)); nm.style.transform = "scale(" + (0.5 + 0.5 * nmP) + ")";
          });
        } else {
          var lab = document.createElement("div"); lab.className = "lab"; wrap.appendChild(lab);
          var l0 = (items[0] && items[0].label) || "Gerando seu vídeo…", l1 = (items[1] && items[1].label) || "Pronto!";
          var doneAt = s.start + Math.max(0.6, dur * 0.6);
          var dots = FL ? FL.shapes.pebble : "", circle = FL ? FL.shapes.circle : "";
          var chk2 = document.createElementNS(SVGNS, "path"); chk2.setAttribute("fill", "none"); chk2.setAttribute("stroke", ink); chk2.setAttribute("stroke-width", "12"); chk2.setAttribute("stroke-linecap", "round"); chk2.setAttribute("stroke-linejoin", "round"); chk2.setAttribute("d", CHECK); shp.svg.appendChild(chk2);
          UIS.push(function (t) {
            if (!vis(box, s, t)) return;
            var lt = t - s.start;
            if (t < doneAt) { shp.path.setAttribute("d", FL ? FL.shapes.dot : ""); var r2 = 0.85 + 0.15 * Math.sin(lt * 9); shp.svg.style.transform = "rotate(" + (lt * 300) + "deg) scale(" + r2 + ")"; shp.path.setAttribute("d", dots); }
            else { shp.svg.style.transform = "none"; shp.path.setAttribute("d", morphPath(dots, circle, t - doneAt, { w: 16, z: 0.6, spread: 0.2, points: 100 })); }
            chk2.style.strokeDasharray = "120"; chk2.style.strokeDashoffset = String(120 * (1 - sp(t - doneAt - 0.25, SPR.soft)));
            lab.textContent = t < doneAt ? l0 : l1;
            var lp = t < doneAt ? 1 : sp(t - doneAt, SPR.bouncy); lab.style.transform = "translateY(" + ((1 - lp) * 30) + "px)"; lab.style.opacity = String(clamp(lp, 0, 1));
          });
        }
      }
    });
    // Components placed inside a drawn element follow it: scaled into its screen and moving with the camera.
    shots.forEach(function (s) {
      var u = s.ui, box = s._uiBox;
      if (!u || !u.on || !box || !box._R || !SETS[s.set] || !SETS[s.set].els || !SETS[s.set].els[u.on]) return;
      UIS.push(function (t) {
        if (t < s.start || t >= s.end) return;
        var Rr = box._R(), E = elScreen(s, SETS[s.set], u.on, t, true);
        var k = Math.min(E.w * 0.8 / (Rr.x1 - Rr.x0), E.h * 0.76 / (Rr.y1 - Rr.y0));
        var tx = E.x - k * (Rr.x0 + Rr.x1) / 2, ty = E.y - k * (Rr.y0 + Rr.y1) / 2;
        box.style.transformOrigin = "0 0";
        box.style.transform = "translate(" + tx + "px," + ty + "px) scale(" + k + ")";
      });
    });
    var flash = document.createElement("div"); flash.className = "crs-flash"; root.appendChild(flash);
    shots.forEach(function (s) { if (s.transition === "flash") { tl.fromTo(flash, { autoAlpha: 0.95 }, { autoAlpha: 0, duration: 0.3, immediateRender: false }, s.start); } });

    /* ------------------------------ drawing */
    function stepped(t) { return look.fps >= 30 ? t : Math.floor(t * look.fps) / look.fps; }
    function variant(t, n) { return n <= 1 ? 0 : Math.floor(t * (look.fps >= 30 ? 8 : look.fps / 2)) % n; }
    function drawImg(ctx, im, x, y, w, h) { if (im && im.complete && im.naturalWidth) ctx.drawImage(im, x, y, w, h); }

    /** Framing of the element called `name` (data-el): centred through its layer's parallax, filling ~60% of the frame. */
    function elFocus(set, cam, name) {
      var e = set.els && set.els[name]; if (!e) return null;
      var ks = cam.sw / set.w, f = 0.35 + 0.65 * e.depth, csx = cam.sw / 2, csy = cam.sh / 2;
      var ex = (e.sp.x + e.sp.w / 2) * ks, ey = (e.sp.y + e.sp.h / 2) * ks;
      var fill = clamp(Math.min(W / (e.sp.w * ks * 1.8), H / (e.sp.h * ks * 1.8)), 1.05, 2.1);
      return { x: csx + (ex - csx) / f, y: csy + (ey - csy) / f, z: 1 + (fill - 1) / (0.5 + 0.5 * e.depth) };
    }
    function clampCam(cam) {
      var vwc = W / cam.z, vhc = H / cam.z;
      cam.x = cam.sw <= vwc ? cam.sw / 2 : clamp(cam.x, vwc / 2, cam.sw - vwc / 2);
      cam.y = cam.sh <= vhc ? cam.sh / 2 : clamp(cam.y, vhc / 2, cam.sh - vhc / 2);
    }
    /**
     * camera.target frames one element and pushes in slowly; camera.move "follow" travels to each cued
     * element at the moment its word is spoken, on a spring. Returns true when the camera is aimed.
     */
    function aimCamera(s, set, cam, tq, p) {
      var c = s.camera || {};
      var stops = (s._cueT || []).filter(function (q) { return set.els && set.els[q.el]; });
      if (c.move === "follow" && stops.length) {
        var cur = { x: cam.x, y: cam.y, z: cam.z };
        stops.forEach(function (q) {
          var F = elFocus(set, cam, q.el), g = clamp(sp(tq - q.t + 0.18, SPR.soft), 0, 1.08);
          cur = { x: cur.x + (F.x - cur.x) * g, y: cur.y + (F.y - cur.y) * g, z: cur.z + (F.z - cur.z) * g };
        });
        cam.x = cur.x; cam.y = cur.y; cam.z = cur.z; clampCam(cam); return true;
      }
      var T0 = c.target && elFocus(set, cam, c.target);
      if (T0) { cam.x = T0.x; cam.y = T0.y; cam.z = T0.z * (0.9 + 0.12 * p); clampCam(cam); return true; }
      return false;
    }
    /** The camera of a shot at time t: the move, aiming, kicks, coverage cuts, beat punches and glides. */
    function shotCam(s, set, t, noGlide) {
      var dur = Math.max(0.01, s.end - s.start), p = clamp((t - s.start) / dur, 0, 1);
      var cam = camAt(s, set, p, W, H), tq = stepped(t);
      var aimed = aimCamera(s, set, cam, tq, p);
      // Spring kick on every cut: the frame lands a little closer and settles (energy without a transition).
      var si = shots.indexOf(s);
      if (si > 0 && (!s.transition || s.transition === "cut" || s.transition === "flash")) cam.z *= 1 + 0.075 * (1 - sp(tq - s.start, SPR.bouncy));
      else if (si === 0) cam.z *= 1 + 0.12 * (1 - sp(tq, SPR.soft));
      // Long shots get a punch-in halfway (an editor's jump zoom): a new framing without a new shot.
      // Coverage cuts: a shot longer than 2.8 s is cut every ~2 s on a word boundary into another framing
      // (tighter, then wider and to the other side), so the picture never holds one framing too long.
      if (!s._cuts && aimed) s._cuts = []; // an aimed camera is not cut into other framings
      if (!s._cuts) {
        s._cuts = [];
        var lastCut = s.start;
        if (s.end - s.start > 2.8) (s.words || []).forEach(function (w) {
          if (w.start - lastCut >= 1.9 && s.end - w.start >= 0.9) {
            var at = w.start - 0.03, nb = BEAT ? Math.round(at / BEAT) * BEAT : at;
            s._cuts.push(Math.abs(nb - at) < 0.14 ? nb : at); lastCut = w.start;
          }
        });
      }
      var ck = 0; for (var ci = 0; ci < s._cuts.length; ci++) if (tq >= s._cuts[ci]) ck = ci + 1;
      if (ck) {
        var framing = [[1.24, 0.045], [0.86, -0.05], [1.12, -0.03]][(ck - 1) % 3];
        cam.z *= framing[0] * (1 + 0.06 * (1 - sp(tq - s._cuts[ck - 1], SPR.bouncy)));
        cam.x += framing[1] * W / cam.z;
        var vwc = W / cam.z, vhc = H / cam.z;
        cam.x = cam.sw <= vwc ? cam.sw / 2 : clamp(cam.x, vwc / 2, cam.sw - vwc / 2);
        cam.y = cam.sh <= vhc ? cam.sh / 2 : clamp(cam.y, vhc / 2, cam.sh - vhc / 2);
      }
      // Punches on the rhythm of the voice: at each pause inside the shot (comma, full stop, question)
      // the framing jumps, alternating closer and wider, like an editor cutting on the narration.
      var sdur = s.end - s.start;
      if (cam.move !== "close" && !aimed) {
        if (!s._beats) {
          s._beats = [];
          (s.words || []).forEach(function (w, wi) { if (wi < s.words.length - 1 && /[,.;:!?…]$/.test(w.text) && w.end - s.start > 0.6 && s.end - w.end > 0.6) s._beats.push(w.end + 0.04); });
          if (!s._beats.length && sdur > 2.6) s._beats.push(s.start + sdur * 0.52);
        }
        for (var bi = 0; bi < s._beats.length; bi++) cam.z *= 1 + (bi % 2 ? -0.06 : 0.1) * sp(tq - s._beats[bi], SPR.bouncy);
      }
      if (cam.move === "shake" || look.fps < 30) {
        var amp = cam.move === "shake" ? 9 : 2.2, j = Math.floor(tq * 24);
        cam.x += (hash(j) - 0.5) * amp * 2; cam.y += (hash(j + 99) - 0.5) * amp * 2;
      }
      // Glide: on the same set, the camera travels from where the last shot ended instead of cutting.
      if (BEAT) { var ph2 = (tq % (BEAT * 2)) / (BEAT * 2); cam.z *= 1 + 0.01 * Math.exp(-ph2 * 7); }
      if (!noGlide && si > 0 && s.transition === "glide" && shots[si - 1].set === s.set) {
        var pc = shotCam(shots[si - 1], set, s.start - 0.001, true), gl = clamp(sp(tq - s.start, SPR.soft), 0, 1);
        cam.x = pc.x + (cam.x - pc.x) * gl; cam.y = pc.y + (cam.y - pc.y) * gl; cam.z = pc.z + (cam.z - pc.z) * gl; cam.rot = pc.rot + (cam.rot - pc.rot) * gl;
      }
      return cam;
    }
    /** Where a named element sits on screen in a shot at time t (centre and size of its drawing). */
    function elScreen(shot, set, name, t, withMotion) {
      var e = set.els[name], cam = shotCam(shot, set, t), ks = cam.sw / set.w, d = e.depth;
      var csx = cam.sw / 2, csy = cam.sh / 2, f = 0.35 + 0.65 * d, lx = csx + (cam.x - csx) * f, ly = csy + (cam.y - csy) * f, lz = 1 + (cam.z - 1) * (0.5 + 0.5 * d);
      var mdx = 0, mdy = 0, ms = 1;
      if (withMotion && shot._runStart != null) { var tq3 = stepped(t), mm = elementMotion(e.sp, tq3, tq3 - shot._runStart, set.w, (RUNCUES[shot._run] || {})[name]); mdx = mm.dx; mdy = mm.dy; ms = mm.s; }
      var vx = ((e.sp.x + e.sp.w / 2 + mdx) * ks - lx) * lz, vy = ((e.sp.y + e.sp.h / 2 + mdy) * ks - ly) * lz, r = cam.rot * Math.PI / 180;
      return { x: W / 2 + vx * Math.cos(r) - vy * Math.sin(r), y: H / 2 + vx * Math.sin(r) + vy * Math.cos(r), w: e.sp.w * ks * lz * ms, h: e.sp.h * ks * lz * ms, rot: cam.rot, sp: e.sp };
    }
    /** The shared element travelling from its place in the last shot to its place in this one. */
    function drawFlight(ctx, s, set, name, t, tq) {
      var prev = s._flyFrom, a = elScreen(prev, SETS[prev.set], name, s.start - 0.001), b = elScreen(s, set, name, t);
      var g = clamp(sp(tq - s.start, SPR.soft), 0, 1.04), x = a.x + (b.x - a.x) * g, y = a.y + (b.y - a.y) * g - Math.sin(clamp(g, 0, 1) * Math.PI) * H * 0.035;
      var w = a.w + (b.w - a.w) * g, h = a.h + (b.h - a.h) * g;
      ctx.save(); ctx.translate(x, y); ctx.rotate((a.rot + (b.rot - a.rot) * g) * Math.PI / 180 + Math.sin(clamp(g, 0, 1) * Math.PI) * 0.05);
      ctx.globalAlpha = clamp(1 - g, 0, 1); drawImg(ctx, a.sp.imgs[0], -w / 2, -h / 2, w, h);
      ctx.globalAlpha = clamp(g, 0, 1); drawImg(ctx, b.sp.imgs[0], -w / 2, -h / 2, w, h);
      ctx.restore();
    }
    function drawShot(ctx, s, t) {
      var set = SETS[s.set]; if (!set) return;
      var tq = stepped(t), si = shots.indexOf(s), cam = shotCam(s, set, t);
      var csx = cam.sw / 2, csy = cam.sh / 2;
      ctx.fillStyle = look.paperColor || "#141318"; ctx.fillRect(0, 0, W, H);
      // When a set appears (first shot of a run on it), its layers build in: the near ones rise in on springs.
      if (s._runStart == null) { var rs = si; while (rs > 0 && shots[rs - 1].set === s.set) rs--; s._runStart = shots[rs].start; }
      var et = tq - s._runStart, ks = cam.sw / set.w, runCues = RUNCUES[s._run] || {};
      // Elements named the same in the last set and in this one fly across the cut (shared element).
      if (s._fly == null) {
        s._fly = [];
        var prevS = si > 0 && shots[si - 1].set !== s.set ? shots[si - 1] : null, prevSet = prevS && SETS[prevS.set];
        if (prevSet && prevSet.els && set.els) Object.keys(set.els).forEach(function (nm) { if (prevSet.els[nm]) s._fly.push(nm); });
        s._flyFrom = prevS;
      }
      var flying = s._fly.length && tq < s.start + 0.62;
      set.layers.forEach(function (layer, li) {
        var d = layer.depth, f = 0.35 + 0.65 * d, lx = csx + (cam.x - csx) * f, ly = csy + (cam.y - csy) * f, lz = 1 + (cam.z - 1) * (0.5 + 0.5 * d);
        if (d < 0.9) { lx += Math.sin(tq * 0.45 + d * 3) * W * 0.012 * (1 - d); ly += Math.cos(tq * 0.38 + d * 5) * H * 0.006 * (1 - d); }
        var build = li === 0 ? 1 : clamp(sp(et - 0.03 - li * 0.07, SPR.soft), 0, 1.2);
        ctx.save(); ctx.translate(W / 2, H / 2); ctx.rotate(cam.rot * Math.PI / 180); ctx.scale(lz, lz); ctx.translate(-lx, -ly + (1 - build) * H * 0.07 * Math.min(1.4, d + 0.3));
        if (li > 0) ctx.globalAlpha = clamp(build * 1.4, 0, 1);
        drawImg(ctx, layer.imgs[variant(tq, layer.imgs.length)], 0, 0, cam.sw, cam.sh);
        (layer.sprites || []).forEach(function (sp2) {
          if (flying && sp2.name && s._fly.indexOf(sp2.name) >= 0) return;
          // An element that flew in has already arrived: no second entrance.
          var cuesOf = sp2.name && s._fly.indexOf(sp2.name) >= 0 ? [s.start - 5].concat(runCues[sp2.name] || []) : sp2.name ? runCues[sp2.name] : null;
          if (s._heroes == null) { s._heroes = (s._cueT || []).map(function (q) { return q.el; }); if (s.camera && s.camera.target) s._heroes.push(s.camera.target); }
          var calm = s._heroes.length && !(sp2.name && s._heroes.indexOf(sp2.name) >= 0) ? 0.3 : 1;
          var m = elementMotion(sp2, tq, et, set.w, cuesOf, calm);
          ctx.save(); ctx.globalAlpha = (li > 0 ? clamp(build * 1.4, 0, 1) : 1) * clamp(m.a, 0, 1);
          ctx.translate((m.ox + m.dx) * ks, (m.oy + m.dy) * ks); ctx.rotate(m.rot * Math.PI / 180); ctx.scale(m.s, m.s); ctx.translate(-m.ox * ks, -m.oy * ks);
          // Clean looks: living elements cast a soft shadow that grows as they lift (float, bounce, entrances).
          if (SOFT_SHADOW && layer.depth > 0.2) {
            var lift = clamp(-(m.dy || 0) / Math.max(20, sp2.h * 0.2), -1, 1);
            ctx.shadowColor = SOFT_SHADOW; ctx.shadowBlur = (18 + 22 * Math.max(0, lift)) * ks * lz; ctx.shadowOffsetY = (10 + 14 * Math.max(0, lift)) * ks * lz;
          }
          drawImg(ctx, sp2.imgs[variant(tq + sp2.i * 0.13, sp2.imgs.length)], sp2.x * ks, sp2.y * ks, sp2.w * ks, sp2.h * ks);
          ctx.restore();
        });
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
          // Objects new to this shot pop in on a bouncy spring, staggered.
          if (!(s._prevProps || {})[it.v.id] && it.v.motion !== "grow") sc *= Math.max(0.001, sp(tq - s.start - 0.04 - it.i * 0.06, SPR.bouncy));
          var w = pr.w * sc, h = pr.h * sc;
          ctx.save(); ctx.globalAlpha = m.a; ctx.translate(it.v.x * cam.k + m.dx, it.v.y * cam.k + m.dy); ctx.rotate(((it.v.rotate || 0) + m.rot) * Math.PI / 180);
          if (it.v.flip) ctx.scale(-1, 1);
          drawImg(ctx, pr.imgs[variant(tq + it.i * 0.17, pr.imgs.length)], -w / 2, -h, w, h);
          ctx.restore();
        } else {
          var A = CAST[it.v.who]; if (!A) return;
          var scale = (SIZE[it.v.size] || SIZE.m) * H / 1920, fx = it.v.x * cam.k, fy = it.v.y * cam.k;
          var idle = it.i * 1.9 + names.indexOf(it.v.who) * 0.7;
          A.shots = [{ t: 0, x: fx + Math.sin(tq * 1.3 + idle) * scale * 0.8, y: fy, scale: scale * (1 + Math.sin(tq * 2.1 + idle) * 0.006), d: 0 }];
          ctx.save();
          if (it.v.facing === "left") { ctx.translate(fx, 0); ctx.scale(-1, 1); ctx.translate(-fx, 0); }
          A.draw(ctx, tq);
          ctx.restore();
        }
      });
      ctx.restore();
      if (flying) s._fly.forEach(function (nm) { drawFlight(ctx, s, set, nm, t, tq); });
      if (s.proof && PROOFS[s.proof] && PROOFS[s.proof].length) drawProof(ctx, PROOFS[s.proof], s, t, tq);
      (s.fx || []).forEach(function (k, ki) { drawFx(ctx, k, tq, W, H, look, ki + 1 + shots.indexOf(s) * 3); });
    }

    /**
     * A real screenshot inside a phone or a laptop. A screenshot taller than the screen scrolls through
     * the shot (a landing page, a feed), with a soft spring at the start so it reads as someone scrolling.
     */
    function drawDevice(ctx, img, s, t, tq, p) {
      var phone = s.proofStyle === "phone", pop = sp(t - s.start, SPR.bouncy);
      var sw2, sh2;
      if (phone) { sh2 = Math.min(H * (W > H ? 0.78 : 0.6), W * 1.05); sw2 = sh2 * 0.47; }
      else { sw2 = Math.min(W * (W > H ? 0.62 : 0.86), H * 0.9); sh2 = sw2 * 0.62; }
      var bez = phone ? sw2 * 0.045 : sw2 * 0.025, cx = W / 2, cy = H * (W > H ? 0.48 : 0.42) + Math.sin(tq * 1.4) * 8 - (1 - pop) * 120;
      ctx.save();
      ctx.translate(cx, cy); ctx.rotate((phone ? -3 : -1.5) * Math.PI / 180 + Math.sin(tq * 0.8) * 0.01); ctx.scale(0.8 + 0.2 * pop, 0.8 + 0.2 * pop);
      ctx.globalAlpha = clamp(pop * 1.5, 0, 1);
      ctx.shadowColor = "rgba(0,0,0,.45)"; ctx.shadowBlur = 60; ctx.shadowOffsetY = 30;
      ctx.fillStyle = "#0B0B10"; roundRect(ctx, -sw2 / 2 - bez, -sh2 / 2 - bez, sw2 + bez * 2, sh2 + bez * 2, phone ? sw2 * 0.13 : bez * 2); ctx.fill();
      ctx.shadowColor = "transparent";
      if (!phone) { ctx.fillStyle = "#1C1C24"; roundRect(ctx, -sw2 * 0.62, sh2 / 2 + bez, sw2 * 1.24, sh2 * 0.06, sh2 * 0.03); ctx.fill(); }
      ctx.save(); roundRect(ctx, -sw2 / 2, -sh2 / 2, sw2, sh2, phone ? sw2 * 0.09 : 6); ctx.clip();
      ctx.fillStyle = "#FFFFFF"; ctx.fillRect(-sw2 / 2, -sh2 / 2, sw2, sh2);
      var scale = sw2 / img.naturalWidth, drawnH = img.naturalHeight * scale;
      if (drawnH > sh2 * 1.08) {
        // Scroll: hold a beat, then travel down at a steady pace with a spring settle.
        var travel = drawnH - sh2, k = clamp((p - 0.12) / 0.8, 0, 1), eased = k < 0.85 ? k / 0.85 * 0.96 : 0.96 + 0.04 * sp((k - 0.85) * 3, SPR.bouncy);
        ctx.drawImage(img, -sw2 / 2, -sh2 / 2 - travel * clamp(eased, 0, 1), sw2, drawnH);
      } else {
        var fit = Math.min(sw2 / img.naturalWidth, sh2 / img.naturalHeight), dw = img.naturalWidth * fit, dh = img.naturalHeight * fit, zoom = 1 + p * 0.08;
        ctx.drawImage(img, -dw * zoom / 2, -dh * zoom / 2, dw * zoom, dh * zoom);
      }
      ctx.restore();
      if (phone) { ctx.fillStyle = "#0B0B10"; roundRect(ctx, -sw2 * 0.17, -sh2 / 2 + bez * 0.4, sw2 * 0.34, sw2 * 0.07, sw2 * 0.035); ctx.fill(); }
      ctx.restore();
    }

    function roundRect(ctx, x, y, w, h, r) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }
    function drawProof(ctx, imgs, s, t, tq) {
      var dur = Math.max(0.5, s.end - s.start), p = clamp((t - s.start) / dur, 0, 1);
      var img = imgs[Math.min(imgs.length - 1, Math.floor(p * imgs.length))];
      if (!img || !img.complete || !img.naturalWidth) return;
      if (s.proofStyle === "phone" || s.proofStyle === "laptop") return drawDevice(ctx, img, s, t, tq, p);
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
        if (kind === "cut" || kind === "flash" || kind === "glide") continue;
        var dur = kind === "whip" ? 0.28 : kind === "iris" || kind === "clock" ? 0.6 : kind === "pixelate" ? 0.5 : kind === "push" || kind === "zoom" ? 0.4 : 0.45;
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
        var src = work, scale = 1;
        if (look.soften) {
          // Downsample + smooth upscale: one soft "painted" surface for sets and characters alike.
          // Wet edges and colour bleed are painted on the small canvas too (far fewer pixels to filter).
          if (!softC) {
            softC = document.createElement("canvas"); softC.width = Math.round(W / look.soften); softC.height = Math.round(H / look.soften); softX = softC.getContext("2d");
            baseC = document.createElement("canvas"); baseC.width = softC.width; baseC.height = softC.height; baseX = baseC.getContext("2d");
          }
          scale = 1 / look.soften;
          baseX.imageSmoothingEnabled = true; baseX.imageSmoothingQuality = "high";
          baseX.clearRect(0, 0, baseC.width, baseC.height); baseX.drawImage(work, 0, 0, baseC.width, baseC.height);
          softX.clearRect(0, 0, softC.width, softC.height);
          if (look.filter && look.filter !== "none") softX.filter = look.filter;
          softX.drawImage(baseC, 0, 0); softX.filter = "none";
          if (look.edges) { softX.globalAlpha = look.edges; softX.globalCompositeOperation = "multiply"; softX.filter = "blur(1px) contrast(1.6) brightness(.92)"; softX.drawImage(baseC, 0.6, 0.6); softX.filter = "none"; softX.globalCompositeOperation = "source-over"; softX.globalAlpha = 1; }
          if (look.bleed) { softX.globalAlpha = look.bleed; softX.globalCompositeOperation = "multiply"; softX.filter = "blur(2px)"; softX.drawImage(baseC, 0, 0); softX.filter = "none"; softX.globalCompositeOperation = "source-over"; softX.globalAlpha = 1; }
          src = softC;
        }
        vx.imageSmoothingEnabled = true; vx.imageSmoothingQuality = "high";
        if (!look.soften && look.filter && look.filter !== "none") vx.filter = look.filter;
        var wv = look.weave ? (hash(Math.floor(tq * 12)) - 0.5) * look.weave * 2 : 0;
        vx.drawImage(src, wv, wv * 0.6, W, H);
        vx.filter = "none";
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
      if (look.crt) {
        // Tube TV: colour fringe, scanlines, a slow roll bar, flicker and rounded glass corners.
        vx.globalAlpha = 0.22; vx.globalCompositeOperation = "screen"; vx.filter = "sepia(1) hue-rotate(-50deg) saturate(4)"; vx.drawImage(work, 3, 0, W, H); vx.filter = "none";
        vx.globalCompositeOperation = "multiply"; vx.globalAlpha = 0.85; vx.drawImage(texture("scan", W, H), 0, 0, W, H);
        vx.globalCompositeOperation = "source-over";
        var roll = ((tq * 0.18) % 1.2) * H; vx.globalAlpha = 0.06; vx.fillStyle = "#FFFFFF"; vx.fillRect(0, roll - H * 0.1, W, H * 0.08);
        vx.globalAlpha = 0.04 + 0.04 * hash(Math.floor(tq * 15)); vx.fillStyle = "#FFFFFF"; vx.fillRect(0, 0, W, H);
        vx.globalAlpha = 1; vx.fillStyle = "#050507"; vx.beginPath(); vx.rect(0, 0, W, H); var rr = Math.min(W, H) * 0.07;
        vx.moveTo(rr, 0); vx.arcTo(0, 0, 0, rr, rr); vx.lineTo(0, H - rr); vx.arcTo(0, H, rr, H, rr); vx.lineTo(W - rr, H); vx.arcTo(W, H, W, H - rr, rr); vx.lineTo(W, rr); vx.arcTo(W, 0, W - rr, 0, rr); vx.closePath();
        vx.fill("evenodd");
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
        else if (tr.kind === "blinds") {
          // Venetian blinds: the old shot survives in slats that close.
          var nb = W > H ? 9 : 12, bh = H / nb; wx.beginPath();
          for (var bi = 0; bi < nb; bi++) wx.rect(0, bi * bh + bh * p, W, bh * (1 - p));
          wx.clip(); wx.drawImage(prevC, 0, 0);
        }
        else if (tr.kind === "clock") {
          // Clock wipe: a hand sweeps around the centre revealing the new shot.
          var a0 = -Math.PI / 2 + p * Math.PI * 2; wx.beginPath(); wx.moveTo(W / 2, H / 2); wx.arc(W / 2, H / 2, Math.hypot(W, H), a0, Math.PI * 1.5); wx.closePath(); wx.clip(); wx.drawImage(prevC, 0, 0);
        }
        else if (tr.kind === "pixelate") {
          // Blocks grow on the old shot, the new one resolves from blocks.
          var src = p < 0.5 ? prevC : wx.canvas, blk = Math.max(1, Math.round(2 + 70 * Math.sin(p * Math.PI)));
          tx2.clearRect(0, 0, W, H); tx2.imageSmoothingEnabled = true; tx2.drawImage(src, 0, 0, Math.ceil(W / blk), Math.ceil(H / blk));
          wx.imageSmoothingEnabled = false; wx.drawImage(tmpC, 0, 0, Math.ceil(W / blk), Math.ceil(H / blk), 0, 0, W, H); wx.imageSmoothingEnabled = true;
        }
        else if (tr.kind === "push") {
          // The new shot pushes the old one off to the left.
          tx2.clearRect(0, 0, W, H); tx2.drawImage(wx.canvas, 0, 0); wx.clearRect(0, 0, W, H);
          wx.drawImage(prevC, -W * p, 0); wx.drawImage(tmpC, W * (1 - p), 0);
        }
        else if (tr.kind === "zoom") {
          // Zoom through: the old shot rushes toward the camera and fades.
          var zs = 1 + p * 1.6; wx.globalAlpha = 1 - p; wx.translate(W / 2, H / 2); wx.scale(zs, zs); wx.translate(-W / 2, -H / 2); wx.filter = "blur(" + Math.round(10 * p) + "px)"; wx.drawImage(prevC, 0, 0);
        }
        else if (tr.kind === "whip") {
          var off = W * p;
          wx.globalAlpha = 1 - p * 0.3; wx.filter = "blur(" + Math.round(18 * Math.sin(p * Math.PI)) + "px)"; wx.drawImage(prevC, -off, 0);
        }
        wx.restore();
      }
      post(t);
      for (var ui = 0; ui < UIS.length; ui++) UIS[ui](t);
    }
    tl.to(st, { t: D, duration: D, ease: "none", onUpdate: frame }, 0);
    frame();
    return { shots: shots, look: look };
  };

  window.CRS = CRS;
})();
