// Pop-up swipe-down decisions (B18). Pure functions, mock numbers only.
import { SWIPE, canStartDrag, shouldClose, dragOffset } from '../gesture.js';
let pass = 0, fail = 0;
const ok = (n, c) => { c ? pass++ : (fail++, console.log(`FAIL  ${n}`)); };
ok('a drag from the grabber starts after a few pixels, even when the pop-up is scrolled', canStartDrag({ dy: 12, inHandle: true, scrollTop: 300 }));
ok('a drag from the content starts only when the pop-up is at its top', canStartDrag({ dy: 12, inHandle: false, scrollTop: 0 }) && !canStartDrag({ dy: 12, inHandle: false, scrollTop: 40 }));
ok('tiny movements and upward movements do not start a drag', !canStartDrag({ dy: 3, inHandle: true, scrollTop: 0 }) && !canStartDrag({ dy: -30, inHandle: true, scrollTop: 0 }));
ok('a long pull closes', shouldClose(SWIPE.close, 600) && shouldClose(200, 900));
ok('a short slow pull springs back', !shouldClose(40, 800) && !shouldClose(10, 20));
ok('a short fast flick closes', shouldClose(50, 60));
ok('the pop-up never moves above its place', dragOffset(-20) === 0 && dragOffset(35) === 35);
console.log(`gesture: ${pass} passed, ${fail} failed`); if (fail) process.exit(1);
