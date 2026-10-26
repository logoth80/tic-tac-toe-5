// Syntax + structure check for the single-file deliverable: every <script> block
// must parse, the engine markers must exist exactly once, and the engine block must
// be DOM-free so Match5Engine.toString() can be shipped into a Web Worker.
import fs from 'node:fs';
import vm from 'node:vm';

const html = fs.readFileSync(new URL('../match5.html', import.meta.url), 'utf8');
let fails = 0, checks = 0;
const ok = (c, m) => { checks++; if (!c) { fails++; console.log('  FAIL ' + m); } };

const blocks = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)];
ok(blocks.length >= 2, 'expected at least an engine block and a UI block, found ' + blocks.length);
blocks.forEach(([, attrs, code], i) => {
  ok(!/\bsrc\s*=/.test(attrs || ''), 'block ' + i + ' is external (must be one self-contained file)');
  try { new vm.Script(code); ok(true, ''); }
  catch (e) { ok(false, 'script block ' + i + ' does not parse: ' + e.message); }
});

const starts = (html.match(/\/\*__ENGINE_START__\*\//g) || []).length;
const ends = (html.match(/\/\*__ENGINE_END__\*\//g) || []).length;
ok(starts === 1 && ends === 1, 'engine markers must appear exactly once (start ' + starts + ', end ' + ends + ')');

const engine = (html.match(/\/\*__ENGINE_START__\*\/([\s\S]*?)\/\*__ENGINE_END__\*\//) || [])[1] || '';
ok(/^\s*function Match5Engine\s*\(/m.test(engine), 'engine block must start with function Match5Engine()');
const domish = [/\bwindow\s*\./, /\bdocument\s*\./, /\blocalStorage\s*\./, /\bfetch\s*\(/, /\balert\s*\(/, /\bnew Worker\b/];
for (const re of domish) {
  const hits = (engine.match(re) || []).length;
  ok(hits === 0, 'engine block touches ' + re + ' (' + hits + 'x) - worker serialisation risk');
}
ok((engine.match(/performance\.now\s*\(/g) || []).length <= 2, 'engine should guard performance.now in at most the clock helper');
ok(/toString\(\)/.test(html), 'UI must build the worker from Match5Engine.toString()');
ok(/new Worker\(/.test(html), 'UI must create a Worker');
ok(/postMessage/.test(html) && /onmessage/.test(html), 'worker message plumbing missing');

const sizes = (html.match(/const SIZES\s*=\s*\[([^\]]*)\]/) || [])[1] || '';
ok(/(^|[,\s])25([,\s\]]|$)/.test(sizes), '25 must be an offered board size, SIZES = [' + sizes.trim() + ']');
ok(/size:\s*25/.test(html), 'default board size must be 25');
ok(!/<link\b|<script[^>]+\bsrc=/i.test(html), 'file must not depend on external resources');

/* ---- DOM contract: every $(id) lookup must exist in the markup, and every
        ui.<key> reference must be a key of the ui map (catches init crashes) ---- */
{
  const uiSrc = (html.match(/<script>\s*\(function \(\)\s*\{[\s\S]*?<\/script>/) || [''])[0];
  ok(uiSrc.length > 0, 'could not locate the UI script block');
  const mapLit = (uiSrc.match(/const ui = \{([\s\S]*?)\};/) || [])[1] || '';
  const keys = [...mapLit.matchAll(/(?:^|[,{])\s*([A-Za-z0-9_]+):/g)].map((m) => m[1]);
  ok(keys.length > 10, 'ui map should list the DOM handles, found ' + keys.length);

  const looked = [...uiSrc.matchAll(/\$\('([A-Za-z0-9_]+)'\)/g)].map((m) => m[1]);
  const inMarkup = new Set([...html.matchAll(/id="([A-Za-z0-9_]+)"/g)].map((m) => m[1]));
  const missing = looked.filter((id) => !inMarkup.has(id));
  ok(missing.length === 0, '$() lookups with no matching element in the markup: ' + missing.join(', '));

  const used = new Set([...uiSrc.matchAll(/\bui\.([A-Za-z0-9_]+)/g)].map((m) => m[1]));
  const undeclared = [...used].filter((k) => !keys.includes(k));
  ok(undeclared.length === 0, 'ui.<key> references that are not declared in the ui map: ' + undeclared.join(', '));

  // ids that exist but are never wired up are usually leftovers, worth flagging
  const wired = new Set(looked);
  const css = (html.match(/<style>([\s\S]*?)<\/style>/) || [''])[1];
  const styled = new Set([...css.matchAll(/#([A-Za-z0-9_-]+)/g)].map((m) => m[1]));
  const orphan = [...inMarkup].filter((id) => !wired.has(id) && !styled.has(id) && id !== 'engine-src');
  ok(orphan.length === 0, 'markup ids referenced by neither the UI script nor the CSS: ' + orphan.join(', '));
}

/* ---- run the actual worker glue in-process: proves Match5Engine.toString()
        round-trips and the request/response contract is intact ---- */
{
  const Match5Engine = eval('(' + engine + ')');
  const glueLit = (html.match(/const GLUE = \[[\s\S]*?\]\.join\('\\n'\);/) || [])[0];
  ok(!!glueLit, 'could not locate the worker glue in the page');
  if (glueLit) {
    const glueSrc = (new Function('Match5Engine', 'return ' + glueLit.replace(/^const GLUE = /, '')))(Match5Engine);
    let sent = null;
    const fakeSelf = { postMessage: (m) => { sent = m; } };
    try { new Function('self', glueSrc)(fakeSelf); ok(typeof fakeSelf.onmessage === 'function', 'glue did not install onmessage'); }
    catch (e) { ok(false, 'glue failed to evaluate: ' + e.message); }
    const moves = [];
    // X builds a four on row 4, O answers in the corner column: X to move, must complete
    for (const [x, y] of [[3,4],[0,0],[4,4],[0,1],[5,4],[0,2],[6,4],[0,3]]) moves.push(y * 9 + x);
    fakeSelf.onmessage({ data: { cmd: 'search', reqId: 7, size: 9, win: 5, moves, player: 1, level: 'hard', override: { timeMs: 250 } } });
    ok(sent && sent.cmd === 'result', 'worker glue produced no result message');
    ok(sent && sent.reqId === 7, 'worker glue lost reqId');
    ok(sent && typeof sent.result.cell === 'number' && sent.result.cell >= 0, 'worker result has no move');
    ok(sent && (sent.result.cell === 4 * 9 + 2 || sent.result.cell === 4 * 9 + 7),
      'worker should complete the five on row 4, got ' + (sent && sent.result.cell));
    ok(sent && /five/.test(sent.result.forced || ''), 'worker result lost the forced-reason field: ' + (sent.result && sent.result.forced));
    ok(sent && sent.stats && typeof sent.stats.scoreA === 'number', 'worker result missing stats');
    ok(sent && Array.isArray(sent.result.root) && sent.result.root.length > 0, 'worker result missing candidate list');
  }
}

/* ---- theme contract: an alternative palette must redefine every colour the first one defines,
        the themes the page can select must be the palettes the CSS carries, and a remembered
        setting must be checked against the choices actually on offer ---- */
{
  const css = (html.match(/<style>([\s\S]*?)<\/style>/) || ['', ''])[1];
  const names = (src) => new Set([...src.matchAll(/(--[a-z0-9-]+)\s*:/g)].map((m) => m[1]));
  const baseSrc = (css.match(/:root\s*\{([\s\S]*?)\}/) || ['', ''])[1];
  const base = [...names(baseSrc)].filter((v) => !/--(radius|mono|sans)/.test(v));
  ok(baseSrc.includes('--p1') && baseSrc.includes('--p1rgb') && baseSrc.includes('--felt-a'),
    'the first palette must define the stone colours, their rgb parts and the board surface');

  const altBlocks = [...css.matchAll(/\[data-theme=([a-z]+)\]\s*\{([\s\S]*?)\}/g)];
  ok(altBlocks.length >= 1, 'expected at least one alternative [data-theme=...] palette');
  for (const [, name, body] of altBlocks) {
    const have = names(body);
    const missing = base.filter((v) => !have.has(v));
    ok(missing.length === 0, 'theme "' + name + '" forgets ' + missing.length + ' colour(s): ' + missing.join(', '));
  }

  const jsThemes = [...((html.match(/const THEMES = \[([^\]]*)\]/) || ['', ''])[1].matchAll(/'([a-z]+)'/g))].map((m) => m[1]);
  ok(jsThemes.length >= 2, 'the page should offer more than one board colour, found: ' + jsThemes.join(', '));
  const seg = (html.match(/<div class="seg" id="themeSeg">([\s\S]*?)<\/div>/) || ['', ''])[1];
  const offered = [...seg.matchAll(/data-theme="([a-z]+)"/g)].map((m) => m[1]);
  for (const t of jsThemes) {
    ok(offered.includes(t), 'theme ' + t + ' is listed in THEMES but has no control');
    if (t !== jsThemes[0]) ok(altBlocks.some((m) => m[1] === t), 'theme ' + t + ' has no palette block');
  }
  for (const t of offered) ok(jsThemes.includes(t), 'a control offers theme ' + t + ', which the page does not know');

  const prefs = (html.match(/const PREF_KEY[\s\S]*?end of remembered settings/) || [''])[0];
  ok(prefs.length > 0, 'could not locate the remembered-settings block');
  ok((prefs.match(/try \{/g) || []).length >= 2 && (prefs.match(/catch \(/g) || []).length >= 2,
    'storage must be read and written inside a guard: a refused localStorage cannot break the page');
  for (const need of [/remember\(\+saved\.size, SIZES\)/, /remember\(saved\.theme, THEMES\)/,
                      /remember\(saved\.level1, ENG\.LEVEL_ORDER\)/, /remember\(saved\.level2, ENG\.LEVEL_ORDER\)/]) {
    ok(need.test(prefs), 'a remembered value is not checked against the choices on offer: ' + need);
  }
}

/* ---- the decision log reads newest-first: a line goes in at the top and the bounded list is
        trimmed from the bottom. Nothing else breaks if that quietly reverts to appendChild, so
        the rule is stated here instead. The list also owns the reader's position, which only
        works if the browser is not also adjusting it. ---- */
{
  const entry = (html.match(/function logEntry\s*\(\s*o\s*\)\s*\{([\s\S]*?)\n  \}/) || ['', ''])[1];
  ok(entry.length > 0, 'could not locate the logEntry function');
  ok(/insertBefore\(div, list\.firstChild\)/.test(entry) && !/appendChild\(div\)/.test(entry),
    'a new decision line must be inserted at the top of the log');
  ok(/removeChild\(list\.lastChild\)/.test(entry), 'the bounded log must drop the oldest line, not the newest');
  ok(!/scrollTop = list\.scrollHeight/.test(entry), 'the log must not chase its own bottom any more');
  ok(/list\.scrollTop \+= div\.offsetHeight \+ \(parseFloat\(getComputedStyle\(list\)\.rowGap\)/.test(entry),
    'a reader scrolled into older lines must be moved by the row plus the gap above it - the row alone leaves them 6px short on every line');
  const logCss = (html.match(/<style>([\s\S]*?)<\/style>/) || ['', ''])[1];
  ok(/\.log \{[^}]*overflow-anchor: none/.test(logCss),
    'the log list must opt out of browser scroll anchoring, or the reader is moved twice');
}

console.log(fails ? '\nFAILED ' + fails + ' of ' + checks : '\nPARSE/STRUCTURE OK — ' + checks + ' checks');
process.exit(fails ? 1 : 0);
