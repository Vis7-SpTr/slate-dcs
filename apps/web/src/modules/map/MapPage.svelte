<!-- SPDX-License-Identifier: GPL-3.0-or-later -->
<!-- The map always fills the content area (ui-design.md §2). The moving map itself comes in P3. -->
<script lang="ts">
  import { t } from '../../lib/i18n/index.js';
</script>

<div class="map">
  <div class="placeholder">
    <h2>{t('soon.map.title')}</h2>
    <p>{t('soon.map.text')}</p>
  </div>
</div>

<style>
  .map {
    height: 100%;
    display: grid;
    place-items: center;
    background-color: #10161c;
    background-image:
      linear-gradient(var(--surface-2) 1px, transparent 1px),
      linear-gradient(90deg, var(--surface-2) 1px, transparent 1px);
    background-size: 4rem 4rem;
  }

  .placeholder {
    max-width: 24rem;
    padding: 1.25rem 1.5rem;
    border: 1px solid var(--line);
    border-radius: var(--radius);
    background: var(--surface);
    text-align: center;
  }

  h2 {
    margin-bottom: 0.5rem;
    font-size: 1.125rem;
  }

  p {
    color: var(--text-dim);
  }
</style>
