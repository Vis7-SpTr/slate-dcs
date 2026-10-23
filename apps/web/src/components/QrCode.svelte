<!-- SPDX-License-Identifier: GPL-3.0-or-later -->
<!--
  A QR code as an SVG path (no HTML strings, CSP-safe). Dark modules on a
  light square with the usual 4-module quiet zone, so phone cameras read it.
-->
<script lang="ts">
  import qrcode from 'qrcode-generator';

  const { text, label }: { text: string; label: string } = $props();

  const QUIET = 4;
  const code = $derived.by(() => {
    const qr = qrcode(0, 'M');
    qr.addData(text);
    qr.make();
    const count = qr.getModuleCount();
    let d = '';
    for (let row = 0; row < count; row += 1) {
      for (let col = 0; col < count; col += 1) {
        if (qr.isDark(row, col)) d += `M${String(col + QUIET)} ${String(row + QUIET)}h1v1h-1z`;
      }
    }
    return { size: count + 2 * QUIET, d };
  });
</script>

<svg
  class="qr"
  viewBox="0 0 {code.size} {code.size}"
  role="img"
  aria-label={label}
  shape-rendering="crispEdges"
>
  <rect width={code.size} height={code.size} fill="#fff" />
  <path d={code.d} fill="#000" />
</svg>

<style>
  .qr {
    display: block;
    width: min(16rem, 100%);
    height: auto;
    border-radius: 0.25rem;
  }
</style>
