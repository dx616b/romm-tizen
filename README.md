# RomM for Tizen

A Samsung Tizen TV client for [RomM](https://github.com/rommapp/romm). The TV
pairs with your RomM server the same way a phone or desktop does, then lets you
browse your library with the TV remote.

What it does today:

- **Pairing with a code.** The TV shows a short code. You approve it in RomM on a
  phone or computer. No typing passwords with the remote.
- **Platforms and games.** Browse platforms and their games, with cover art,
  using D-pad and OK. Back goes up a level.
- **Game details.** Cover, description, file name and size.

Not yet: playing games on the TV. The Play button is in place and says so.

```
app/index.html   the page
app/app.js       server, pairing, library and remote navigation
app/style.css    TV layout
app/config.js    optional default server address (empty by default)
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
2. Enter your server address, for example `http://192.168.1.10`, and press OK.
3. Note the code shown on the TV. In RomM on a phone or computer, open the link
   on the screen and approve the code.
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
