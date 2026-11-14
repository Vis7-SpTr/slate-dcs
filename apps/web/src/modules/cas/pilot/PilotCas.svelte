<!-- SPDX-License-Identifier: GPL-3.0-or-later -->
<!--
  The pilot's one CAS page (ui-design.md §7, workflow compression): it shows
  the phase he is in, top down. Not checked in: the brief and SEND TO. Checked
  in: hold and situation update. A mission up: its card first, the rest
  folded to one line each. The brief stays reachable at the bottom to update
  it or check out.
-->
<script lang="ts">
  import EmptyState from '../../../components/EmptyState.svelte';
  import Fold from '../../../components/Fold.svelte';
  import { checkInOf } from '../../../lib/cas.js';
  import { host } from '../../../lib/host.svelte.js';
  import { t } from '../../../lib/i18n/index.js';
  import { CLOSED_STATES } from '../../../lib/missions.js';
  import CheckInView from '../../ownship/CheckInView.svelte';
  import PilotFlights from './PilotFlights.svelte';
  import PilotMissions from './PilotMissions.svelte';

  const slices = $derived(host.view.slices);
  const own = $derived(slices?.flight.own ?? null);
  const checkIn = $derived(slices && own ? checkInOf(slices, own.flightId) : null);
  const missionUp = $derived(
    slices?.missions.missions.some((m) => !CLOSED_STATES.has(m.state)) ?? false,
  );
</script>

{#if !slices || slices.session.state !== 'joined'}
  <EmptyState title={t('tab.cas')} text={t('cas.noSession')} />
{:else if !own || !checkIn}
  <CheckInView />
{:else}
  <div class="phases">
    <PilotMissions embedded />
    <PilotFlights folded={missionUp} />
    <Fold title={t('pilot.cas.brief')} note={t('pilot.cas.briefNote')}>
      <CheckInView />
    </Fold>
  </div>
{/if}

<style>
  .phases {
    display: grid;
    gap: 0.75rem;
    max-width: 44rem;
    margin-inline: auto;
  }
</style>
