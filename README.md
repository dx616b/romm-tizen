# RomM for Tizen

A Samsung Tizen TV client for [RomM](https://github.com/rommapp/romm).

This is deliberately a thin launcher. It opens **RomM's own web frontend** in the
TV's Chromium engine, so the library grid, cover art, filters, login and the
browser game player are exactly the ones you get in a desktop browser — including
WebGL rendering on the TV's GPU and gamepad support.

```
app/index.html   splash: pick the server, then hand over to RomM
app/config.js    default server address
app/launch.js    reachability probe and navigation
tizen/           widget manifest
```

## Install

A `.wgt` signed with a self-signed certificate is rejected by the TV with
**"Operation not allowed"**. Samsung TVs only install packages signed with a
distributor certificate that Samsung issues for that specific TV (identified by
its DUID), so signing needs one round trip through a Samsung account.

### One command

Prerequisites: `sdb` (from Tizen Studio or the Samsung TV SDK), Node.js and git.
Turn on developer mode on the TV first: **Apps → press `12345` → Host PC IP** =
the address of the computer running the command, then restart the TV.

```sh
./tools/tv-setup.sh 192.168.1.50
```

It reads the TV's DUID, opens Samsung's sign-in page, creates the author and
distributor certificates, builds `RomM.wgt`, registers the TV and installs the
app. Certificates are cached in `~/.config/romm-tizen/samsung-cert`, so later
runs only rebuild and reinstall.

### Manually

```sh
# 1. DUID
sdb connect 192.168.1.50:26101
sdb -s 192.168.1.50:26101 shell 0 getduid

# 2. certificates (paste the JSON from the sign-in page when asked)
node cli.js create-samsung-cert --name "RomM TV" --email you@example.com \
  --password <pass> --duidList <duid> --privilege Public --output cert/

# 3. build
cd wgt && node cli.js build . -t wgt -o ../RomM.wgt \
  --author ../cert/author.p12 --authorPwd <pass> \
  --distributor ../cert/distributor.p12 --distributorPwd <pass>

# 4. install
sdb -s 192.168.1.50:26101 push cert/device-profile.xml /home/owner/share/tmp/sdk_tools/device-profile.xml
sdb -s 192.168.1.50:26101 install RomM.wgt
```

CI builds `RomM.wgt` on every push. To make those artifacts installable, add the
certificates from step 2 as repository secrets, base64-encoded:

```sh
base64 -w0 cert/author.p12      > author.b64        # -> TIZEN_AUTHOR_P12
base64 -w0 cert/distributor.p12 > distributor.b64   # -> TIZEN_DISTRIBUTOR_P12
```

plus `TIZEN_AUTHOR_PASSWORD` and `TIZEN_DISTRIBUTOR_PASSWORD`. Without them the
workflow still builds, but signs with a throwaway certificate the TV refuses.

### Tizen no cert route

If TizenBrew is already installed on the TV, a module can be added from a GitHub
repository without touching certificates. This client is a plain web app, so it
can be registered as a module pointing at `app/`, though navigating to RomM takes
over the TizenBrew window.

## Configure

Set the server in `app/config.js` before building:

```js
window.ROMM_URL = "http://192.168.1.10";
```

or leave it unset and type the address on the splash screen — the choice is
stored in `localStorage` and used on the next launch. "Change server" on the
splash screen reopens the form.

The TV must be able to reach the RomM host, so use a LAN address rather than
`localhost`.

## Logging in

Login is RomM's own login page. Browsing the library with the remote is fine; for
typing credentials comfortably, sign in on a phone or PC and use RomM's
device-pairing screen, or pair a Bluetooth keyboard/gamepad.

## Controls

| Input | Effect |
| --- | --- |
| D-pad | move focus through RomM's UI |
| OK / Enter | activate |
| Back | previous RomM page |
| Bluetooth/USB gamepad | handled by RomM's player directly |

## Development

```sh
python3 -m http.server 8000 --directory app
```

Open <http://localhost:8000> to exercise the splash screen. Browser CORS rules
differ from the TV, so the reachability probe is best judged on the device.

## License

AGPL-3.0-or-later, matching RomM.
