/* Who decides how wide the board is, once the window is narrow?
   (needs the QA browser on :9333 - see README, "Browser QA"; the numbers this produced are in
   README, "The board had to learn to shrink")

   The page sizes the board from the width of the element holding it, so this reads that width and the
   whole chain above it - the column, the card, the document's own width - at a phone-width window, at
   a phone-width window in the phone branch, and at the width the other gates run at. It then narrows
   the window once more without reloading, to see whether the page follows: a board that is holding its
   own space open only moves by the difference, which is how the bug showed up (360 px of window still
   gave 695 px of board). Nothing here is asserted; the point is the table.

   Run: node qa/narrow-fit.mjs */
import path from 'node:path';
const ROOT = path.resolve(import.meta.dirname, '..');
const CDP = 'http://127.0.0.1:9333';
const PAGE = 'file:///' + path.join(ROOT, 'index.html').replace(/\\/g, '/');

const list = await (await fetch(CDP + '/json/list')).json();
const page = list.find((t) => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
const send = (method, params) => new Promise((res) => { const n = ++id; pending.set(n, res); ws.send(JSON.stringify({ id: n, method, params })); });
ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result || m); pending.delete(m.id); } };
await new Promise((res) => { ws.onopen = res; });
const ev = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true });
  if (r.exceptionDetails) return 'THREW: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result?.value;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
await send('Page.enable');
await send('Runtime.enable');

const LOOK = `(function(){
  var host=document.getElementById('boardHost'), card=document.getElementById('boardCard'),
      play=document.getElementById('playCol'), lay=document.querySelector('.layout');
  var cv=document.getElementById('board'), r=cv.getBoundingClientRect();
  function box(e){return e?Math.round(e.getBoundingClientRect().width)+' clientW='+(e.clientWidth||0):'-';}
  return JSON.stringify({
    innerWidth:innerWidth, docClientWidth:document.documentElement.clientWidth,
    bodyScrollWidth:document.body.scrollWidth, docScrollWidth:document.documentElement.scrollWidth,
    narrowMedia:matchMedia('(max-width: 980px)').matches,
    layoutColumns:getComputedStyle(lay).gridTemplateColumns,
    playColWidth:box(play), cardWidth:box(card), hostWidth:box(host),
    canvasAttr:[cv.getAttribute('width'),cv.getAttribute('height')],
    canvasBacking:[cv.width,cv.height], canvasCssBox:[Math.round(r.width),Math.round(r.height)],
    canvasStyleWidth:cv.style.width, boardSize:document.getElementById('sizeSel').value
  });})()`;

for (const c of [
  { label: 'window 393x852 (a phone-width window, desktop branch)', metrics: { width: 393, height: 852, deviceScaleFactor: 2, mobile: false } },
  { label: 'mobile 393x852 (the phone branch)', metrics: { width: 393, height: 852, deviceScaleFactor: 3, mobile: true }, touch: true },
  { label: 'window 1440x900 (as the other gates run it)', metrics: null }
]) {
  if (c.metrics) await send('Emulation.setDeviceMetricsOverride', c.metrics);
  else await send('Emulation.clearDeviceMetricsOverride');
  await send('Emulation.setTouchEmulationEnabled', { enabled: !!c.touch, maxTouchPoints: c.touch ? 5 : 0 });
  await send('Page.navigate', { url: 'about:blank' });
  await sleep(400);
  await send('Page.navigate', { url: PAGE });
  await sleep(300);
  /* start from nothing remembered, so the desktop branch is measured with its own defaults */
  await ev("localStorage.removeItem('match5.prefs.v1'); 'clean'");
  await send('Page.navigate', { url: PAGE });
  await sleep(2200);
  console.log('\n--- ' + c.label);
  console.log('  at load:   ' + await ev(LOOK));
  /* does it fix itself if the window is asked to narrow again? the page has a resize handler; a page
     that overflows may never see one, because the document itself is already as wide as the board */
  if (c.metrics) {
    await send('Emulation.setDeviceMetricsOverride', { width: 360, height: 780, deviceScaleFactor: 2, mobile: false });
    await sleep(1200);
    console.log('  after the window narrows to 360: ' + await ev(LOOK));
  }
}
await send('Emulation.clearDeviceMetricsOverride');
await send('Page.navigate', { url: 'about:blank' });
ws.close();
