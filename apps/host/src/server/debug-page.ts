// SPDX-License-Identifier: GPL-3.0-or-later
// Debug page at "/debug" (and at "/" while the web UI isn't built). It shows
// the raw host state and sends two test commands – handy to check multiscreen
// sync without the app shell.

export const DEBUG_PAGE_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>SLATE host</title>
<link rel="stylesheet" href="/debug.css">
</head>
<body>
<header>
  <h1>SLATE host</h1>
  <p>Debug page – the raw host state. The app itself is at <a href="/">/</a> once built.</p>
</header>
<section class="status">
  <div><span class="label">Connection</span> <strong id="conn">connecting…</strong></div>
  <div><span class="label">Build</span> <span id="build">–</span></div>
  <div><span class="label">Sequence</span> <span id="seq">–</span></div>
</section>
<section class="actions">
  <button id="toggle-time" type="button">Toggle Zulu / local</button>
  <button id="scale-down" type="button">UI scale −</button>
  <button id="scale-up" type="button">UI scale +</button>
  <span id="result"></span>
</section>
<pre id="state">waiting for snapshot…</pre>
<script src="/debug.js"></script>
</body>
</html>
`;

export const DEBUG_PAGE_CSS = `
:root { color-scheme: dark; }
body { margin: 0; padding: 16px; background: #14181d; color: #d8dde3;
  font: 16px/1.4 system-ui, sans-serif; }
h1 { margin: 0 0 4px; font-size: 22px; }
header p { margin: 0 0 16px; color: #8a96a3; }
a { color: #4ea3ff; }
.status { display: flex; flex-wrap: wrap; gap: 8px 24px; margin-bottom: 16px; }
.label { color: #8a96a3; margin-right: 6px; }
.ok { color: #5fd38d; } .bad { color: #ff6b6b; } .wait { color: #f0b429; }
.actions { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin-bottom: 16px; }
button { min-height: 48px; padding: 0 16px; border: 1px solid #3a4652; border-radius: 6px;
  background: #222a33; color: inherit; font: inherit; cursor: pointer; }
button:active { background: #2e3843; }
pre { margin: 0; padding: 12px; overflow: auto; border-radius: 6px; background: #0d1014;
  font: 13px/1.4 ui-monospace, monospace; }
`;

/** Plain browser JavaScript: no build step, runs in OKB's WebView2, Chrome and Safari. */
export const DEBUG_PAGE_JS = `
'use strict';
const $ = (id) => document.getElementById(id);
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

// ULID: 48-bit time + 80-bit randomness, Crockford base32 (protocol.md §0).
function ulid() {
  let time = Date.now(), timePart = '';
  for (let i = 0; i < 10; i++) { timePart = CROCKFORD[time % 32] + timePart; time = Math.floor(time / 32); }
  const random = crypto.getRandomValues(new Uint8Array(16));
  let randomPart = '';
  for (let i = 0; i < 16; i++) randomPart += CROCKFORD[random[i] % 32];
  return timePart + randomPart;
}

let socket = null, lastSeq = -1, slices = null, attempt = 0, waitingForSnapshot = true;

function setConn(text, cls) { const el = $('conn'); el.textContent = text; el.className = cls; }
function render() { $('seq').textContent = String(lastSeq); $('state').textContent = JSON.stringify(slices, null, 2); }

function connect() {
  setConn('connecting…', 'wait');
  socket = new WebSocket('ws://' + location.host + '/ws');
  socket.onopen = () => { attempt = 0; setConn('connected', 'ok'); };
  socket.onclose = () => {
    setConn('disconnected – retrying', 'bad');
    const delay = Math.min(500 * 2 ** attempt, 5000); attempt++;
    setTimeout(connect, delay);
  };
  socket.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    if (msg.t === 'state.snapshot') {
      lastSeq = msg.seq; slices = msg.body.slices; waitingForSnapshot = false;
      $('build').textContent = msg.body.build; render();
    } else if (msg.t === 'state.update') {
      if (waitingForSnapshot || msg.seq <= lastSeq) return;
      if (msg.seq !== lastSeq + 1) { waitingForSnapshot = true; send({ t: 'state.resync', body: {} }); return; }
      lastSeq = msg.seq; Object.assign(slices, msg.body.slices); render();
    } else if (msg.t === 'cmd.result') {
      $('result').textContent = msg.body.ok ? 'OK' : (msg.body.error.code + ': ' + msg.body.error.text);
    }
  };
}

function send(message) { if (socket && socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message)); }
function command(cmd, args) { $('result').textContent = '…'; send({ t: 'cmd', id: ulid(), body: { cmd, args } }); }

$('toggle-time').onclick = () => {
  if (!slices) return;
  command('settings.set', { timeDisplay: slices.settings.timeDisplay === 'zulu' ? 'local' : 'zulu' });
};
$('scale-down').onclick = () => slices && command('settings.set', { uiScale: Math.max(0.5, +(slices.settings.uiScale - 0.25).toFixed(2)) });
$('scale-up').onclick = () => slices && command('settings.set', { uiScale: Math.min(3, +(slices.settings.uiScale + 0.25).toFixed(2)) });

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && (!socket || socket.readyState === WebSocket.CLOSED)) connect();
});
connect();
`;
