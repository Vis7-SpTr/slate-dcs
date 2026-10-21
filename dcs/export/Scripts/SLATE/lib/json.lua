-- SPDX-License-Identifier: GPL-3.0-or-later
-- Minimal JSON encoder for the SLATE Lua bridge (Lua 5.1, no dependencies).
-- Tables with keys 1..n become arrays, other tables objects; an empty table
-- becomes [] (the bridge never sends empty objects). nil values simply don't
-- exist in Lua tables, so absent fields are left out – the host reads them as
-- null. NaN and infinity become null.

local M = {}

local escapes = { ['"'] = '\\"', ['\\'] = '\\\\', ['\n'] = '\\n', ['\r'] = '\\r', ['\t'] = '\\t' }

local function encodeString(s)
    return '"' .. s:gsub('[%c"\\]', function(c)
        return escapes[c] or string.format('\\u%04x', c:byte())
    end) .. '"'
end

local function encodeNumber(n)
    if n ~= n or n == math.huge or n == -math.huge then return 'null' end
    -- %d only where it is safe: Lua 5.1 on Windows formats through a 32-bit long.
    if n == math.floor(n) and math.abs(n) < 2147483648 then return string.format('%d', n) end
    return string.format('%.12g', n)
end

local encode

local function encodeTable(t, depth, seen)
    if depth > 10 or seen[t] then error('table too deep or cyclic') end
    seen[t] = true
    local count = 0
    for _ in pairs(t) do count = count + 1 end
    local out = {}
    if count == 0 then
        seen[t] = nil
        return '[]'
    end
    if #t == count then
        for i = 1, count do out[i] = encode(t[i], depth + 1, seen) end
        seen[t] = nil
        return '[' .. table.concat(out, ',') .. ']'
    end
    local keys = {}
    for k in pairs(t) do keys[#keys + 1] = tostring(k) end
    table.sort(keys)
    for i, k in ipairs(keys) do
        local v = t[k]
        if v == nil then v = t[tonumber(k)] end
        out[i] = encodeString(k) .. ':' .. encode(v, depth + 1, seen)
    end
    seen[t] = nil
    return '{' .. table.concat(out, ',') .. '}'
end

encode = function(v, depth, seen)
    local kind = type(v)
    if kind == 'nil' then return 'null' end
    if kind == 'boolean' then return v and 'true' or 'false' end
    if kind == 'number' then return encodeNumber(v) end
    if kind == 'string' then return encodeString(v) end
    if kind == 'table' then return encodeTable(v, depth, seen) end
    error('cannot encode a ' .. kind)
end

--- Encodes a Lua value as JSON. Raises an error for functions, cycles and
--- tables nested deeper than 10 – callers wrap it in pcall.
function M.encode(value)
    return encode(value, 0, {})
end

return M
