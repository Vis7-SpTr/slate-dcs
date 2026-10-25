-- SPDX-License-Identifier: GPL-3.0-or-later
--[[
  SLATE server hook – discovery announcement (P1.7, protocol.md §2).

  Lives in the DEDICATED SERVER's Saved Games folder (e.g.
  Saved Games\DCS.server\Scripts\Hooks\), never on a player's PC. slate-relay
  copies it there at every start (relay.json "dcsServerFolder").

  When a player is in the mission (onPlayerStart) and on every slot change
  (onPlayerChangeSlot), it sends him – only him – the [SLATE] line(s) of his
  coalition with net.send_chat_to. Spectators get nothing. His SLATE app
  reads the line and joins the right session by itself.

  The lines come from Scripts\SLATE\SLATE-announce.lua, written by
  slate-relay at every start and emptied when it stops – or, for a relay
  hosted elsewhere (remoteRelay, 25 Oct 2026), written once and kept. The
  file is read again for every announcement, so a relay restart needs no
  mission restart.

  Autostart (decided 23 Oct 2026): when the server loads a mission and
  nothing answers on the relay's port, the hook starts slate-relay as
  Scripts\SLATE\SLATE-relay.lua says (written by the relay; missing = off).

  Rules (architecture.md §1.1, scope C3 exception):
    * The chat line is the hook's one and only write to the game. It reads
      nothing about the players except their side, and changes nothing in
      the mission. Starting the relay is a program start on the server PC,
      not a change to the simulation.
    * Only on a multiplayer server.
    * A player gets the same coalition's line at most once per 10 s.
    * Every callback is wrapped in pcall – an error here can't break the server.
]]

do
    local lfs = require('lfs')
    local SEP = package.config:sub(1, 1)
    local FILE = lfs.writedir() .. 'Scripts' .. SEP .. 'SLATE' .. SEP .. 'SLATE-announce.lua'
    local AUTOSTART = lfs.writedir() .. 'Scripts' .. SEP .. 'SLATE' .. SEP .. 'SLATE-relay.lua'
    local START_AGAIN_AFTER = 60 -- s real time: a relay that didn't come up isn't started in a loop
    local PREFIX = '[SLATE]'
    local REPEAT_AFTER = 10 -- s real time
    local MAX_ERRORS = 20
    local SIDES = { [1] = 'red', [2] = 'blue' }

    local sent = {} -- [player id] = { side = 1|2, at = real time }
    local errors = 0
    local startedAt = nil

    local function write(level, text)
        if type(log) == 'table' and type(log.write) == 'function' then
            pcall(log.write, 'SLATE', level, text)
        end
    end

    local function realTime()
        local ok, t = pcall(DCS.getRealTime)
        if ok and type(t) == 'number' then return t end
        return os.time()
    end

    -- A file the relay wrote: `return { … }`, run without any globals, so it
    -- can only return data.
    local function readData(path)
        local chunk = loadfile(path)
        if not chunk then return nil end
        setfenv(chunk, {})
        local ok, data = pcall(chunk)
        if ok and type(data) == 'table' then return data end
        return nil
    end

    local function readAnnouncement()
        return readData(FILE)
    end

    -- Does anything answer on the relay's port on this PC?
    local function listening(port)
        local ok, socket = pcall(require, 'socket')
        if not ok or type(socket) ~= 'table' then return true end -- can't tell: don't start a second one
        local tcp = socket.tcp()
        if not tcp then return true end
        tcp:settimeout(0.5)
        local connected = tcp:connect('127.0.0.1', port)
        tcp:close()
        return connected ~= nil
    end

    local function quote(text)
        return '"' .. text .. '"'
    end

    -- Starts slate-relay if it isn't running (mission load on the server).
    local function ensureRelay()
        if not (DCS.isServer() and DCS.isMultiplayer()) then return end
        local start = readData(AUTOSTART)
        if not start or type(start.exe) ~= 'string' or type(start.port) ~= 'number' then return end
        if listening(start.port) then return end
        local now = realTime()
        if startedAt and now - startedAt < START_AGAIN_AFTER then return end
        startedAt = now
        local parts = { 'start', quote('slate-relay'), '/min', quote(start.exe) }
        for _, arg in ipairs(type(start.args) == 'table' and start.args or {}) do
            if type(arg) == 'string' and not arg:find('"', 1, true) then parts[#parts + 1] = quote(arg) end
        end
        write(log and log.INFO, 'starting slate-relay: ' .. start.exe)
        os.execute(table.concat(parts, ' '))
    end

    local function announce(id)
        if not (DCS.isServer() and DCS.isMultiplayer()) then return end
        local server = net.get_server_id()
        if id == server then return end
        local side = net.get_player_info(id, 'side')
        local key = SIDES[side]
        if not key then
            sent[id] = nil -- spectator: announce again once he picks a side
            return
        end
        local now = realTime()
        local last = sent[id]
        if last and last.side == side and now - last.at < REPEAT_AFTER then return end
        local data = readAnnouncement()
        local lines = data and data[key]
        if type(lines) ~= 'table' then return end
        local any = false
        for _, line in ipairs(lines) do
            if type(line) == 'string' and line:sub(1, #PREFIX) == PREFIX then
                net.send_chat_to(line, id, server)
                any = true
            end
        end
        if any then sent[id] = { side = side, at = now } end
    end

    local callbacks = {}

    function callbacks.onMissionLoadEnd()
        ensureRelay()
    end

    function callbacks.onPlayerStart(id)
        announce(id)
    end

    function callbacks.onPlayerChangeSlot(id)
        announce(id)
    end

    function callbacks.onPlayerDisconnect(id)
        sent[id] = nil
    end

    function callbacks.onSimulationStop()
        sent = {}
    end

    -- Every callback guarded: an error is logged (20 at most) and never reaches DCS.
    local guarded = {}
    for name, fn in pairs(callbacks) do
        guarded[name] = function(...)
            local ok, err = pcall(fn, ...)
            if not ok and errors < MAX_ERRORS then
                errors = errors + 1
                write(log and log.ERROR, 'server hook ' .. name .. ': ' .. tostring(err))
            end
        end
    end

    local ok, err = pcall(DCS.setUserCallbacks, guarded)
    if not ok then write(log and log.ERROR, 'server hook load: ' .. tostring(err)) end
end
