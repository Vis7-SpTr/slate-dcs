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
  RelayFingerprint,
  SessionClosed,
  SessionCode,
  SessionJoin,
  SessionJoined,
  SessionLeave,
  SessionPresence,
  SessionState,
  SessionSwitch,
  SessionUpdate,
  SessionUpdated,
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
  MoveUp,
  normalizeFlightCode,
  PrivateFlightCode,
} from './flights.js';

export {
  Armament,
  ExportAvailability,
  Fuel,
  FuelCall,
  HeadingMagnetic,
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
  WeaponRole,
  weaponsCount,
  WeaponStation,
} from './status.js';
export type { StatusBody, StatusSample } from './status.js';

export {
  CAS_COMMANDS,
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
export type { CasCommandName, CommandName, HostParseResult, ScreenParseResult } from './ui.js';

export {
  AirData,
  AppState,
  Countermeasures,
  DcsFolder,
  DcsFolderProblem,
  DcsFolderState,
  DcsSlice,
  defaultSlices,
  FlightSlice,
  HostSlice,
  LanState,
  MissionSlice,
  OwnshipOverrides,
  OwnshipSlice,
  PairedDevice,
  SessionSlice,
  SettingsSlice,
  SLICE_SCHEMAS,
  SpeedKind,
  SpeedSelection,
  TimeDisplay,
  TrafficSlice,
  UiScale,
} from './slices.js';

export {
  Altitude,
  AltitudeRef,
  AoId,
  AoJoinCode,
  blockInverted,
  Callsign,
  CheckInId,
  CmId,
  Frequency,
  HoldId,
  isValidLaserCode,
  KEYHOLE_AXIS_DEG,
  KEYHOLE_AXIS_NAMES,
  KEYHOLE_MAX_NM,
  KeyholeAxis,
  KeyholePoint,
  keyholePointName,
  LaserCode,
  LatLon,
  LinkedText,
  MAX_FREQUENCIES,
  MissionId,
  Mtime,
  NamedPoint,
  normalizeAoJoinCode,
  PointRef,
} from './cas-common.js';

export {
  Ao,
  AO_RULES,
  AoClosed,
  AoCreated,
  AoJtac,
  AoName,
  AoSpec,
  AoType,
  AoUpdate,
  AoUpdated,
  JtacOffStation,
  JtacOnStation,
} from './aos.js';

export {
  AO_CM_KINDS,
  CM_SHAPES,
  CmCreate,
  CmCreated,
  CmDelete,
  CmDeleted,
  CmKind,
  CmShape,
  CmUpdate,
  CmUpdated,
  MapEntry,
  MapEntryDraft,
  PILOT_CM_KINDS,
  Visibility,
} from './map-entries.js';

export {
  BriefAircraft,
  Capability,
  CasCheckedIn,
  CasCheckedOut,
  CasCheckIn,
  CasCheckOut,
  CasHoldAssign,
  CasHoldCancel,
  CasHoldCancelled,
  CasHoldUpdate,
  CasHoldUpdated,
  CasHoldWilco,
  CasRelease,
  CasSitCopy,
  CasSitUpdate,
  CheckIn,
  CheckInBrief,
  CheckOutReason,
  Hold,
  HoldDraft,
  HoldShape,
  LaserCodes,
  OrdnanceTotal,
  SitUpdate,
} from './checkins.js';

export {
  Abort,
  Assignee,
  Bda,
  BdaEffect,
  Clearance,
  FireMission,
  FM_COMMANDS,
  FmAbort,
  FmAcceptCommand,
  FmAckBda,
  FmAckChange,
  FmAssign,
  FmBda,
  FmBrief,
  FmCancel,
  FmClear,
  FmComplete,
  FmCorrelated,
  FmCreate,
  FmDelete,
  FmDeleted,
  FmOfferCommand,
  FmReadbackCorrect,
  FmReattack,
  FmReclaim,
  FmReturnCommand,
  FmSpi,
  FmUnassign,
  FmUpdate,
  FmUpdated,
  FmVoiceOnly,
  FmWaitingBda,
  FmWindow,
  FmWindowRevoke,
  GamePlan,
  Lane,
  LANE_STATES_OF_MISSION,
  LaneState,
  LaneWarning,
  Mark,
  MarkSource,
  MissionChange,
  MissionContent,
  MissionState,
  NineLine,
  READBACK_FIELDS,
  Remarks,
  Run,
  Spi,
  Window,
  WindowArea,
  WindowDraft,
} from './missions.js';

export { CAS_LOG_RULES, LogArea, LogEntries, LogEntry, LogRequest } from './cas-log.js';

export {
  blocksOverlap,
  destination,
  distanceM,
  HOLD_TURN_RADIUS_M,
  holdArea,
  holdsConflict,
  keyholePosition,
  resolvePoint,
} from './cas-geo.js';
export type { HoldShapeInput, PointLookup } from './cas-geo.js';

export {
  BRIEF_FIELDS,
  BriefField,
  CasLogSlice,
  CasSlice,
  defaultCasSlices,
  Delivery,
  FuelCallsSlice,
  MissionsSlice,
  ReceivedFuelCall,
  SitUpdateNote,
} from './cas-slices.js';

export { Message, parseMessage, parseMessageText } from './messages.js';
export type { MessageTypeName, ParseFailureCode, ParseResult } from './messages.js';

export {
  formatTimeOfDay,
  localTimeOfDay,
  MAP_UTC_OFFSET_HOURS,
  mapUtcOffsetHours,
  zuluTimeOfDay,
} from './maps.js';
export {
  ANNOUNCE_JOIN_MS,
  ANNOUNCE_PREFIX,
  Announcement,
  announcedCoalition,
  AnnouncementReader,
  formatAnnouncement,
  parseAnnouncementLine,
} from './discovery.js';

export { ulid } from './ulid.js';

export {
  BRIDGE_TIMING,
  BRIDGE_VERSION,
  BridgeDatagram,
  BridgeHello,
  BridgeChat,
  BridgeMissionCheck,
  BridgeOwn,
  BridgeSession,
  BridgeStation,
  MissionCounts,
  parseBridgeDatagram,
  SessionEvent,
  WeaponTypeCode,
} from './bridge.js';
export type { BridgeParseResult } from './bridge.js';

export {
  AIRFRAMES,
  airframe,
  FuelUnit,
  fuelUnit,
  fuelWeights,
  unitDisplayName,
} from './airframes.js';
export type { Airframe } from './airframes.js';

export { headingDegFromRad, normalizeDegrees, shortBearingDeg } from './geo.js';

export { armamentTotals, shortStoreName, shortWeaponName } from './weapons.js';
export type { ArmamentTotals, WeaponTotal } from './weapons.js';

export { STATION_LAYOUTS, stationLabel, stationLayout } from './stations.js';
export type { StationLayout, StationPoint } from './stations.js';
