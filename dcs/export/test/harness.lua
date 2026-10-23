-- SPDX-License-Identifier: GPL-3.0-or-later
--[[
  Test harness for the SLATE Lua bridge: runs SLATE-export.lua or
  SLATE-hook.lua against a mocked DCS (Lua 5.1, like DCS) and prints what
  they do, one line each:
    DGRAM <json>        a datagram sent over UDP
    PEER <host> <port>  where the UDP socket points
    CHAIN <callback>    another tool's export callback was called
    CHAT <to> <from> <text>  net.send_chat_to (server hook)
    PROBE <host> <port>      TCP connect to see if the relay runs (server hook)
    EXEC <command>           os.execute (server hook starting the relay)
    LOG <text>          a line written to dcs.log
    DONE                the scenario finished without raising

  Usage: lua5.1 harness.lua <scenario> [<Saved Games folder>]
  The folder (default: dcs/export/) is what lfs.writedir() returns – the
  server scenarios get a temporary one with the relay's announce file.
  Run from tests/lua-bridge.test.ts, which checks the datagrams against the
  host's schemas (packages/shared/src/bridge.ts).
]]

local scenario = arg[1] or ''
local SEP = package.config:sub(1, 1)
local here = (arg[0]:match('^(.*)[/\\]') or '.') .. SEP
local ROOT = here .. '..' .. SEP -- dcs/export/, the "Saved Games\DCS\" of the test
local SERVER_HOOK = here .. '..' .. SEP .. '..' .. SEP .. 'server-hook' .. SEP .. 'Scripts' .. SEP .. 'Hooks' .. SEP .. 'SLATE-server-hook.lua'
local WRITEDIR = arg[2] and (arg[2]:gsub('[/\\]$', '') .. SEP) or ROOT

-- ---------------------------------------------------------------------------
-- Mocked DCS environment

local clock = 1000 -- real time, s
local function advance(seconds) clock = clock + seconds end

package.loaded['lfs'] = { writedir = function() return WRITEDIR end }
local tcpAnswers = false -- does something listen on the probed TCP port?
package.loaded['socket'] = {
    gettime = function() return clock end,
    tcp = function()
        return {
            settimeout = function() end,
            connect = function(_, host, port)
                print('PROBE ' .. host .. ' ' .. tostring(port))
                if tcpAnswers then return 1 end
                return nil, 'connection refused'
            end,
            close = function() end,
        }
    end,
    udp = function()
        return {
            settimeout = function() end,
            setpeername = function(_, host, port) print('PEER ' .. host .. ' ' .. tostring(port)) end,
            send = function(_, text) print('DGRAM ' .. text) end,
            close = function() end,
        }
    end,
}
log = {
    ERROR = 2,
    INFO = 4,
    write = function(_, _, text) print('LOG ' .. text) end,
}

-- ---------------------------------------------------------------------------
-- Export side: own-ship getters from spike 3.2 run A (F/A-18C, single player)

local hornet = {
    self = {
        Name = 'FA-18C_hornet',
        UnitName = 'New callsign',
        Heading = 7.07928150892,
        LatLongAlt = { Lat = 43.6440653722, Long = 43.6647501335, Alt = 1216.81689453 },
        Position = { x = -110180.203125, y = 1216.81689453, z = 760833.5625 },
    },
    -- LoLoCoordinatesToGeoCoordinates(x + 1000, z) in the Caucasus projection
    north = { latitude = 43.6529136012, longitude = 43.6663342096 },
    agl = 864.83380127,
    magYaw = 0.672549221908,
    ias = 261.777947529,
    tas = 282.638885498,
    mach = 0.827642619915,
    vs = 0,
    vel = { x = 197.706451416, y = 0, z = 201.982437134 },
    engine = { fuel_internal = 1.20775508881, fuel_external = 0 },
    payload = {
        Cannon = { shells = 578 },
        Stations = {
            { CLSID = '{5CE2FF2A-645A-4197-B48D-8720AC69394F}', count = 1, weapon = { level1 = 4, level2 = 4, level3 = 7, level4 = 136 } },
            { CLSID = 'LAU_117_AGM_65F', count = 1, weapon = { level1 = 4, level2 = 4, level3 = 8, level4 = 271 } },
            { CLSID = '{BRU33_2X_ROCKEYE}', count = 2, weapon = { level1 = 4, level2 = 5, level3 = 38, level4 = 45 } },
            { CLSID = '{AAQ-28_LEFT}', count = 1, weapon = { level1 = 4, level2 = 15, level3 = 44, level4 = 425 } },
            { CLSID = '{FPU_8A_FUEL_TANK}', count = 1, weapon = { level1 = 1, level2 = 3, level3 = 43, level4 = 587 } },
            { CLSID = '', count = 0, weapon = { level1 = 0, level2 = 0, level3 = 0, level4 = 0 } },
        },
    },
    snares = { chaff = 60, flare = 60 },
}

