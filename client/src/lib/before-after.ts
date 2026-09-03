/**
 * Before/after slider math.
 *
 * Kept out of the component on purpose: the drag path runs on every
 * `pointermove`, so it must stay allocation-free and boring — and boring
 * arithmetic is exactly the part worth unit-testing. The component owns the
 * DOM and the animation frame; this file owns the numbers.
 *
 * Positions are percentages (0 = fully "before", 100 = fully "after").
 */

/** Handle can never reach the very edge — a slider you can't grab back is broken. */
export const MIN_POS = 2;
export const MAX_POS = 98;

export function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 50;
  return Math.min(MAX_POS, Math.max(MIN_POS, value));
}

/**
 * Pointer x (viewport coords) → handle position, given the track's bounding box.
 * A zero-width box would divide by zero on the very first frame after mount,
 * so it resolves to the midpoint instead of NaN.
 */
export function positionFromPointer(clientX: number, rect: { left: number; width: number }): number {
  if (!rect.width) return 50;
  return clampPercent(((clientX - rect.left) / rect.width) * 100);
}

/** Keyboard stepping: arrows nudge, shift/page jumps, Home/End slam to the ends. */
export function stepPosition(current: number, key: string, coarse = false): number | null {
  const step = coarse ? 10 : 2;
  switch (key) {
    case "ArrowLeft":
    case "ArrowDown":
      return clampPercent(current - step);
    case "ArrowRight":
    case "ArrowUp":
      return clampPercent(current + step);
    case "PageDown":
      return clampPercent(current - 10);
    case "PageUp":
      return clampPercent(current + 10);
    case "Home":
      return MIN_POS;
    case "End":
      return MAX_POS;
    default:
      return null;
  }
}

/**
 * Frame-rate independent easing toward a target.
 *
 * A plain `p += (target - p) * 0.2` per frame moves twice as fast on a 120 Hz
 * phone as on a 60 Hz laptop — the whole reason this takes `dtMs`. `smoothing`
 * is the fraction of the remaining distance left after 16.7 ms.
 */
export function easeToward(current: number, target: number, dtMs: number, smoothing = 0.12): number {
  const t = 1 - Math.pow(smoothing, Math.max(0, dtMs) / 16.6667);
  const next = current + (target - current) * t;
  // Snap when we're within sub-pixel range, otherwise the rAF loop never ends.
  return Math.abs(target - next) < 0.05 ? target : next;
}
