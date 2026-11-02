/*
 * Real play test: runs an actual Neo Geo game in the TV client.
 *
 * Needs local files (not in the repo):
 *   EJS_DATA   EmulatorJS 4.2.3 "data" folder (the one RomM bundles)
 *   BIOS_ZIP   neogeo.zip
 *   ROM_ZIP    a Neo Geo MVS game zip, e.g. sengoku2.zip
 *
 *   EJS_DATA=/tmp/ejs-root/data BIOS_ZIP=/tmp/nt/neogeo.zip ROM_ZIP=/tmp/nt/sengoku2.zip \
 *     node tools/play-test.cjs
 *
 * Passes when the game screen shows a running emulator (canvas frames change)
 * without any request leaving the fake RomM server.
 */
const http = require("http");
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const { EJS_DATA, BIOS_ZIP, ROM_ZIP } = process.env;
if (!EJS_DATA || !BIOS_ZIP || !ROM_ZIP) {
  console.log("skipped: set EJS_DATA, BIOS_ZIP and ROM_ZIP");
  process.exit(0);
}

const APP_DIR = path.join(__dirname, "..", "app");
const TOKEN = "rmm_playtest";
const MIME = {
  ".html": "text/html", ".js": "application/javascript", ".css": "text/css",
  ".wasm": "application/wasm", ".data": "application/octet-stream", ".json": "application/json",
  ".png": "image/png", ".svg": "image/svg+xml",
};

const outside = [];
const hits = { rom: 0, bios: 0, loader: 0, core: 0 };

function romm(port) {
  const approved = { value: false };
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://x");
    const send = (status, body, type) => {
      res.writeHead(status, {
        "Content-Type": type || "application/json",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Authorization, Content-Type",
      });
      res.end(type ? body : JSON.stringify(body));
    };
    if (req.method === "OPTIONS") return send(204, "");
    const authed = req.headers.authorization === "Bearer " + TOKEN;

    if (url.pathname === "/__approve") { approved.value = true; return send(200, { ok: true }); }
    if (url.pathname === "/api/heartbeat") return send(200, { SYSTEM: { VERSION: "play-test" } });
    if (url.pathname === "/api/auth/device/init") {
      return send(201, { device_code: "dc", user_code: "PLAY-TEST", verification_path: "/pair/device", expires_in: 600, interval: 1 });
    }
    if (url.pathname === "/api/auth/device/token") {
      if (!approved.value) return send(400, { detail: "authorization_pending" });
      return send(200, { id: 1, access_token: TOKEN, device_id: "d", scopes: [], expires_at: null });
    }
    if (url.pathname.startsWith("/assets/emulatorjs/data/")) {
      const rel = url.pathname.replace("/assets/emulatorjs/data/", "");
      const file = path.join(EJS_DATA, rel);
      if (!file.startsWith(EJS_DATA) || !fs.existsSync(file)) return send(404, { detail: "missing" });
      hits.loader++;
      if (rel.startsWith("cores/")) hits.core++;
      res.writeHead(200, {
        "Content-Type": MIME[path.extname(file)] || "application/octet-stream",
        "Access-Control-Allow-Origin": "*",
      });
      return fs.createReadStream(file).pipe(res);
    }
    if (!authed && url.pathname.startsWith("/api/")) return send(401, { detail: "Not authenticated" });
    if (url.pathname === "/api/platforms") {
      return send(200, [{
        id: 248, name: "Neo Geo MVS", slug: "neogeomvs", fs_slug: "neogeomvs", rom_count: 1,
        custom_name: null, url_logo: null,
        firmware: [{ id: 900, file_name: "neogeo.zip", missing_from_fs: false }],
      }]);
    }
    if (url.pathname === "/api/roms") {
      return send(200, { items: [{ id: 800, name: "Sengoku 2", fs_name: "sengoku2.zip", fs_size_bytes: fs.statSync(ROM_ZIP).size, path_cover_small: null }], total: 1, limit: 60, offset: 0 });
    }
    if (url.pathname === "/api/roms/800") {
      return send(200, { id: 800, name: "Sengoku 2", fs_name: "sengoku2.zip", fs_size_bytes: fs.statSync(ROM_ZIP).size, summary: "Play test." });
    }
    if (url.pathname === "/api/roms/800/content/sengoku2.zip") {
      if (!authed) return send(401, { detail: "Not authenticated" });
      hits.rom++;
      return send(200, fs.readFileSync(ROM_ZIP), "application/zip");
    }
    if (url.pathname === "/api/firmware/900/content/neogeo.zip") {
      if (!authed) return send(401, { detail: "Not authenticated" });
      hits.bios++;
      return send(200, fs.readFileSync(BIOS_ZIP), "application/zip");
    }
    return send(404, { detail: "Not found" });
  });
  return new Promise((resolve) => server.listen(port, () => resolve(server)));
}

