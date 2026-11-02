#!/usr/bin/env bash
#
# Build and install RomM for Tizen on a Samsung TV.
#
# A self-signed .wgt is rejected by the TV ("Operation not allowed"). Samsung
# TVs only install packages signed with a distributor certificate issued by
# Samsung for that specific TV (its DUID), so this script:
#
#   1. connects to the TV and reads its DUID,
#   2. creates an author + distributor certificate with Samsung,
#   3. builds RomM.wgt signed with them,
#   4. pushes the device profile and installs the app.
#
# Prerequisites: sdb (from Tizen Studio / the Samsung TV SDK), node, git, curl.
# The TV must be in developer mode: Apps -> press 12345 -> Host PC IP = this PC.
#
#   ./tools/tv-setup.sh 192.168.1.50
#
set -euo pipefail

TV_IP="${1:-}"
TV_PORT="${2:-26101}"
CERT_DIR="${CERT_DIR:-$HOME/.config/romm-tizen/samsung-cert}"
CERT_PASSWORD="${CERT_PASSWORD:-romm-tizen}"
CERT_NAME="${CERT_NAME:-RomM TV}"
CERT_EMAIL="${CERT_EMAIL:-}"
CERT_PRIVILEGE="${CERT_PRIVILEGE:-Public}"
TIZENJS_DIR="${TIZENJS_DIR:-$HOME/.cache/romm-tizen/tizen.js}"
REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_ID="RommTzn0.RomM"

say() { printf '\n\033[1m%s\033[0m\n' "$*"; }
die() { printf '\n\033[31m%s\033[0m\n' "$*" >&2; exit 1; }

[ -n "$TV_IP" ] || die "Usage: $0 <tv-ip> [sdb-port]

Find the TV's address under Settings > General > Network > Network Status."

# ---------------------------------------------------------------- tooling ---
command -v node >/dev/null || die "node is required (https://nodejs.org)."
command -v git  >/dev/null || die "git is required."
command -v sdb  >/dev/null || die "sdb is not on PATH.

Install Tizen Studio (or the Samsung TV SDK) and add its tools directory, e.g.
  ~/tizen-studio/tools/sdb
On Linux you can also grab just sdb from the Tizen Studio CLI package."

SDB="sdb -s ${TV_IP}:${TV_PORT}"

# ------------------------------------------------------------------- TV -----
say "Connecting to $TV_IP:$TV_PORT"
sdb connect "${TV_IP}:${TV_PORT}" >/dev/null 2>&1 || true
$SDB shell 0 true >/dev/null 2>&1 || die "Can't talk to the TV at ${TV_IP}:${TV_PORT}.

Check that:
  * the TV and this computer are on the same network,
  * developer mode is on: Apps -> press 12345 -> Host PC IP = this computer's IP,
  * the TV was restarted after enabling developer mode."

DUID="$($SDB shell 0 getduid 2>/dev/null | tr -d '\r' | tail -n 1 || true)"
[ -n "$DUID" ] || die "The TV did not report a DUID.

sdb connected, but 'getduid' returned nothing. If this TV firmware doesn't
support that command, open Tizen Studio > Device Manager, right-click the TV,
copy its DUID, and re-run with:
  DUID=<the value> $0 $TV_IP"

say "TV DUID: $DUID"

# ------------------------------------------------------------- tizen.js -----
if [ ! -f "$TIZENJS_DIR/cli.js" ]; then
   say "Fetching tizen.js (packages and signs without Tizen Studio)"
   mkdir -p "$(dirname "$TIZENJS_DIR")"
   git clone --depth 1 https://github.com/reisxd/tizen.js "$TIZENJS_DIR"
   ( cd "$TIZENJS_DIR" && npm install --omit=dev --silent )
fi
TIZENJS="node $TIZENJS_DIR/cli.js"

# ------------------------------------------------------------ certificate ---
if [ ! -f "$CERT_DIR/author.p12" ] || [ ! -f "$CERT_DIR/distributor.p12" ]; then
   say "Creating a Samsung certificate for this TV"
   echo "Your browser will open Samsung's sign-in page. After signing in it shows"
   echo "a page with a JSON response - copy all of it and paste it here."
   [ -n "$CERT_EMAIL" ] || read -r -p "Samsung account e-mail: " CERT_EMAIL

   xdg-open "https://account.samsung.com/accounts/TDC/signInGate?clientId=v285zxnl3h&tokenType=TOKEN" \
      >/dev/null 2>&1 || true

   $TIZENJS create-samsung-cert \
      --name "$CERT_NAME" \
      --email "$CERT_EMAIL" \
      --password "$CERT_PASSWORD" \
      --duidList "$DUID" \
      --privilege "$CERT_PRIVILEGE" \
      --output "$CERT_DIR"
else
   say "Reusing certificate in $CERT_DIR"
fi

# ------------------------------------------------------------------ build ---
say "Building RomM.wgt"
VERSION="$(node -p "require('$REPO_DIR/package.json').version")"
BUILD_DIR="$(mktemp -d)"
trap 'rm -rf "$BUILD_DIR"' EXIT

cp -r "$REPO_DIR/app/." "$BUILD_DIR/"
sed "s/@VERSION@/${VERSION}/" "$REPO_DIR/tizen/config.xml" > "$BUILD_DIR/config.xml"

( cd "$BUILD_DIR" && $TIZENJS build . -t wgt -o "$REPO_DIR/RomM.wgt" \
      --author "$CERT_DIR/author.p12" --authorPwd "$CERT_PASSWORD" \
      --distributor "$CERT_DIR/distributor.p12" --distributorPwd "$CERT_PASSWORD" )

# ---------------------------------------------------------------- install ---
if [ -f "$CERT_DIR/device-profile.xml" ]; then
   say "Registering this TV with the certificate"
   $SDB push "$CERT_DIR/device-profile.xml" /home/owner/share/tmp/sdk_tools/device-profile.xml \
      >/dev/null 2>&1 || true
fi

say "Installing"
if ! $SDB install "$REPO_DIR/RomM.wgt"; then
   die "Install failed. Uninstall any older RomM app first:
  sdb -s ${TV_IP}:${TV_PORT} uninstall $APP_ID
then run this script again."
fi

say "Done. Open 'RomM' from the TV's app list."
echo "If the splash says it can't reach the server, press 'Change server' and"
echo "enter an address the TV can reach, for example http://192.168.1.10"
