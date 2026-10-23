-- SPDX-License-Identifier: GPL-3.0-or-later
--[[
  SLATE Lua bridge – export side (bridge version 4).

  Loaded from Saved Games\DCS\Scripts\Export.lua by the SLATE block. Sends the
  own aircraft's raw data to the SLATE host as JSON datagrams over UDP to
  127.0.0.1:7791 (protocol.md §6.1): an `own` datagram 4 times a second and a
  `hello` every 30 s. The host does every conversion.

  Rules (architecture.md §1.1):
    * READ-ONLY: only LoGet* getters and the coordinate conversion
      LoLoCoordinatesToGeoCoordinates. Nothing is ever sent to DCS.
    * Keeps the other tools' export callbacks (the daisy chain Tacview uses).
    * Everything SLATE does is wrapped in pcall – an error here can't break
      DCS or another export script.
    * Fire-and-forget UDP, never waits; no file writes; no
      LuaExportActivityNextEvent. The send rate is throttled by real time
      inside LuaExportAfterNextFrame, so data keeps coming while a single-player
      mission is paused (the host sees model time standing still).
]]

-- Loaded twice (e.g. two SLATE blocks in Export.lua)? Then chain only once.
if SLATE_EXPORT_LOADED then return end
SLATE_EXPORT_LOADED = true

