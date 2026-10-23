// SPDX-License-Identifier: GPL-3.0-or-later
// The few pages a device on the LAN sees before it is paired. No scripts
// (the CSP allows none inline); styles come from /lan.css.

const page = (title: string, body: string, refresh = '') => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
${refresh}<title>${title} – SLATE</title>
<link rel="stylesheet" href="/lan.css">
</head>
<body>
<main>
<h1>${title}</h1>
${body}
</main>
</body>
</html>
`;

export const NOT_PAIRED_PAGE = page(
  'Not paired',
  `<p>This device isn't paired with SLATE yet, so it can't see or change anything.</p>
<p>On the SLATE PC open <b>More → Settings → Screens on your network</b>, press <b>Pair a device</b> and scan the QR code with this device's camera.</p>`,
);

/** After pairing: a same-site hop to the app, so the SameSite=Strict cookie is sent. */
export const PAIRED_PAGE = page(
  'Paired',
  `<p>This device is now paired with SLATE.</p>
<p><a href="/">Open SLATE</a></p>
<p class="dim">Tip: add this page to your home screen. If the PC's address changes, pair again.</p>`,
  '<meta http-equiv="refresh" content="1; url=/">\n',
);

export const PAIR_FAILED_PAGE = page(
  'Pairing failed',
  `<p>This pairing code is wrong, used or expired (codes work once, for 5 minutes).</p>
<p>On the SLATE PC press <b>Pair a device</b> again and scan the new QR code.</p>`,
);

export const LAN_CSS = `:root { color-scheme: dark; }
body { margin: 0; background: #0e1216; color: #dde2e7; font: 17px/1.45 system-ui, sans-serif; }
main { max-width: 32rem; margin: 3rem auto; padding: 0 1.25rem; }
h1 { font-size: 1.4rem; color: #f3b23c; }
a { color: #58a6ff; font-weight: 700; font-size: 1.15rem; }
.dim { color: #8d99a6; font-size: 0.9rem; }
`;