local NAMES = {
    ['4,4,7,136'] = 'AIM-9X',
    ['4,4,8,271'] = 'AGM-65F Maverick',
    ['4,5,38,45'] = 'Mk20 Rockeye',
    ['4,15,44,425'] = 'aaq-28LEFT litening',
    ['1,3,43,587'] = 'FPU_8A',
}

local data = hornet
local modelTime = 0
local nameLookups = 0

local function installGetters(mode)
    -- mode: 'data' (normal), 'nil' (JTAC on the F10 map), 'error' (every getter raises)
    local function getter(value)
        return function()
            if mode == 'error' then error('getter broken') end
            if mode == 'nil' then return nil end
            return value()
        end
    end
    LoGetModelTime = function() return modelTime end
    LoGetMissionStartTime = function() return 64800 end
    LoGetVersionInfo = function() return { ProductVersion = { 2, 9, 30, 28738 } } end
    LoGetSelfData = getter(function() return data.self end)
    LoLoCoordinatesToGeoCoordinates = getter(function() return data.north end)
    LoGetAltitudeAboveGroundLevel = getter(function() return data.agl end)
    LoGetMagneticYaw = getter(function() return data.magYaw end)
    LoGetIndicatedAirSpeed = getter(function() return data.ias end)
    LoGetTrueAirSpeed = getter(function() return data.tas end)
    LoGetMachNumber = getter(function() return data.mach end)
    LoGetVerticalVelocity = getter(function() return data.vs end)
    LoGetVectorVelocity = getter(function() return data.vel end)
    LoGetEngineInfo = getter(function() return data.engine end)
    LoGetPayloadInfo = getter(function() return data.payload end)
    LoGetSnares = getter(function() return data.snares end)
    LoGetNameByType = function(l1, l2, l3, l4)
        nameLookups = nameLookups + 1
        return NAMES[table.concat({ l1, l2, l3, l4 }, ',')] or ('UNKNOWN_' .. table.concat({ l1, l2, l3, l4 }, ','))
    end
end

-- Another export tool loaded before SLATE (like Tacview): its callbacks must keep running.
local function installOtherTool()
    LuaExportStart = function() print('CHAIN start') end
    LuaExportAfterNextFrame = function() print('CHAIN frame') end
    LuaExportStop = function() print('CHAIN stop') end
end

local function loadExport()
    dofile(ROOT .. 'Scripts' .. SEP .. 'SLATE' .. SEP .. 'SLATE-export.lua')
end

-- Runs `seconds` of frames at 50 fps.
local function frames(seconds)
    for _ = 1, math.floor(seconds * 50 + 0.5) do
        advance(0.02)
        modelTime = modelTime + 0.02
        LuaExportAfterNextFrame()
    end
end

-- ---------------------------------------------------------------------------
-- Hook side: GUI environment (spike 3.2 run B, group server)

local hookCallbacks
local hookState = {
    modelTime = 8279.159,
    side = 0,
    slot = '',
    unitType = nil,
    missionError = false,
}

