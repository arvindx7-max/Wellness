// Pop-up swipe-down (B18). Pure decisions so they can be unit-tested; app.js wires them to the touch events.
// A pop-up follows the finger once the drag starts from the grabber area, or from anywhere when it is scrolled to its top.
export const SWIPE = { start: 8, close: 90, fast: 0.55, handle: 64 };
export const canStartDrag = ({ dy, inHandle, scrollTop }) => dy > SWIPE.start && (inHandle || scrollTop <= 0);
export const shouldClose = (dy, ms) => dy >= SWIPE.close || (dy >= 30 && dy / Math.max(ms, 1) >= SWIPE.fast);
export const dragOffset = (dy) => Math.max(0, dy);
