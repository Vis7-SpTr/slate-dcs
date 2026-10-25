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
          --print-remote    print the "remoteRelay" block for a DCS server
                            PC that announces this relay (see below), then exit

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
  remoteRelay          null (default), or a relay hosted somewhere else – see
                       "Relay on another machine" below.

Relay on another machine (Raspberry Pi, VPS)
--------------------------------------------
For when no port can be opened on the DCS server's network. The relay runs
on the other machine; the DCS server PC still announces it in DCS chat, so
players' SLATE joins by itself – but nothing listens on the server PC.

  1. On the other machine: set publicAddress in relay.json (DynDNS name or
     fixed IP), forward TCP 7790 to it, start slate-relay. Then run
       slate-relay --print-remote   (same --data / --port as the relay)
     It prints a "remoteRelay" block: address, blue and red code,
     fingerprint. Keep it private, like the codes.
  2. On the DCS server PC: start slate-relay once to create relay.json, stop
     it, set dcsServerFolder and replace "remoteRelay": null with the block.
  3. Run slate-relay on the server PC again, from a terminal (PowerShell) so
     the output stays visible. It checks the remote relay once
     (fingerprint and version), installs the server hook, writes the
     announcement and exits. Restart the DCS server once so it loads the hook.
     A relay that shows another fingerprint is not announced; one that is
     off right now is announced anyway (with a warning).
  4. Run it again whenever the remote relay's address, codes or certificate
     change. No autostart, no firewall rule, no open port on the server PC.

Stop with Ctrl+C: everyone's session ends cleanly and the announcement is
emptied. With autostart on, the next mission load on the DCS server starts
it again. Without a DCS server on this PC (e.g. a Raspberry Pi): a systemd
unit or a Windows service wrapper that runs the executable with --data.
Example systemd unit (/etc/systemd/system/slate-relay.service; the relay in
/opt/slate-relay, data in /var/lib/slate-relay, a user "slate"):

  [Unit]
  Description=SLATE relay
  After=network-online.target
  Wants=network-online.target

  [Service]
  User=slate
  ExecStart=/opt/slate-relay/slate-relay --data /var/lib/slate-relay
  Restart=on-failure
  RestartSec=5

  [Install]
  WantedBy=multi-user.target

  sudo systemctl enable --now slate-relay   ·   journalctl -u slate-relay
On a Raspberry Pi use the linux-arm64 archive and a 64-bit OS (Pi Zero 2 W,
Pi 3/4/5 – not the original Pi Zero / Zero W).

Licence: GNU GPL v3.0 or later (LICENSE); third-party parts:
THIRD-PARTY-LICENSES.txt.