local function installGui()
    DCS = {
        setUserCallbacks = function(cb) hookCallbacks = cb end,
        getRealTime = function() return clock end,
        getModelTime = function() return hookState.modelTime end,
        isMultiplayer = function() return true end,
        isServer = function() return false end,
        getMissionName = function() return 'VWA_CAU_2.2.11' end,
        getPlayerUnitType = function() return hookState.unitType end,
        getCurrentMission = function()
            if hookState.missionError then error('mission not readable') end
            return {
                mission = {
                    theatre = 'Caucasus',
                    date = { Year = 2026, Month = 10, Day = 9 },
                    start_time = 36000,
                    coalition = {
                        blue = {
                            country = {
                                {
                                    plane = {
                                        group = {
                                            { units = { {}, {} }, route = { points = { {}, {} } }, frequency = 305 },
                                            { units = { {} }, route = { points = {} } },
                                        },
                                    },
                                    vehicle = { group = { { units = { {}, {}, {}, {} } } } },
                                },
                            },
                        },
                        red = { country = {} },
                    },
                },
            }
        end,
    }
    net = {
        get_my_player_id = function() return 4 end,
        get_server_id = function() return 1 end,
        get_player_info = function(id)
            if id ~= 4 then return nil end
            return { name = 'VWA | Pilot', side = hookState.side, slot = hookState.slot, ucid = 'SECRET-UCID', ipaddr = '10.0.0.9' }
        end,
    }
end

local function loadHook()
    dofile(ROOT .. 'Scripts' .. SEP .. 'Hooks' .. SEP .. 'SLATE-hook.lua')
end

local function simFrames(seconds)
    for _ = 1, math.floor(seconds * 10 + 0.5) do
        advance(0.1)
        hookState.modelTime = hookState.modelTime + 0.1
        hookCallbacks.onSimulationFrame()
    end
end

-- ---------------------------------------------------------------------------
-- Scenarios

local scenarios = {}

-- Normal flight: start, 2 s of frames, a release from station 1, stop.
function scenarios.export()
    installGetters('data')
    installOtherTool()
    loadExport()
    LuaExportStart()
    frames(2)
    data.payload.Stations[1].count = 0
    frames(0.5)
    LuaExportStop()
    print('LOOKUPS ' .. nameLookups)
end

-- Loaded twice: chained only once.
function scenarios.twice()
    installGetters('data')
    installOtherTool()
    loadExport()
    loadExport()
    LuaExportStart()
    frames(0.3)
    LuaExportStop()
end

-- JTAC on the F10 map: every own-ship getter returns nil.
function scenarios.empty()
    installGetters('nil')
    loadExport()
    LuaExportStart()
    frames(0.6)
end

-- Every getter raises: SLATE keeps sending, the other tool keeps running.
function scenarios.errors()
    installGetters('error')
    installOtherTool()
    loadExport()
    LuaExportStart()
    frames(0.6)
end

-- No Lo* functions at all, and no previous callbacks.
function scenarios.missing()
    loadExport()
    LuaExportStart()
    frames(0.6)
    LuaExportStop()
end

-- Single-player pause: real time goes on, model time stands still.
function scenarios.pause()
    installGetters('data')
    loadExport()
    LuaExportStart()
    frames(0.5)
    for _ = 1, 50 do
        advance(0.02)
        LuaExportAfterNextFrame()
    end
end

-- MP session: load as spectator, take the Hornet slot, fly, leave.
function scenarios.hook()
    installGui()
    loadHook()
    hookCallbacks.onMissionLoadEnd()
    hookCallbacks.onSimulationStart()
    simFrames(3)
    hookState.side, hookState.slot, hookState.unitType = 2, '1000043', 'FA-18C_hornet'
    hookCallbacks.onPlayerChangeSlot(4)
    simFrames(6)
    hookCallbacks.onSimulationStop()
    simFrames(1)
end

-- Unreadable mission, broken net table: the hook keeps working.
function scenarios.hookErrors()
    installGui()
    hookState.missionError = true
    net = { get_my_player_id = function() error('net broken') end }
    loadHook()
    hookCallbacks.onMissionLoadEnd()
    hookCallbacks.onSimulationStart()
    simFrames(1)
