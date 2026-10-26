// Sidebar check (needs the QA Chrome on :9333, like cdp-drive.mjs). It measures what a
// screenshot alone should not be trusted for: where the Engine report sits on the first
// screen, the computed colour of the decision text and of the log lines, what the decision
// log actually holds, and that the advanced settings are folded by default while the summary
// line still states what is pinned. It also photographs the log and the opened panel.
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const QA = path.join(ROOT, 'qa');
const base = 'http://127.0.0.1:9333';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const list = await (await fetch(base + '/json/list')).json();
const page = list.find((t) => t.type === 'page');
if (!page) throw new Error('no page target: ' + list.map((t) => t.type).join(','));

const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('ws failed')); });
let idc = 0;
const pending = new Map();
const errors = [];
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
  if (m.method === 'Runtime.exceptionThrown') {
    const d = m.params.exceptionDetails || {};
    errors.push('EXCEPTION: ' + (d.exception?.description || d.text));
  } else if (m.method === 'Log.entryAdded' && m.params.entry?.level === 'error') {
    errors.push('LOG: ' + m.params.entry.text);
  }
};
const send = (method, params = {}) => new Promise((res) => { const id = ++idc; pending.set(id, res); ws.send(JSON.stringify({ id, method, params })); });
const evaluate = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true });
  return r.result?.result?.value;
};
const shot = async (name) => {
  const r = await send('Page.captureScreenshot', { format: 'png' });
  if (!r.result?.data) { console.log('no screenshot data'); return; }
  const p = path.join(QA, name);
  fs.writeFileSync(p, Buffer.from(r.result.data, 'base64'));
  console.log('wrote ' + path.relative(ROOT, p) + ' (' + fs.statSync(p).size.toLocaleString('en-US') + ' bytes)');
};
const fileUrl = (p, hash) => 'file:///' + path.join(ROOT, p).replace(/\\/g, '/') + (hash || '');

await send('Page.enable');
await send('Runtime.enable');

await send('Page.navigate', { url: fileUrl('qa/probe.html', '#fast') });
await sleep(16000);

console.log('where things sit on the first screen: ' + await evaluate(
  "(function(){var g=function(id){var r=document.getElementById(id).getBoundingClientRect();" +
  "return {top:Math.round(r.top),bottom:Math.round(r.bottom),visible:Math.round(r.bottom)<window.innerHeight};};" +
  "return JSON.stringify({viewport:[window.innerWidth,window.innerHeight],reportRow:g('stBy'),logHeading:g('logList'),docHeight:document.documentElement.scrollHeight});})()"));

console.log('the log as it stands: ' + await evaluate(
  "(function(){var l=document.getElementById('logList');var k=l.querySelectorAll('.msg');" +
  "var cols={},out=[];k.forEach(function(m){var c=getComputedStyle(m.querySelector('.mv')).color;cols[c]=(cols[c]||0)+1;});" +
  "out.push(k.length+' lines');out.push(JSON.stringify(cols));" +
  "out.push('newest: '+k[k.length-1].textContent.replace(/\\s+/g,' '));" +
  "out.push('oldest: '+k[0].textContent.replace(/\\s+/g,' '));" +
  "return out.join(' | ');})()"));

console.log('settings panel before opening: ' + await evaluate(
  "(function(){var d=document.getElementById('settingsCard');var r=d.getBoundingClientRect();" +
  "var c=document.querySelector('#logList').getBoundingClientRect();" +
  "return JSON.stringify({open:d.open,cardTop:Math.round(r.top),cardBottom:Math.round(r.bottom)," +
  "summaryText:document.querySelector('#settingsCard summary').textContent.replace(/\\s+/g,' ').slice(0,190)," +
  "logBottomAboveSettings:Math.round(c.bottom)<Math.round(r.top)});})()"));

await evaluate("window.scrollTo(0, document.documentElement.scrollHeight); 'ok'");
await sleep(500);
await shot('log-look.png');

await evaluate("document.getElementById('settingsCard').open = true; 'ok'");
await sleep(400);
// bring the opened panel into view, otherwise the photograph shows a closed-looking card
await evaluate("document.getElementById('settingsCard').scrollIntoView({ block: 'start' }); 'ok'");
await sleep(300);
console.log('settings panel after opening: ' + await evaluate(
  "(function(){var d=document.getElementById('settingsCard');var r=d.getBoundingClientRect();" +
  "return JSON.stringify({open:d.open,height:Math.round(r.height),controls:[].slice.call(d.querySelectorAll('select,input')).map(function(e){return e.id+'='+e.value;})});})()"));
await shot('settings-open.png');

console.log('js errors: ' + (errors.length ? errors.join(' | ') : 'none'));
ws.close();
