function paletteRgb(palette, token) {
  const color = palette[token];
  if (typeof color !== "string") {
    throw new Error(`Unknown avatar palette token: ${token}`);
  }
  return [
    Number.parseInt(color.slice(1, 3), 16),
    Number.parseInt(color.slice(3, 5), 16),
    Number.parseInt(color.slice(5, 7), 16),
  ];
}

function fillRect(context, x, y, width, height, token) {
  const { data, width: canvasWidth, height: canvasHeight, palette } = context;
  const left = Math.max(0, Math.round(x));
  const top = Math.max(0, Math.round(y));
  const right = Math.min(canvasWidth, Math.round(x) + Math.round(width));
  const bottom = Math.min(canvasHeight, Math.round(y) + Math.round(height));
  if (left >= right || top >= bottom) return;

  const [red, green, blue] = paletteRgb(palette, token);
  for (let row = top; row < bottom; row += 1) {
    for (let column = left; column < right; column += 1) {
      const offset = (row * canvasWidth + column) * 4;
      data[offset] = red;
      data[offset + 1] = green;
      data[offset + 2] = blue;
      data[offset + 3] = 255;
    }
  }
}

function fillMatrix(context, primitive) {
  const originX = Math.round(primitive.x);
  const originY = Math.round(primitive.y);
  for (const [rowIndex, row] of primitive.rows.entries()) {
    for (const [columnIndex, token] of row.entries()) {
      if (token !== null) {
        fillRect(
          context,
          originX + columnIndex,
          originY + rowIndex,
          1,
          1,
          token,
        );
      }
    }
  }
}

function compareIntersections(left, right) {
  // Schema bounds keep each product below 2^42, safely within 2^53.
  const difference =
    left.numerator * right.denominator - right.numerator * left.denominator;
  return difference || left.edge - right.edge;
}

function fillPolygon(context, primitive) {
  const points = primitive.points.map(({ x, y }) => ({
    x: Math.round(x),
    y: Math.round(y),
  }));
  const first = points[0];
  const second = points.find(
    (point) => point.x !== first.x || point.y !== first.y,
  );
  if (!second) return;
  const directionX = second.x - first.x;
  const directionY = second.y - first.y;
  const collinear = points.every(
    (point) =>
      directionX * (point.y - first.y) - directionY * (point.x - first.x) === 0,
  );
  if (collinear) return;

  const { data, width, height, palette } = context;
  const [red, green, blue] = paletteRgb(palette, primitive.color);
  const firstY = Math.max(0, Math.min(...points.map((point) => point.y)));
  const endY = Math.min(height, Math.max(...points.map((point) => point.y)));

  for (let y = firstY; y < endY; y += 1) {
    const scan = 2 * y + 1;
    const intersections = [];
    for (let index = 0; index < points.length; index += 1) {
      const start = points[index];
      const end = points[(index + 1) % points.length];
      if (start.y === end.y) continue;
      const minimumY = 2 * Math.min(start.y, end.y);
      const maximumY = 2 * Math.max(start.y, end.y);
      if (scan < minimumY || scan >= maximumY) continue;

      let denominator = 2 * (end.y - start.y);
      let numerator =
        start.x * denominator + (scan - 2 * start.y) * (end.x - start.x);
      if (denominator < 0) {
        numerator = -numerator;
        denominator = -denominator;
      }
      intersections.push({ numerator, denominator, edge: index });
    }
    intersections.sort(compareIntersections);

    for (let index = 0; index + 1 < intersections.length; index += 2) {
      const left = intersections[index];
      const right = intersections[index + 1];
      for (let x = 0; x < width; x += 1) {
        const center = 2 * x + 1;
        if (center * left.denominator < 2 * left.numerator) continue;
        if (center * right.denominator > 2 * right.numerator) continue;
        const offset = (y * width + x) * 4;
        data[offset] = red;
        data[offset + 1] = green;
        data[offset + 2] = blue;
        data[offset + 3] = 255;
      }
    }
  }
}

export function renderAvatarPixels(avatar, state, viewport = "full") {
  void state;
  const size =
    viewport === "portrait" ? avatar.canvas.portrait : avatar.canvas.full;
  const data = new Uint8ClampedArray(size * size * 4);
  const context = { data, width: size, height: size, palette: avatar.palette };
  const orderedParts = avatar.parts
    .map((part, index) => ({
      part,
      index,
      zIndex: Number.isFinite(part.zIndex) ? part.zIndex : 0,
    }))
    .sort(
      (left, right) => left.zIndex - right.zIndex || left.index - right.index,
    );

  for (const { part } of orderedParts) {
    for (const primitive of part.primitives) {
      switch (primitive.type) {
        case "rect":
          fillRect(
            context,
            primitive.x,
            primitive.y,
            primitive.width,
            primitive.height,
            primitive.color,
          );
          break;
        case "polygon":
          fillPolygon(context, primitive);
          break;
        case "run":
          fillRect(
            context,
            primitive.x,
            primitive.y,
            primitive.length,
            1,
            primitive.color,
          );
          break;
        case "matrix":
          fillMatrix(context, primitive);
          break;
        default:
          throw new Error(`Unsupported avatar primitive: ${primitive.type}`);
      }
    }
  }

  return { width: size, height: size, data };
}

export async function avatarPixelHash(avatar, state, viewport = "full") {
  const pixels = renderAvatarPixels(avatar, state, viewport);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", pixels.data);
  const hash = Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  return { ...pixels, hash };
}
