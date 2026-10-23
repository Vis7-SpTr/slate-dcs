-- SPDX-License-Identifier: GPL-3.0-or-later
--[[
  SLATE Lua bridge – GUI hook (bridge version 4).

  Lives in Saved Games\DCS\Scripts\Hooks\ like the SRS hook. Sends what the
  export environment can't see to the SLATE host (UDP 127.0.0.1:7791,
  protocol.md §6.1):
    * session      – mission start/stop, own slot / coalition / unit type,
                     player name, map, mission date and start time; on every
                     change and every 5 s while a mission runs
    * missionCheck – once per mission load: how much of the mission
                     DCS.getCurrentMission() shows on this PC (P1.2 check)
    * hello        – at load and every 30 s
    * chat         – a received chat line starting with "[SLATE]": the
                     server's discovery announcement (protocol.md §2, P1.7).
                     Every other chat line is ignored and never leaves DCS.

  Rules (architecture.md §1.1):
    * READ-ONLY: only DCS.get*/DCS.is*/net.get_* getters and the read-only
      onChatMessage callback. Never sends chat, no slot changes, no
      net.dostring_in, nothing that changes the mission.
    * Own player only: name, side, slot – no UCID, no IP, nobody else.
    * Everything is wrapped in pcall – an error here can't break DCS.
    * Fire-and-forget UDP, never waits.
]]

