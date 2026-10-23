slate-relay – the SLATE relay for a group (https://github.com/Vis7-SpTr/slate-dcs)
==================================================================================

Run it on the PC that runs the group's DCS server (or any PC the players can
reach). It needs one open TCP port, 7790 by default – forward it on the router
for players from outside.

  Windows:  slate-relay.exe
  Linux:    ./slate-relay

Options:  --data <folder>   where relay.json, cert.pem and key.pem live
                            (default: %APPDATA%\SLATE\relay, ~/.local/share/slate/relay)
          --port <port>     overrides the port from relay.json
          --verbose         debug log lines

First start: relay.json, the certificate and the session codes are created.
The log shows the codes (blue, red, group) and the fingerprint – players need
the address, a code and the fingerprint to join by hand.

relay.json:
  port                 TCP port (7790)
  codes                session codes – change them to lock out old ones
  publicAddress        DynDNS name (and port) for the DCS chat announcement
  dcsServerFolder      the DCS server's Saved Games folder, e.g.
                       C:\Users\<you>\Saved Games\DCS.server – the relay
                       installs server-hook\SLATE-server-hook.lua there and
                       announces itself in DCS chat; players' SLATE joins by
                       itself. Restart the DCS server once after the first start.
  lanAddress           ip:port to announce if the PC has several networks
  announceMaxLength    split the chat line if DCS cuts long lines
  autoStartWithDcs     true (default): the DCS server starts this relay
                       whenever it loads a mission and the relay isn't
                       running. Needs dcsServerFolder, and plain-ASCII paths
                       for this folder and the data folder (e.g. C:\SLATE\relay).

Stop with Ctrl+C: everyone's session ends cleanly and the announcement is
emptied. With autostart on, the next mission load on the DCS server starts
it again. Without a DCS server on this PC (e.g. a Raspberry Pi): a systemd
unit or a Windows service wrapper that runs the executable with --data.

Licence: GNU GPL v3.0 or later (LICENSE); third-party parts:
THIRD-PARTY-LICENSES.txt.