end

-- Chat on a client: only [SLATE] lines are passed on, marked if the server sent them.
function scenarios.hookChat()
    installGui()
    loadHook()
    hookCallbacks.onMissionLoadEnd()
    hookCallbacks.onSimulationStart()
    hookCallbacks.onChatMessage('hello everyone', 7)
    hookCallbacks.onChatMessage('[SLATE] v1 lan 192.168.1.20:7790 code BLUE-7K3Q9XPM fp NZ5N-SEHR-0N1A-CA2G-QN0B-WFQE-30', 1)
    hookCallbacks.onChatMessage('[SLATE] v1 lan 10.6.6.6:7790 code BLUE-7K3Q9XPM fp NZ5N-SEHR-0N1A-CA2G-QN0B-WFQE-30', 7)
    hookCallbacks.onChatMessage('Server: [SLATE] v1 code RED-7K3Q9XPM', 1)
    hookCallbacks.onChatMessage(nil, 1)
    hookCallbacks.onChatMessage(string.rep('x', 10) .. '[SLATE] ' .. string.rep('y', 2000), 1)
end

-- ---------------------------------------------------------------------------
-- Server hook: dedicated server, players 2 (blue later red) and 3 (spectator)

local serverState = { server = true, mp = true, sides = { [2] = 0, [3] = 0 } }

local function installServer()
    DCS = {
        setUserCallbacks = function(cb) hookCallbacks = cb end,
        getRealTime = function() return clock end,
        isServer = function() return serverState.server end,
        isMultiplayer = function() return serverState.mp end,
    }
    net = {
        get_server_id = function() return 1 end,
        get_player_info = function(id, attr)
            if attr == 'side' then return serverState.sides[id] end
            error('the hook should only read the side')
        end,
        send_chat_to = function(text, to, from)
            print('CHAT ' .. tostring(to) .. ' ' .. tostring(from) .. ' ' .. text)
        end,
    }
end

function scenarios.server()
    installServer()
    dofile(SERVER_HOOK)
    hookCallbacks.onPlayerStart(1) -- the server itself: nothing
    hookCallbacks.onPlayerStart(3) -- spectator: nothing
    serverState.sides[2] = 2
    hookCallbacks.onPlayerStart(2) -- blue
    hookCallbacks.onPlayerChangeSlot(2) -- another blue slot at once: not again
    advance(11)
    hookCallbacks.onPlayerChangeSlot(2) -- 11 s later: again
    serverState.sides[2] = 1
    hookCallbacks.onPlayerChangeSlot(2) -- red: at once
    hookCallbacks.onPlayerDisconnect(2)
    hookCallbacks.onPlayerStart(2) -- back: again
    print('MARK single')
    serverState.mp = false
    hookCallbacks.onPlayerStart(2) -- single player: nothing
end

-- Autostart: mission loads on the server start the relay when nothing listens,
-- not twice within a minute, and never when it already runs.
function scenarios.serverAutostart()
    installServer()
    os.execute = function(command) print('EXEC ' .. command) return 0 end
    dofile(SERVER_HOOK)
    hookCallbacks.onMissionLoadEnd() -- nothing listens: start
    hookCallbacks.onMissionLoadEnd() -- again at once: not twice
    advance(61)
    tcpAnswers = true
    hookCallbacks.onMissionLoadEnd() -- it runs: nothing to do
    tcpAnswers = false
    serverState.mp = false
    hookCallbacks.onMissionLoadEnd() -- single player: nothing
end

-- No announce file, or a broken one: no chat, no error reaches DCS.
function scenarios.serverNoFile()
    installServer()
    dofile(SERVER_HOOK)
    serverState.sides[2] = 2
    hookCallbacks.onPlayerStart(2)
    net.get_player_info = function() error('net broken') end
    hookCallbacks.onPlayerChangeSlot(2)
end

local run = scenarios[scenario]
if not run then
    io.stderr:write('unknown scenario: ' .. scenario .. '\n')
    os.exit(2)
end
run()
print('DONE')
