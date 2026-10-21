// SPDX-License-Identifier: GPL-3.0-or-later
// English UI texts (ui-design.md §1 "Language"). Every text the UI shows lives
// here under a key, so more languages can be added without touching components.
// Brevity codes and doctrine terms (CLEARED HOT, ABORT, JOKER, BINGO, 9-line
// terms) stay English in every language. `{name}` marks a parameter.

export const en = {
  // Main tabs (ui-design.md §3); `.short` is used in very narrow windows.
  'tab.map': 'Map',
  'tab.map.short': 'Map',
  'tab.ownship': 'Ownship',
  'tab.ownship.short': 'Own',
  'tab.cas': 'CAS',
  'tab.cas.short': 'CAS',
  'tab.checklist': 'Checklist',
  'tab.checklist.short': 'Check',
  'tab.more': 'More',
  'tab.more.short': 'More',

  // Sub-tabs
  'sub.map.layers': 'Layers',
  'sub.map.declutter': 'Declutter',
  'sub.map.type': 'Map type',
  'sub.map.draw': 'Draw',
  'sub.ownship.aircraft': 'Aircraft',
  'sub.ownship.flight': 'Flight',
  'sub.ownship.checkIn': 'Check-in',
  'sub.cas.flights': 'Flights',
  'sub.cas.missions': 'Fire missions',
  'sub.cas.other': 'Other',
  'sub.checklist.normal': 'Normal',
  'sub.checklist.emergency': 'Emergency',
  'sub.checklist.custom': 'Custom',
  'sub.more.plan': 'Plan',
  'sub.more.efb': 'EFB',
  'sub.more.dtc': 'DTC',
  'sub.more.log': 'CAS log',
  'sub.more.settings': 'Settings',
  'sub.more.dcs': 'DCS',

  // Status strip (ui-design.md §2)
  'strip.noFlight': 'No flight',
  'strip.dcs': 'DCS',
  'strip.relay': 'Relay',
  'strip.checkIn': 'Check-in',
  'strip.notCheckedIn': '—',
  'strip.fuel': 'Fuel',
  'strip.noMission': 'No mission',
  'strip.hostLost': 'Host not connected – reconnecting…',
  'strip.hostConnecting': 'Connecting to host…',
  'strip.reloadNeeded': 'SLATE was updated – please reload this page',

  // Link states
  'link.bridge.waiting': 'waiting',
  'link.bridge.receiving': 'live',
  'link.bridge.stale': 'stopped',
  'link.relay.notConnected': 'off',
  'link.relay.connecting': 'connecting',
  'link.relay.connected': 'connected',

  // Placeholders for pages that come in later phases
  'soon.map.title': 'Moving map',
  'soon.map.text': 'The moving map comes in P3. Map controls appear here with it.',
  'soon.mapControls': 'Map controls come with the moving map (P3).',
  'soon.flight.title': 'Flight',
  'soon.flight.text': 'Creating and joining flights comes with the relay connection (P1.6).',
  'soon.checkIn.title': 'Check-in',
  'soon.checkIn.text': 'Check-in to a JTAC or AO comes with CAS (P2).',
  'soon.cas.title': 'CAS',
  'soon.cas.text': 'Flights, fire missions and the CAS log come in P2.',
  'soon.checklist.title': 'Checklists',
  'soon.checklist.text': 'Normal, emergency and custom checklists come in P4.',
  'soon.plan.title': 'Flight plans',
  'soon.plan.text': 'The flight plan editor and sharing come in P3.',
  'soon.efb.title': 'EFB',
  'soon.efb.text': 'Airfields, frequencies and the mission data card come in P3/P4.',
  'soon.dtc.title': 'DTC editor',
  'soon.dtc.text': 'Reading and writing .dtc files comes in P5.',
  'soon.log.title': 'CAS log',
  'soon.log.text': 'The CAS log and its export come in P2.',

  // Ownship → Aircraft (ui-design.md §8)
  'aircraft.title': 'Aircraft',
  'aircraft.noData': 'No data from DCS yet. Values appear when a mission is running.',
  'aircraft.position': 'Position',
  'aircraft.latLon': 'Lat / Lon',
  'aircraft.altMsl': 'Altitude MSL',
  'aircraft.altAgl': 'Altitude AGL',
  'aircraft.heading': 'Heading',
  'aircraft.gs': 'Ground speed',
  'aircraft.ias': 'IAS',
  'aircraft.age': 'Data age',
  'aircraft.fuel': 'Fuel',
  'aircraft.fuelInternal': 'Internal',
  'aircraft.fuelExternal': 'External',
  'aircraft.fuelTotal': 'Total',
  'aircraft.armament': 'Armament',
  'aircraft.station': 'Station {st}',
  'aircraft.gun': 'Gun',
  'aircraft.rounds': '{rounds} rds',
  'aircraft.stores': 'Pods and tanks',
  'aircraft.noStations': 'No weapons loaded',

  'source.export': 'export',
  'source.server': 'server',
  'source.manual': 'manual',

  // More → Settings
  'settings.title': 'Settings',
  'settings.time': 'Time display',
  'settings.time.help': 'All times are DCS mission time, shown as Zulu or local.',
  'settings.time.zulu': 'Zulu',
  'settings.time.local': 'Local',
  'settings.scale': 'UI scale',
  'settings.scale.help': 'Makes everything bigger or smaller – e.g. for the kneeboard in VR.',
  'settings.scale.down': 'Smaller',
  'settings.scale.up': 'Bigger',
  'settings.about': 'About',
  'settings.build': 'Version',
  'settings.hostBuild': 'Host version',
  'settings.screen': 'This screen',
  'settings.screen.help':
    'Page, tab and scroll position belong to this screen only. Settings are shared by all of your screens.',

  // More → DCS integration
  'dcs.title': 'DCS integration',
  'dcs.bridge': 'Lua bridge',
  'dcs.bridge.waiting': 'Waiting for DCS – nothing received yet',
  'dcs.bridge.receiving': 'Receiving data from DCS',
  'dcs.bridge.stale': 'Stopped – no data from DCS',
  'dcs.mission': 'Mission',
  'dcs.mission.none': 'No mission running',
  'dcs.mission.map': 'Map',
  'dcs.mission.date': 'Date',
  'dcs.install': 'SLATE Lua files',
  'dcs.install.text':
    'Installing, checking, repairing and removing the SLATE files in Saved Games comes in P1.3.',

  // Commands
  'cmd.pending': 'Saving…',
  'cmd.noAnswer': 'No answer from the host',
  'cmd.retry': 'Retry',
  'cmd.failed': 'Not done: {text}',
  'cmd.dismiss': 'OK',

  // Generic
  'value.none': '—',
} as const;

export type MessageKey = keyof typeof en;
