// SPDX-License-Identifier: GPL-3.0-or-later
// Public entry point of @slate-dcs/shared.

export { DEFAULT_PORTS, PROTOCOL_VERSION, SESSION_TIMING } from './protocol.js';
export type { PortName } from './protocol.js';

export {
  Address,
  defineMessage,
  Envelope,
  EnvelopeBase,
  MessageId,
  MessageType,
} from './envelope.js';

export {
  ERROR_CODES,
  ErrorMessage,
  Hello,
  MsgReceived,
  negotiateProtocol,
  Reject,
  RelayReceipt,
  Welcome,
} from './control.js';
export type { ErrorCode } from './control.js';

export {
  AircraftInfo,
  AircraftType,
  Coalition,
  EpochMs,
  Nick,
  Pid,
  Presence,
  RoleId,
  Seq,
} from './common.js';

export {
  CLOSE_REASONS,
  normalizeSessionCode,
  Participant,
  SessionClosed,
  SessionCode,
  SessionJoin,
  SessionJoined,
  SessionLeave,
  SessionPresence,
  SessionState,
  SessionSwitch,
  Token,
} from './session.js';
export type { CloseReason } from './session.js';

export {
  Flight,
  FLIGHT_RULES,
  FlightClosed,
  FlightCreate,
  FlightCreated,
  FlightId,
  FlightJoin,
  FlightLeave,
  FlightListed,
  FlightMember,
  FlightMove,
  FlightMoveUp,
  FlightName,
  flightNameKey,
  FlightPosition,
  FlightSummary,
  FlightUpdated,
  LeadReserved,
  normalizeFlightCode,
  PrivateFlightCode,
} from './flights.js';

export {
  Armament,
  ExportAvailability,
  Fuel,
  FuelCall,
  HeadingTrue,
  headingDifference,
  isStale,
  Position,
  SendReason,
  SpeedMs,
  STATUS_TIMING,
  StatusPosition,
  statusSendReason,
  StatusUpdate,
  Store,
  ValueSource,
  WeaponKind,
  weaponsCount,
  WeaponStation,
} from './status.js';
export type { StatusBody, StatusSample } from './status.js';

export {
  Command,
  CommandMessage,
  CommandResult,
  HostToScreen,
  parseHostMessage,
  parseScreenMessage,
  reconnectDelayMs,
  RELAY_COMMANDS,
  RelayAddress,
  ScreenToHost,
  SLICE_NAMES,
  SliceChanges,
  SliceName,
  Slices,
  StateResync,
  StateSnapshot,
  StateUpdate,
  UI_ERROR_CODES,
  UI_TIMING,
  UI_WEBSOCKET_PATH,
  UiErrorCode,
  updateAction,
} from './ui.js';
export type { CommandName, HostParseResult, ScreenParseResult } from './ui.js';

export {
  defaultSlices,
  FlightSlice,
  HostSlice,
  MissionSlice,
  OwnshipOverrides,
  OwnshipSlice,
  SessionSlice,
  SettingsSlice,
  SLICE_SCHEMAS,
  TimeDisplay,
  TrafficSlice,
  UiScale,
} from './slices.js';

export { Message, parseMessage, parseMessageText } from './messages.js';
export type { MessageTypeName, ParseFailureCode, ParseResult } from './messages.js';

export {
  formatTimeOfDay,
  localTimeOfDay,
  MAP_UTC_OFFSET_HOURS,
  mapUtcOffsetHours,
  zuluTimeOfDay,
} from './maps.js';
export { ulid } from './ulid.js';
