import "jassub/dist/worker/worker.js";

// Use libass's native Canvas2D fallback in this dedicated worker to keep the
// transparent subtitle surface separate from GPU video compositing on Windows.
// Keep GPU video decoding enabled; only the subtitle compositor uses 2D.
// JASSUB 2.5.21 auto-detects its renderer and has no selection option. Scope the
// capability override to this worker so the library selects its own 2D path.
const nativeGetContext = OffscreenCanvas.prototype.getContext;
OffscreenCanvas.prototype.getContext = function (
  this: OffscreenCanvas,
  contextId: string,
  options?: unknown,
) {
  if (contextId === "webgl" || contextId === "webgl2") return null;
  return Reflect.apply(nativeGetContext, this, [contextId, options]);
} as typeof nativeGetContext;
