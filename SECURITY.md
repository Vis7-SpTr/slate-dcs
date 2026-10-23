# Security

SLATE runs on your PC, opens network ports (the app on `127.0.0.1`, optionally on your LAN; the relay on one public port) and writes into your DCS Saved Games folder. If you find a way to get around that – for example to reach a SLATE host from another device without pairing, to take over someone else's session on a relay, or to make SLATE write outside `Saved Games\<DCS folder>\Scripts\` – please report it privately.

## How to report

Use GitHub's private reporting: **Security → Report a vulnerability** in this repository. Please include the SLATE version, what you did and what happened. Don't open a public issue for security problems.

You'll get an answer within a week. SLATE is a hobby project, so fixes may take a little longer; you'll be credited in the release notes unless you'd rather not be.

## Supported versions

Only the latest release gets fixes. SLATE updates itself (More → Settings → SLATE), so please check with the latest version first.

## Scope

In scope: the SLATE app (`apps/host`, `apps/web`), the relay, the Lua files in `dcs/`, the installer and the release builds.

Out of scope: DCS World itself, OpenKneeboard, and problems that need someone who already controls your PC or your Windows account.
