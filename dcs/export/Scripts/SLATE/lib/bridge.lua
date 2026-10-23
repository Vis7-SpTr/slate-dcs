-- SPDX-License-Identifier: GPL-3.0-or-later
-- Shared by SLATE-export.lua and SLATE-hook.lua: bridge version, settings,
-- safe calls, the UDP sender and error logging. Loaded with
-- loadfile(<this file>)(<Scripts\SLATE\ folder>).
--
-- Never raises: everything that touches DCS or the network is wrapped in pcall.

local dir = ...
local SEP = package.config:sub(1, 1)

local M = {
    -- Bridge version (bv). Must equal BRIDGE_VERSION in
    -- packages/shared/src/bridge.ts; bump both whenever a datagram changes.
    VERSION = 4,
    -- UDP port of the SLATE host on 127.0.0.1 (protocol.md §0).
    port = 7791,
}

M.json = dofile(dir .. 'lib' .. SEP .. 'json.lua')

-- Optional settings, written by the SLATE app (P1.3):
-- Scripts\SLATE\SLATE-config.lua returning e.g. { port = 7791 }.
do
    local path = dir .. 'SLATE-config.lua'
    local file = io.open(path, 'r')
    if file then
        file:close()
        local ok, config = pcall(dofile, path)
        if ok and type(config) == 'table' and type(config.port) == 'number' then
            M.port = config.port
        end
    end
end

local errorCount = 0

--- Writes an error to dcs.log – at most 20 per session, so a broken getter
--- can't flood the log.
function M.logError(where, err)
    errorCount = errorCount + 1
    if errorCount > 20 then return end
    if type(log) == 'table' and type(log.write) == 'function' then
        pcall(log.write, 'SLATE', log.ERROR, where .. ': ' .. tostring(err))
    end
end

--- Calls fn(...) and returns its first result, or nil if fn is missing or fails.
function M.try(fn, ...)
    if type(fn) ~= 'function' then return nil end
    local ok, value = pcall(fn, ...)
    if ok then return value end
    return nil
end

--- Calls tbl[name](...) the same way – for DCS.x and net.x, which may be missing.
function M.call(tbl, name, ...)
    if type(tbl) ~= 'table' then return nil end
    return M.try(tbl[name], ...)
end

--- A finite number, or nil.
function M.num(v)
    if type(v) == 'number' and v == v and v ~= math.huge and v ~= -math.huge then return v end
    return nil
end

--- A non-empty string, or nil.
function M.str(v)
    if type(v) == 'number' then v = tostring(v) end
    if type(v) == 'string' and v ~= '' then return v end
    return nil
end

--- A boolean, or nil.
function M.bool(v)
    if type(v) == 'boolean' then return v end
    return nil
end

--- The table, or nil if it has no entries (empty objects are never sent).
function M.filled(t)
    if type(t) == 'table' and next(t) ~= nil then return t end
    return nil
end

--- Opens the UDP sender: fire-and-forget datagrams to 127.0.0.1:port, never
--- blocking, never waiting for a reply. Returns nil if LuaSocket is missing.
function M.openSender()
    -- DCS ships LuaSocket in <DCS>\LuaSocket\, the same one SRS and Tacview use.
    if not string.find(package.path, 'LuaSocket', 1, true) then
        package.path = package.path .. ';.\\LuaSocket\\?.lua'
    end
    if not string.find(package.cpath, 'LuaSocket', 1, true) then
        package.cpath = package.cpath .. ';.\\LuaSocket\\?.dll'
    end
    local ok, socket = pcall(require, 'socket')
    if not ok or type(socket) ~= 'table' then
        M.logError('LuaSocket', socket)
        return nil
    end
    local udp = socket.udp()
    udp:settimeout(0)
    udp:setpeername('127.0.0.1', M.port)
    return {
        send = function(datagram)
            local encoded, text = pcall(M.json.encode, datagram)
            if not encoded then
                M.logError('encode', text)
                return
            end
            pcall(udp.send, udp, text)
        end,
        close = function()
            pcall(udp.close, udp)
        end,
        -- Real time in seconds (LuaSocket), for throttling.
        now = socket.gettime,
    }
end

return M
