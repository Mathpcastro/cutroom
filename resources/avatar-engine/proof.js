import { renderAvatarPixels } from "./avatar-engine.js";

const INTEGER_SCALE = 4;
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

  const frames = states.map((state) =>
    renderAvatarPixels(input.avatar, state, "full"),
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

window.__avatarProof = Object.freeze({ render });
