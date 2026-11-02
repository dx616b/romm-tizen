# RomM for Tizen

A Samsung Tizen TV client for [RomM](https://github.com/rommapp/romm). The TV
pairs with your RomM server the same way a phone or desktop does, then lets you
browse your library with the TV remote.

What it does today:

- **Pairing with a code.** The TV shows a short code and a QR code. Scan it with a
  phone and approve the code in RomM. No typing passwords with the remote.
- **Finding the server.** Recent servers, or a network scan for RomM.
- **Platforms and games.** Browse platforms (with RomM's logos) and their games, with cover art,
  using D-pad and OK. Back goes up a level.
- **Game details.** Cover, description, file name and size.
- **Playing.** The ROM and BIOS are downloaded from RomM with the TV's token and run
  in EmulatorJS, the same engine as RomM's browser player. Press Back on the TV to
  leave a game.

Limits in this version:

- The emulator is loaded from `cdn.emulatorjs.org` (4.2.3), so the TV needs internet
  access while playing.
- Only cores that run without cross-origin isolation are offered (threaded cores such
  as PPSSPP and DOSBox Pure are not).
- BIOS handling covers Neo Geo MVS (`neogeo.zip`) and systems with a single firmware
  file. Other BIOS setups are not handled yet.
- Performance on the TV is not measured yet.

```
app/index.html   the page
app/app.js       server, pairing, library and remote navigation
app/style.css    TV layout
app/config.js    optional default server address (empty by default)
app/qrcode.js    QR encoder (qrcode-generator, MIT)
app/ejs-cores.js platform → EmulatorJS core map, copied from RomM
tizen/           widget manifest
tools/app-test.cjs   end-to-end test against a fake RomM server
```

## Server setting (required)

The TV's app loads from a local origin and calls your RomM server directly, so
RomM must allow that origin. On the RomM server, set:

```
ROMM_CORS_ALLOWED_ORIGINS=*
```

and restart RomM. Without it the TV connects but cannot load the library.

## Install

A `.wgt` must be signed for your TV. In Apps2Samsung, choose the `RomM.wgt` file to
install. It re-signs the package with your Samsung certificate.

The package id is `RommTV0001` (exactly 10 characters, as Tizen requires).

## Use

1. Open **RomM** on the TV.
2. Enter your server address, for example `192.168.1.10`, or pick a recent one, or
   choose **Find on network** to search your subnet for RomM.
3. Scan the QR code on the TV with your phone, or open the link shown, then approve
   the code in RomM.
4. Browse platforms and games.

To unpair the TV, choose **Forget this TV** on the platforms screen.

## Remote

| Key | Action |
| --- | --- |
| Arrow keys | move focus |
| OK / Enter | open or activate |
| Back | go up one level (exits from the first screen) |

## Development

```sh
npm install --no-save playwright@1 && npx playwright install chromium
node tools/app-test.cjs
```

The test serves `app/` and a fake RomM server, then drives the client with arrow
keys and Enter. It covers pairing, approval, platforms, games, covers, detail,
Back, and recovery from an expired token.

## License

AGPL-3.0-or-later, matching RomM.