do
    local lfs = require('lfs')
    local SEP = package.config:sub(1, 1)
    local DIR = lfs.writedir() .. 'Scripts' .. SEP .. 'SLATE' .. SEP

    local POLL_INTERVAL = 2 -- s real time: own slot check, in addition to the event
    local BEAT_INTERVAL = 5 -- s real time: session repeated while a mission runs
    local HELLO_INTERVAL = 30 -- s real time

    local lib, sender
    local running = false
    local mission = nil -- { name, theatre, date, start } of the loaded mission
    local lastSlot = nil
    local nextPoll, nextBeat, nextHello = 0, 0, 0

    local function open()
        if sender then return end
        lib = assert(loadfile(DIR .. 'lib' .. SEP .. 'bridge.lua'))(DIR)
        sender = lib.openSender()
    end

    local function send(datagram)
        if sender then sender.send(datagram) end
    end

    local function realTime()
        return lib.num(lib.call(DCS, 'getRealTime')) or 0
    end

    local function hello()
        send({ t = 'hello', bv = lib.VERSION, env = 'hook' })
        nextHello = realTime() + HELLO_INTERVAL
    end

    -- Counts groups, units, routes and frequencies per coalition – enough to
    -- see whether an MP client gets the whole mission or a filtered one.
    local function missionCounts(m)
        local result = {}
        if type(m.coalition) ~= 'table' then return nil end
        for side, coalition in pairs(m.coalition) do
            local c = { groups = 0, units = 0, routed = 0, withFrequency = 0 }
            local countries = type(coalition) == 'table' and coalition.country
            if type(countries) == 'table' then
                for _, country in pairs(countries) do
                    for _, category in ipairs({ 'plane', 'helicopter', 'vehicle', 'ship', 'static' }) do
                        local list = type(country) == 'table' and country[category]
                        local groups = type(list) == 'table' and list.group
                        if type(groups) == 'table' then
                            for _, group in pairs(groups) do
                                if type(group) == 'table' then
                                    c.groups = c.groups + 1
                                    if type(group.units) == 'table' then
                                        for _ in pairs(group.units) do c.units = c.units + 1 end
                                    end
                                    local route = group.route
                                    if type(route) == 'table' and lib.filled(route.points) then
                                        c.routed = c.routed + 1
                                    end
                                    if (lib.num(group.frequency) or 0) > 0 then
                                        c.withFrequency = c.withFrequency + 1
                                    end
                                end
                            end
                        end
                    end
                end
            end
            result[tostring(side)] = c
        end
        return lib.filled(result)
    end

    -- Mission data, read once per load (getCurrentMission returns the whole mission).
    local function readMission()
        local current = lib.call(DCS, 'getCurrentMission')
        if type(current) ~= 'table' then return nil, nil end
        local m = type(current.mission) == 'table' and current.mission or current
        local info = {
            name = lib.str(lib.call(DCS, 'getMissionName')),
            theatre = lib.str(m.theatre),
            start = lib.num(m.start_time),
        }
        local d = m.date
        if type(d) == 'table' and lib.num(d.Year) and lib.num(d.Month) and lib.num(d.Day) then
            info.date = string.format('%04d-%02d-%02d', d.Year, d.Month, d.Day)
        end
        return lib.filled(info), m
    end

    local function player()
        local p = {}
        local id = lib.call(net, 'get_my_player_id')
        if id ~= nil then
            local info = lib.call(net, 'get_player_info', id)
            if type(info) == 'table' then
                p.name = lib.str(info.name)
                local side = lib.num(info.side)
                if side == 0 or side == 1 or side == 2 then p.side = side end
                p.slot = lib.str(info.slot)
            end
        end
        p.unitType = lib.str(lib.call(DCS, 'getPlayerUnitType'))
        return lib.filled(p)
    end

    local function session(ev)
        nextBeat = realTime() + BEAT_INTERVAL
        local p = player()
        lastSlot = p and table.concat({ tostring(p.side), tostring(p.slot), tostring(p.unitType) }, '|')
        send({
            t = 'session',
            bv = lib.VERSION,
            ev = ev,
            running = running,
            mt = lib.num(lib.call(DCS, 'getModelTime')),
            mission = mission,
            mp = lib.bool(lib.call(DCS, 'isMultiplayer')),
            server = lib.bool(lib.call(DCS, 'isServer')),
            player = p,
        })
    end

    local CHAT_PREFIX = '[SLATE]'
    local CHAT_MAX = 1000 -- characters, as BridgeChat in packages/shared/src/bridge.ts
    local chatLogged = 0

    -- Discovery (P1.7): passes the server's [SLATE] lines on, nothing else.
    -- `server` tells the host whether the server sent it – a player could
    -- type such a line too, and the host only follows the server's.
    -- The prefix is looked for anywhere in the line, in case DCS puts the
    -- sender's name in front (to check on the server PC, spike 3.5).
    local function chat(message, from)
        if type(message) ~= 'string' then return end
        local at = message:find(CHAT_PREFIX, 1, true)
        if not at then return end
        local serverId = lib.num(lib.call(net, 'get_server_id')) or 1
        local sender = lib.num(from)
        -- The first lines also go to dcs.log, for the check on a real server (spike 3.5).
        chatLogged = chatLogged + 1
        if chatLogged <= 5 and type(log) == 'table' and type(log.write) == 'function' then
            pcall(log.write, 'SLATE', log.INFO, string.format('chat line from %s (server %s): %s',
                tostring(from), tostring(serverId), message:sub(1, 200)))
        end
        send({
            t = 'chat',
            bv = lib.VERSION,
            text = message:sub(at, at + CHAT_MAX - 1),
            server = sender == serverId,
            from = sender,
            serverId = serverId,
        })
    end

    local function checkSlot()
        local p = player()
        local slot = p and table.concat({ tostring(p.side), tostring(p.slot), tostring(p.unitType) }, '|')
        if slot ~= lastSlot then session('slot') end
    end

    local callbacks = {}

    function callbacks.onMissionLoadEnd()
        open()
        running = false
        local m
        mission, m = readMission()
        hello()
        session('load')
        local counts = m and missionCounts(m)
        if counts then send({ t = 'missionCheck', bv = lib.VERSION, coalitions = counts }) end
    end

    function callbacks.onSimulationStart()
        open()
        running = true
        if mission == nil then mission = readMission() end
        session('start')
    end

    function callbacks.onSimulationStop()
        if not sender then return end
        running = false
        session('stop')
        mission = nil
        lastSlot = nil
    end

    function callbacks.onPlayerChangeSlot(id)
        if not sender or not running then return end
        if id == lib.call(net, 'get_my_player_id') then checkSlot() end
    end

    function callbacks.onChatMessage(message, from)
        if not sender then return end
        chat(message, from)
    end

    function callbacks.onSimulationFrame()
        if not sender or not running then return end
        local now = realTime()
        if now >= nextPoll then
            nextPoll = now + POLL_INTERVAL
            checkSlot()
        end
        if now >= nextBeat then session('beat') end
        if now >= nextHello then hello() end
    end

    -- Every callback guarded: an error is logged (20 at most) and never reaches DCS.
    local guarded = {}
    for name, fn in pairs(callbacks) do
        guarded[name] = function(...)
            local ok, err = pcall(fn, ...)
            if not ok and lib then lib.logError('hook ' .. name, err) end
        end
    end

    local ok, err = pcall(function()
        open()
        hello()
        DCS.setUserCallbacks(guarded)
    end)
    if not ok and type(log) == 'table' and type(log.write) == 'function' then
        pcall(log.write, 'SLATE', log.ERROR, 'hook load: ' .. tostring(err))
    end
end