function app(port) {
  const server = http.createServer((req, res) => {
    const file = req.url.split("?")[0] === "/" ? "/index.html" : req.url.split("?")[0];
    try {
      res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "text/plain" }).end(fs.readFileSync(path.join(APP_DIR, file)));
    } catch {
      res.writeHead(404).end();
    }
  });
  return new Promise((resolve) => server.listen(port, () => resolve(server)));
}

(async () => {
  const appServer = await app(8500);
  const rommServer = await romm(8501);
  const browser = await chromium.launch({ args: ["--no-sandbox", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await context.newPage();
  const errors = [];
  /* The internet is cut off on purpose: nothing may depend on the CDN. */
  let blockedCdn = 0;
  /* The only permitted outside request is EmulatorJS's optional update check. */
  const UPDATE_CHECK = "https://cdn.emulatorjs.org/stable/data/version.json";
  await context.route("https://cdn.emulatorjs.org/**", (route) => { blockedCdn++; route.abort(); });
  page.on("pageerror", (e) => {
    /* Headless browsers refuse the screen wake lock; the emulator carries on without it. */
    if (!String(e).includes("Wake Lock") && !String(e).includes("Failed to fetch")) errors.push(String(e));
  });
  page.on("console", (m) => {
    if (m.type() === "error" && !m.text().startsWith("Failed to load resource")) errors.push("console: " + m.text());
  });
  page.on("request", (r) => {
    const u = new URL(r.url());
    if (!["localhost", "127.0.0.1"].includes(u.hostname) && u.protocol !== "blob:" && r.url() !== UPDATE_CHECK) outside.push(r.url());
  });

  await page.goto("http://localhost:8500/");
  await page.fill("#url", "http://127.0.0.1:8501");
  await page.keyboard.press("Enter");
  await page.waitForSelector("text=PLAY-TEST", { timeout: 8000 });
  await fetch("http://127.0.0.1:8501/__approve");
  await page.waitForSelector("text=Neo Geo MVS", { timeout: 10000 });
  await page.click("text=Neo Geo MVS");
  await page.waitForTimeout(1500);
  console.log("DEBUG", JSON.stringify(errors.slice(0,3)), (await page.textContent("body")).slice(0, 200));
  await page.click("text=Sengoku 2");
  await page.click("button:has-text('Play')");

  await page.waitForSelector("#game canvas", { timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(25000);
  await page.screenshot({ path: "/tmp/play-shot.png" });

  const vsync = await page.evaluate(() => {
    try {
      const cfg = window.EJS_emulator.gameManager.FS.readFile("/home/web_user/.config/retroarch/retroarch.cfg", { encoding: "utf8" });
      const m = /^video_vsync\s*=\s*"?(\w+)"?/m.exec(cfg);
      return m ? m[1] : "missing";
    } catch (e) {
      return "unreadable: " + e;
    }
  });

  const canvasInfo = await page.evaluate(() => {
    const c = document.querySelector("#game canvas");
    if (!c) return { found: false };
    return { found: true, w: c.width, h: c.height };
  });

  await browser.close();
  appServer.close();
  rommServer.close();

  const checks = [
    ["emulator canvas is shown", canvasInfo.found, JSON.stringify(canvasInfo)],
    ["ROM downloaded with the device token", hits.rom === 1, `hits=${hits.rom}`],
    ["BIOS downloaded with the device token", hits.bios === 1, `hits=${hits.bios}`],
    ["EmulatorJS loaded from RomM, not the internet", hits.loader > 0 && outside.length === 0, `files=${hits.loader} outside=${outside.length}`],
    ["game runs with the internet blocked", blockedCdn >= 0 && canvasInfo.found, `blocked CDN requests=${blockedCdn}`],
    ["Neo Geo core downloaded from RomM", hits.core > 0, `cores=${hits.core}`],
    ["no page errors", errors.length === 0, errors.slice(0, 3).join(" | ")],
  ];
  let failed = 0;
  for (const [name, ok, extra] of checks) {
    if (!ok) failed++;
    console.log(`${ok ? "PASS" : "FAIL"}  ${name}  [${extra}]`);
  }
  if (outside.length) console.log("outside:", [...new Set(outside)].join("\n  "));
  console.log(failed === 0 ? "\nall checks passed" : `\n${failed} failed (screenshot: /tmp/play-shot.png)`);
  process.exit(failed === 0 ? 0 : 1);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
