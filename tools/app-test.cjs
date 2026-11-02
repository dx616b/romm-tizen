/*
 * End-to-end test of the TV client against a fake RomM server.
 *
 * Runs the real app/ files in Chromium and drives them the way a remote does
 * (arrow keys, Enter, Back). The fake server implements just the RomM endpoints
 * the client uses, with the same response shapes and error details.
 *
 *   node tools/app-test.cjs
 */
const http = require("http");
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const APP_DIR = path.join(__dirname, "..", "app");
const MIME = { ".html": "text/html", ".js": "application/javascript", ".css": "text/css", ".png": "image/png" };
const TOKEN = "rmm_testtoken";
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
  "base64"
);

const results = [];
function check(name, ok, extra) {
  results.push({ name, ok, extra });
}

function fakeRomm(port) {
  const state = { approved: false, pendingPolls: 0, polls: 0 };
  const platforms = [
    { id: 1, name: "Neo Geo", slug: "neogeo", fs_slug: "neogeo", rom_count: 2, custom_name: null },
    { id: 2, name: "Empty", slug: "empty", fs_slug: "empty", rom_count: 0, custom_name: null },
  ];
  const roms = [
    {
      id: 10, name: "Metal Slug", fs_name: "metalslug.zip", fs_size_bytes: 1048576,
      path_cover_small: "/assets/romm/resources/cover-s.png", path_cover_large: null,
      summary: "Run and gun classic.",
    },
    {
      id: 11, name: "Mahjong", fs_name: "mahjong.zip", fs_size_bytes: 2048,
      path_cover_small: null, path_cover_large: null, summary: null,
    },
  ];

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://x");
    const send = (status, body, type) => {
      res.writeHead(status, {
        "Content-Type": type || "application/json",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Authorization, Content-Type",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      });
      res.end(type ? body : JSON.stringify(body));
    };
    if (req.method === "OPTIONS") return send(204, "");

    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      const body = raw ? JSON.parse(raw) : {};
      const authed = req.headers.authorization === "Bearer " + TOKEN;

      if (url.pathname === "/__approve") {
        state.approved = true;
        return send(200, { ok: true });
      }
      if (url.pathname === "/api/heartbeat") return send(200, { status: "ok" });
      if (url.pathname === "/api/auth/device/init" && req.method === "POST") {
        state.approved = false;
        state.polls = 0;
        return send(201, {
          device_code: "dc-1",
          user_code: "ABCD-EFGH",
          verification_path: "/pair/device",
          verification_path_complete: "/pair/device?user_code=ABCD-EFGH",
          expires_in: 600,
          interval: 1,
        });
      }
      if (url.pathname === "/api/auth/device/token" && req.method === "POST") {
        state.polls++;
        if (!state.approved) return send(400, { detail: "authorization_pending" });
        return send(200, { id: 1, access_token: TOKEN, device_id: "d1", scopes: [], expires_at: null });
      }
      if (!authed && url.pathname.startsWith("/api/")) {
        return send(401, { detail: "Not authenticated" });
      }
      if (url.pathname === "/api/platforms") return send(200, platforms);
      if (url.pathname === "/api/roms") {
        const pid = Number(url.searchParams.get("platform_ids"));
        const items = roms.filter(() => pid === 1);
        return send(200, { items, total: items.length, limit: 60, offset: 0 });
      }
      if (url.pathname.startsWith("/api/roms/")) {
        const rom = roms.find((r) => String(r.id) === url.pathname.split("/")[3]);
        return rom ? send(200, rom) : send(404, { detail: "Not found" });
      }
      if (url.pathname.startsWith("/assets/")) return send(200, PNG, "image/png");
      return send(404, { detail: "Not found" });
    });
  });
  return new Promise((resolve) => server.listen(port, () => resolve({ server, state })));
}