do
    local lfs = require('lfs')
    local SEP = package.config:sub(1, 1)
    local DIR = lfs.writedir() .. 'Scripts' .. SEP .. 'SLATE' .. SEP

    local SEND_INTERVAL = 0.25 -- s real time: 4 Hz
    local HELLO_INTERVAL = 30 -- s real time

    local lib, sender
    local nextSend, nextHello = 0, 0
    local names = {} -- LoGetNameByType results, by type code

    local function versionText()
        local info = lib.try(LoGetVersionInfo)
        local v = type(info) == 'table' and info.ProductVersion
        if type(v) ~= 'table' then return nil end
        local parts = {}
        for i = 1, 4 do
            if type(v[i]) ~= 'number' then return nil end
            parts[i] = string.format('%d', v[i])
        end
        return table.concat(parts, '.')
    end

    local function weaponName(w)
        local key = table.concat({ w.level1, w.level2, w.level3, w.level4 }, ',')
        local name = names[key]
        if name == nil then
            name = lib.str(lib.try(LoGetNameByType, w.level1, w.level2, w.level3, w.level4)) or false
            names[key] = name
        end
        return name or nil
    end

    -- Stations that carry something (type code not 0,0,0,0), and gun rounds.
    local function payload()
        local info = lib.try(LoGetPayloadInfo)
        if type(info) ~= 'table' or type(info.Stations) ~= 'table' then return nil, nil end
        local stations = {}
        for i, st in pairs(info.Stations) do
            local w = type(st) == 'table' and st.weapon
            if type(i) == 'number' and type(w) == 'table'
                and type(w.level1) == 'number' and type(w.level2) == 'number'
                and type(w.level3) == 'number' and type(w.level4) == 'number'
                and w.level1 ~= 0 then
                stations[#stations + 1] = {
                    st = i,
                    w = { w.level1, w.level2, w.level3, w.level4 },
                    name = weaponName(w),
                    count = lib.num(st.count) or 0,
                    clsid = lib.str(st.CLSID),
                }
            end
        end
        local gun = type(info.Cannon) == 'table' and lib.num(info.Cannon.shells) or nil
        return stations, gun
    end

    local function own()
        local d = {
            t = 'own',
            bv = lib.VERSION,
            mt = lib.num(lib.try(LoGetModelTime)) or 0,
            start = lib.num(lib.try(LoGetMissionStartTime)),
        }

        local me = lib.try(LoGetSelfData)
        if type(me) == 'table' then
            d.type = lib.str(me.Name)
            d.unit = lib.str(me.UnitName)
            local lla = me.LatLongAlt
            if type(lla) == 'table' then
                d.lat, d.lon, d.altMsl = lib.num(lla.Lat), lib.num(lla.Long), lib.num(lla.Alt)
            end
            -- Heading from the map grid's north, rad, not normalised: what DCS's
            -- avionics call "true" (cockpit TRUE mode, F10 ruler).
            d.gridHdg = lib.num(me.Heading)
            -- The point 1 km grid-north of the aircraft, by DCS's own projection:
            -- the angle between grid and geographic north, for bearings worked out
            -- from lat/lon (moving map). (Position is x north, z east; don't use
            -- PositionAsMatrix – its z is broken, spike 3.2.)
            local p = me.Position
            if type(p) == 'table' and lib.num(p.x) and lib.num(p.z) then
                local north = lib.try(LoLoCoordinatesToGeoCoordinates, p.x + 1000, p.z)
                if type(north) == 'table' and lib.num(north.latitude) and lib.num(north.longitude) then
                    d.north = { north.latitude, north.longitude }
                end
            end
        end

        -- Magnetic heading as the cockpit shows it, rad (missing in ground vehicles).
        d.magHdg = lib.num(lib.try(LoGetMagneticYaw))
        d.altAgl = lib.num(lib.try(LoGetAltitudeAboveGroundLevel))
        d.ias = lib.num(lib.try(LoGetIndicatedAirSpeed))
        d.tas = lib.num(lib.try(LoGetTrueAirSpeed))
        d.mach = lib.num(lib.try(LoGetMachNumber))
        d.vs = lib.num(lib.try(LoGetVerticalVelocity))
        local vel = lib.try(LoGetVectorVelocity)
        if type(vel) == 'table' and lib.num(vel.x) and lib.num(vel.y) and lib.num(vel.z) then
            d.vel = { vel.x, vel.y, vel.z }
        end

        local engine = lib.try(LoGetEngineInfo)
        if type(engine) == 'table' then
            d.fuelInt = lib.num(engine.fuel_internal)
            d.fuelExt = lib.num(engine.fuel_external)
        end

        d.payload, d.gun = payload()

        local snares = lib.try(LoGetSnares)
        if type(snares) == 'table' and lib.num(snares.chaff) and lib.num(snares.flare) then
            d.cm = { chaff = snares.chaff, flare = snares.flare }
        end
        return d
    end

    local function start()
        lib = assert(loadfile(DIR .. 'lib' .. SEP .. 'bridge.lua'))(DIR)
        sender = lib.openSender()
        nextSend, nextHello = 0, 0
        names = {}
    end

    local function frame()
        if not sender then return end
        local now = sender.now()
        if now < nextSend then return end
        nextSend = now + SEND_INTERVAL
        if now >= nextHello then
            nextHello = now + HELLO_INTERVAL
            sender.send({ t = 'hello', bv = lib.VERSION, env = 'export', dcs = versionText() })
        end
        sender.send(own())
    end

    local function stop()
        if sender then sender.close() end
        sender = nil
    end

    local function guarded(where, fn)
        local ok, err = pcall(fn)
        if not ok then
            if lib then
                lib.logError('export ' .. where, err)
            elseif type(log) == 'table' and type(log.write) == 'function' then
                pcall(log.write, 'SLATE', log.ERROR, 'export ' .. where .. ': ' .. tostring(err))
            end
        end
    end

    -- Daisy chain: SLATE first, then whatever was there before.
    local previousStart = LuaExportStart
    local previousAfterNextFrame = LuaExportAfterNextFrame
    local previousStop = LuaExportStop

    LuaExportStart = function()
        guarded('start', start)
        if previousStart then previousStart() end
    end

    LuaExportAfterNextFrame = function()
        guarded('frame', frame)
        if previousAfterNextFrame then previousAfterNextFrame() end
    end

    LuaExportStop = function()
        guarded('stop', stop)
        if previousStop then previousStop() end
    end
end
