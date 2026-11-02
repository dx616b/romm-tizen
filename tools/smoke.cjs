/*
 * Splash-screen smoke test.
 *
 * Runs the real app/ files in Chromium and checks the three things the launcher
 * can get wrong: whether it finds a reachable server, whether it reports an
 * unreachable one without trapping the user, and whether the reachability probe
 * still works from a file:// origin (which is how a .wgt is loaded).
 *
 *   npm install --no-save playwright && npx playwright install --with-deps chromium
 *   node tools/smoke.cjs
 */
const http = require("http");
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const APP_DIR = path.join(__dirname, "..", "app");
const MIME = {
  ".html": "text/html",
  ".js": "application/javascript",
  ".css": "text/css",
  ".png": "image/png",
};

function serveApp(port, configBody) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const file = req.url.split("?")[0] === "/" ? "/index.html" : req.url.split("?")[0];
      let body;
      try {
        body = fs.readFileSync(path.join(APP_DIR, file));
      } catch {
        res.writeHead(404).end("not found");
        return;
      }
      if (configBody && file === "/config.js") body = configBody;
      res
        .writeHead(200, { "Content-Type": MIME[path.extname(file)] || "text/plain" })
        .end(body);
    });
    server.listen(port, () => resolve(server));
  });
}

function serveFakeRomm(port) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      if (req.url.startsWith("/api/heartbeat")) {
        res.writeHead(200, { "Content-Type": "application/json" }).end("{}");
        return;
      }
      res
        .writeHead(200, { "Content-Type": "text/html" })
        .end("<title>FAKE_ROMM</title><h1>FAKE_ROMM</h1>");
    });
    server.listen(port, () => resolve(server));
  });
}

const results = [];
function check(name, ok, extra) {
  results.push({ name, ok, extra });
}

(async () => {
  const browser = await chromium.launch({ args: ["--no-sandbox"] });
  const app = await serveApp(8000, 'window.ROMM_URL = "http://127.0.0.1:8001";\n');
  const romm = await serveFakeRomm(8001);

  // A reachable server is opened, and nothing throws on the way there.
  {
    const page = await browser.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await page.goto("http://localhost:8000/");
    await page.click("#go");
    await page.waitForURL("http://127.0.0.1:8001/", { timeout: 8000 }).catch(() => {});
    const body = await page.textContent("body").catch(() => "");
    check("reachable server is opened", body.includes("FAKE_ROMM"));
    check("no page errors", errors.length === 0, errors.join("| "));
    await page.close();
  }

  // The splash always opens on the form, pre-filled with the last server used,
  // so a wrong server can be corrected on the TV without clearing storage.
  {
    const context = await browser.newContext();
    await context.addInitScript(() => {
      try {
        localStorage.setItem("romm.url", "http://127.0.0.1:8005");
      } catch {
        /* opaque origin, ignored */
      }
    });
    const page = await context.newPage();
    await page.goto("http://localhost:8000/");
    const value = await page.inputValue("#url");
    check("saved server is pre-filled", value === "http://127.0.0.1:8005", value);
    check("no server is opened without confirmation", page.url() === "http://localhost:8000/", page.url());
    await context.close();
  }

  await app.close();
  await romm.close();

  // An unreachable server reports the problem and offers a way out.
  {
    const dead = await serveApp(8002, 'window.ROMM_URL = "http://127.0.0.1:8009";\n');
    const page = await browser.newPage();
    await page.goto("http://localhost:8002/");
    await page.fill("#url", "http://127.0.0.1:8009");
    await page.click("#go");
    await page
      .waitForFunction(
        () => document.getElementById("status").textContent.startsWith("Can't reach"),
        null,
        { timeout: 12000 },
      )
      .catch(() => {});
    check("unreachable server is reported", (await page.textContent("#status")).startsWith("Can't reach"));
    check(
      "recovery buttons are offered",
      (await page.isVisible("#retry")) &&
        (await page.isVisible("#force")) &&
        (await page.isVisible("#change")),
    );
    await page.click("#change");
    check("the server form reopens", await page.isVisible("#form"));
    await page.close();
    await dead.close();
  }

  // file:// is what a packaged widget actually runs from, and the probe has to
  // survive the opaque origin there.
  {
    const romm2 = await serveFakeRomm(8001);
    const stage = fs.mkdtempSync(path.join(require("os").tmpdir(), "romm-wgt-"));
    for (const name of fs.readdirSync(APP_DIR)) {
      fs.copyFileSync(path.join(APP_DIR, name), path.join(stage, name));
    }
    fs.writeFileSync(
      path.join(stage, "config.js"),
      'window.ROMM_URL = "http://127.0.0.1:8001";\n',
    );
    const page = await browser.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await page.goto("file://" + path.join(stage, "index.html"));
    await page.click("#go");
    await page.waitForURL("http://127.0.0.1:8001/", { timeout: 9000 }).catch(() => {});
    check("probe works from a file:// widget", (await page.textContent("body")).includes("FAKE_ROMM"));
    check("no page errors from a file:// widget", errors.length === 0, errors.join("| "));
    await page.close();
    await romm2.close();
    fs.rmSync(stage, { recursive: true, force: true });
  }

  await browser.close();

  let failed = 0;
  for (const r of results) {
    if (!r.ok) failed++;
    console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.name}${r.extra ? "  [" + r.extra + "]" : ""}`);
  }
  process.exit(failed === 0 ? 0 : 1);
})();
