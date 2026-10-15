/**
 * What a wheel event means for the camera (ADR-042). A mouse wheel zooms. On a laptop's touchpad,
 * two fingers sliding pan the view, and a pinch (which browsers send as a wheel with the Ctrl key)
 * zooms. Browsers do not say which device sent a wheel: a touchpad sends pixel deltas, often
 * sideways or fractional, a mouse wheel whole notches straight up or down. The player's option
 * settles it when the guess is wrong.
 */

/** The player's pointing device (Options): guessed from the wheels, or said. */
export const POINTER_DEVICES = ['auto', 'mouse', 'touchpad'] as const;
export type PointerDevice = (typeof POINTER_DEVICES)[number];

export interface WheelInput {
  readonly deltaX: number;
  readonly deltaY: number;
  readonly deltaMode: number;
  readonly ctrlKey: boolean;
}

export type WheelGesture = { readonly kind: 'zoom'; readonly factor: number } | { readonly kind: 'pan'; readonly rightPx: number; readonly forwardPx: number };

/** WheelEvent.DOM_DELTA_PIXEL: deltas in pixels (touchpads; Chromium's wheels too). */
const DOM_DELTA_PIXEL = 0;
/** A wheel notch scrolls at least this far (Chromium sends 100 px, Firefox about 50). */
const NOTCH_MIN_PX = 40;
/** Zoom per wheel notch (×1.12 or ÷), and per pixel of pinch. */
export const WHEEL_ZOOM_STEP = 0.12;
const PINCH_ZOOM_PER_PX = 0.01;
/** A Ctrl+wheel notch counts as this many pixels of pinch (a notch, not a leap). */
const PINCH_MAX_PX = WHEEL_ZOOM_STEP / PINCH_ZOOM_PER_PX;

/** Does this wheel look like two fingers on a touchpad (not a pinch, not a wheel notch)? */
export function looksLikeTouchpad(e: WheelInput): boolean {
  return e.deltaMode === DOM_DELTA_PIXEL && !e.ctrlKey && (e.deltaX !== 0 || !Number.isInteger(e.deltaY) || Math.abs(e.deltaY) < NOTCH_MIN_PX);
}

/**
 * The camera's move for a wheel, `touchpad` when the wheels come from one. Sliding two fingers
 * down scrolls down, as on a page: the view moves towards the bottom of the screen.
 */
export function wheelGesture(e: WheelInput, touchpad: boolean): WheelGesture {
  if (e.ctrlKey) return { kind: 'zoom', factor: Math.exp(Math.max(-PINCH_MAX_PX, Math.min(PINCH_MAX_PX, e.deltaY)) * PINCH_ZOOM_PER_PX) };
  if (touchpad) return { kind: 'pan', rightPx: e.deltaX, forwardPx: -e.deltaY };
  return { kind: 'zoom', factor: 1 + Math.sign(e.deltaY) * WHEEL_ZOOM_STEP };
}