function staticApp(port) {
  const server = http.createServer((req, res) => {
    const file = req.url.split("?")[0] === "/" ? "/index.html" : req.url.split("?")[0];
    try {
      const body = fs.readFileSync(path.join(APP_DIR, file));
      res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "text/plain" }).end(body);
    } catch {
      res.writeHead(404).end();
    }
  });
  return new Promise((resolve) => server.listen(port, () => resolve(server)));
}

async function focusedText(page) {
  return page.evaluate(() => (document.activeElement && document.activeElement.textContent) || "");
}

(async () => {
  const app = await staticApp(8000);
  const { server: romm, state } = await fakeRomm(8001);
  const browser = await chromium.launch({ args: ["--no-sandbox"] });

  // Full path: connect, pair, browse, open a game, navigate back.
  {
    const context = await browser.newContext();
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));

    await page.goto("http://localhost:8000/");
    await page.fill("#url", "http://127.0.0.1:8001");
    await page.keyboard.press("Enter");

    await page.waitForSelector("text=ABCD-EFGH", { timeout: 8000 }).catch(() => {});
    check("pairing code is shown", (await page.textContent("body")).includes("ABCD-EFGH"));

    await fetch("http://127.0.0.1:8001/__approve");
    await page.waitForSelector("text=Neo Geo", { timeout: 10000 }).catch(() => {});
    check("approval opens the platform list", (await page.textContent("body")).includes("Neo Geo"));
    check("platforms without games are hidden", !(await page.textContent("body")).includes("Empty"));
    check("token is stored after approval", (await page.evaluate(() => localStorage.getItem("romm.token"))) === "rmm_testtoken");

    await page.click("text=Neo Geo");
    await page.waitForSelector("text=Metal Slug", { timeout: 8000 }).catch(() => {});
    check("games load for the platform", (await page.textContent("body")).includes("Metal Slug"));
    check("cover image loads from RomM", (await page.locator("img.cover").count()) === 1);

    const first = await focusedText(page);
    await page.keyboard.press("ArrowRight");
    const second = await focusedText(page);
    check("arrow keys move focus", first !== second, `${first} -> ${second}`);

    await page.click("text=Metal Slug");
    await page.waitForSelector("text=Run and gun classic.", { timeout: 8000 }).catch(() => {});
    check("game detail shows the description", (await page.textContent("body")).includes("Run and gun classic."));

    await page.keyboard.press("Escape");
    await page.waitForSelector("text=Load more", { state: "detached", timeout: 3000 }).catch(() => {});
    check("Back returns to the game list", (await page.textContent("body")).includes("Mahjong"));

    check("no page errors", errors.length === 0, errors.join(" | "));
    await context.close();
  }

  // An expired token sends the TV back to pairing with a message, not a dead screen.
  {
    const context = await browser.newContext();
    await context.addInitScript(() => {
      try {
        localStorage.setItem("romm.server", "http://127.0.0.1:8001");
        localStorage.setItem("romm.token", "rmm_expired");
      } catch {
        /* opaque origin */
      }
    });
    const page = await context.newPage();
    await page.goto("http://localhost:8000/");
    await page.keyboard.press("Enter");
    await page.waitForSelector("text=ABCD-EFGH", { timeout: 8000 }).catch(() => {});
    const body = await page.textContent("body");
    check("expired token returns to pairing", body.includes("ABCD-EFGH"));
    check("expired token is explained", body.includes("Pair this TV again"));
    check("expired token is cleared", !(await page.evaluate(() => localStorage.getItem("romm.token"))));
    await context.close();
  }

  // The server address is never built in; an empty default shows the form.
  {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto("http://localhost:8000/");
    check("no server is built in", (await page.inputValue("#url")) === "");
    await context.close();
  }

  await browser.close();
  app.close();
  romm.close();

  let failed = 0;
  for (const r of results) {
    if (!r.ok) failed++;
    console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.name}${r.extra ? "  [" + r.extra + "]" : ""}`);
  }
  console.log(failed === 0 ? "\nall checks passed" : `\n${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
