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

Grab `RomM.wgt` from the latest build artifact or release, then either

* copy it to a USB stick and use the TV's app-install dialog, or
* push it with `sdb connect <tv-ip>` and `sdb install RomM.wgt`.

The widget is signed with a throwaway certificate unless `TIZEN_AUTHOR_P12` and
`TIZEN_AUTHOR_PASSWORD` secrets are set, so a TV in developer mode is required.

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
