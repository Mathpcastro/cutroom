import { renderAvatarPixels } from "./avatar-engine.js";

const INTEGER_SCALE = 4;
const REVIEW_WIDTH = 1200;
const BACKGROUNDS = ["#f4f1ea", "#202024", "#d9edf2", "#342d45"];
const renderedSheets = new Map();
const input = JSON.parse(
  document.getElementById("avatar-proof-data").textContent,
);

function canvasForPixels(pixels) {
  const canvas = document.createElement("canvas");
  canvas.width = pixels.width;
  canvas.height = pixels.height;
  const context = canvas.getContext("2d");
  context.putImageData(
    new ImageData(pixels.data, pixels.width, pixels.height),
    0,
    0,
  );
  return canvas;
}

function transformPixels(pixels, sheet, index) {
  if (sheet === "backgrounds") {
    const canvas = canvasForPixels(pixels);
    const context = canvas.getContext("2d");
    context.globalCompositeOperation = "destination-over";
    context.fillStyle = BACKGROUNDS[index % BACKGROUNDS.length];
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.globalCompositeOperation = "source-over";
    const image = context.getImageData(0, 0, canvas.width, canvas.height);
    return { width: canvas.width, height: canvas.height, data: image.data };
  }
  if (sheet !== "silhouette" && sheet !== "grayscale") return pixels;
  const data = new Uint8ClampedArray(pixels.data);
  for (let offset = 0; offset < data.length; offset += 4) {
    if (data[offset + 3] === 0) continue;
    const value =
      sheet === "silhouette"
        ? 24
        : Math.round(
            data[offset] * 0.2126 +
              data[offset + 1] * 0.7152 +
              data[offset + 2] * 0.0722,
          );
    data[offset] = value;
    data[offset + 1] = value;
    data[offset + 2] = value;
  }
  return { ...pixels, data };
}

function composeNativeSheet(frames) {
  const canvas = document.createElement("canvas");
  canvas.width = frames.reduce((width, frame) => width + frame.width, 0);
  canvas.height = frames[0]?.height ?? 0;
  const context = canvas.getContext("2d");
  context.imageSmoothingEnabled = false;
  let x = 0;
  for (const frame of frames) {
    context.drawImage(canvasForPixels(frame), x, 0);
    x += frame.width;
  }
  return canvas;
}

async function nativePixelHash(canvas) {
  const context = canvas.getContext("2d");
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
  const digest = await globalThis.crypto.subtle.digest("SHA-256", pixels);
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

async function render(sheet) {
  if (!Object.hasOwn(input.states ?? {}, sheet)) {
    throw new Error(`Unsupported avatar proof sheet: ${sheet}`);
  }
  const states = input.states[sheet];
  if (!Array.isArray(states) || states.length === 0) {
    throw new Error(`Avatar proof sheet has no states: ${sheet}`);
  }

  const frames = states.map((state, index) =>
    transformPixels(
      renderAvatarPixels(input.avatar, state, "full"),
      sheet,
      index,
    ),
  );
  const native = composeNativeSheet(frames);
  const hash = await nativePixelHash(native);

  const output = document.createElement("canvas");
  output.width = native.width * INTEGER_SCALE;
  output.height = native.height * INTEGER_SCALE;
  const context = output.getContext("2d");
  context.imageSmoothingEnabled = false;
  context.drawImage(native, 0, 0, output.width, output.height);
  document.body.replaceChildren(output);
  renderedSheets.set(sheet, output);

  return {
    sheet,
    width: output.width,
    height: output.height,
    nativeWidth: native.width,
    nativeHeight: native.height,
    hash,
    png: output.toDataURL("image/png").split(",", 2)[1],
    jpeg: output.toDataURL("image/jpeg", 0.92).split(",", 2)[1],
  };
}

function compose(sheetNames) {
  const sheets = sheetNames.map((name) => {
    const canvas = renderedSheets.get(name);
    if (!canvas) throw new Error(`Avatar sheet was not rendered: ${name}`);
    return canvas;
  });
  const heights = sheets.map((canvas) =>
    Math.max(1, Math.round((canvas.height / canvas.width) * REVIEW_WIDTH)),
  );
  const output = document.createElement("canvas");
  output.width = REVIEW_WIDTH;
  output.height = heights.reduce((total, height) => total + height, 0);
  const context = output.getContext("2d");
  context.imageSmoothingEnabled = false;
  context.fillStyle = "#202024";
  context.fillRect(0, 0, output.width, output.height);
  let y = 0;
  for (let index = 0; index < sheets.length; index += 1) {
    context.drawImage(sheets[index], 0, y, REVIEW_WIDTH, heights[index]);
    y += heights[index];
  }
  return {
    width: output.width,
    height: output.height,
    jpeg: output.toDataURL("image/jpeg", 0.82).split(",", 2)[1],
  };
}

window.__avatarProof = Object.freeze({ render, compose });
