/*
 * RomM for Tizen - TV client.
 *
 * Browses a RomM library with the TV remote. The TV is paired with the server
 * the way RomM pairs devices: the TV shows a short code, the user approves it in
 * RomM on a phone or computer, and the TV keeps the resulting access token.
 *
 * Written for Chromium 69+ (Tizen 5.5 and later): no optional chaining, no
 * class fields, no top-level await.
 */
(function () {
   "use strict";

   var VERSION = "0.2.0";
   var SCOPES = ["me.read", "platforms.read", "roms.read", "assets.read", "firmware.read"];
   var PAGE = 60;
   var KEY = { LEFT: 37, UP: 38, RIGHT: 39, DOWN: 40, ENTER: 13, ESC: 27, BACK: 10009 };
   var DIRECTION = { 37: "L", 38: "U", 39: "R", 40: "D" };
   /* EmulatorJS files served by RomM itself, so the TV needs no internet access. */
   var EMULATORJS_PATH = "/assets/emulatorjs/data";
   /* Cores that need cross-origin isolation (SharedArrayBuffer) cannot run in the TV's app page. */
   var THREADED_CORES = ["dosbox_pure", "ppsspp", "azahar"];

   var root = document.getElementById("app");
   var state = {
      server: "",
      token: "",
      stack: [],
      pollId: 0,
      playing: false,
      current: null
   };

   function load(key) {
      try {
         return localStorage.getItem(key) || "";
      } catch (e) {
         return "";
      }
   }

   function save(key, value) {
      try {
         if (value) localStorage.setItem(key, value);
         else localStorage.removeItem(key);
      } catch (e) {
         /* storage unavailable: the session lasts until the app closes */
      }
   }

   function deviceId() {
      var id = load("romm.deviceId");
      if (!id) {
         id = "tv-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10);
         save("romm.deviceId", id);
      }
      return id;
   }

   function normalize(raw) {
      var url = (raw || "").trim();
      if (!url) return "";
      if (!/^https?:\/\//i.test(url)) url = "http://" + url;
      return url.replace(/\/+$/, "");
   }

   function el(tag, attrs, children) {
      var node = document.createElement(tag);
      attrs = attrs || {};
      Object.keys(attrs).forEach(function (key) {
         if (key === "text") node.textContent = attrs[key];
         else if (key === "on") {
            Object.keys(attrs.on).forEach(function (ev) {
               node.addEventListener(ev, attrs.on[ev]);
            });
         } else if (key === "className") node.className = attrs[key];
         else if (attrs[key] !== null && attrs[key] !== undefined) node.setAttribute(key, attrs[key]);
      });
      (children || []).forEach(function (child) {
         if (child) node.appendChild(typeof child === "string" ? document.createTextNode(child) : child);
      });
      return node;
   }

   function button(attrs, children) {
      attrs = attrs || {};
      attrs.className = ((attrs.className || "") + " f").trim();
      return el("button", attrs, children);
   }

   function fmtSize(bytes) {
      if (!bytes) return "";
      if (bytes > 1024 * 1024 * 1024) return (bytes / 1024 / 1024 / 1024).toFixed(1) + " GB";
      if (bytes > 1024 * 1024) return (bytes / 1024 / 1024).toFixed(1) + " MB";
      return Math.max(1, Math.round(bytes / 1024)) + " KB";
   }

   /* ---------------------------------------------------------------- API -- */

   function api(path, opts) {
      opts = opts || {};
      var headers = { Accept: "application/json" };
      if (opts.body) headers["Content-Type"] = "application/json";
      if (state.token && !opts.anon) headers.Authorization = "Bearer " + state.token;

      return fetch(state.server + path, {
         method: opts.method || "GET",
         headers: headers,
         body: opts.body ? JSON.stringify(opts.body) : undefined,
         cache: "no-store"
      }).then(function (r) {
         return r.text().then(function (text) {
            var data = null;
            try {
               data = text ? JSON.parse(text) : null;
            } catch (e) {
               data = null;
            }
            if (r.status === 401 && !opts.anon) {
               state.token = "";
               save("romm.token", "");
               show([viewServer, viewPair], "Pair this TV again: RomM no longer approves it.");
               var expired = new Error("unauthorized");
               expired.unauthorized = true;
               throw expired;
            }
            if (!r.ok) {
               var err = new Error(data && data.detail ? String(data.detail) : "HTTP " + r.status);
               err.status = r.status;
               err.detail = data && data.detail ? String(data.detail) : "";
               throw err;
            }
            return data;
         });
      });
   }

   function apiBlob(path) {
      return fetch(state.server + path, {
         headers: { Authorization: "Bearer " + state.token },
         cache: "no-store"
      }).then(function (r) {
         if (r.status === 401) {
            state.token = "";
            save("romm.token", "");
            show([viewServer, viewPair], "Pair this TV again: RomM no longer approves it.");
            var expired = new Error("unauthorized");
            expired.unauthorized = true;
            throw expired;
         }
         if (!r.ok) {
            var err = new Error("HTTP " + r.status);
            err.status = r.status;
            throw err;
         }
         return r.blob();
      });
   }

   /* ------------------------------------------------------------ screens -- */

   function screen(title, nodes, sub) {
      state.pollId++;
      root.innerHTML = "";
      var header = title ? el("header", { className: "top" }, [
         el("h1", { text: title }),
         sub ? el("p", { className: "sub", text: sub }) : null
      ]) : null;
      var body = el("main", { className: "screen" }, [header].concat(nodes));
      root.appendChild(body);
      var first = body.querySelector(".f");
      if (first) first.focus();
      return body;
   }

      function errorNodes(err, retry) {
      return [
         el("p", { className: "status", text: "Something went wrong: " + (err && err.message ? err.message : "unknown error") }),
         button({ text: "Try again", on: { click: retry } })
      ];
   }

   function show(stack, sub) {
      state.stack = stack;
      var top = stack[stack.length - 1];
      top(sub);
   }

   function push(view) {
      state.stack.push(view);
      view();
   }

   function back() {
      if (state.stack.length > 1) {
         state.stack.pop();
         state.stack[state.stack.length - 1]();
         return;
      }
      try {
         if (window.tizen && tizen.application) tizen.application.getCurrentApplication().exit();
      } catch (e) {
         /* not running on a TV */
      }
   }

   function recentServers() {
      try {
         return JSON.parse(load("romm.recent") || "[]");
      } catch (e) {
         return [];
      }
   }

   function rememberServer(url) {
      var list = recentServers().filter(function (u) { return u !== url; });
      list.unshift(url);
      save("romm.recent", JSON.stringify(list.slice(0, 5)));
   }

   function viewServer(message) {
      var input = el("input", {
         className: "f",
         type: "url",
         id: "url",
         value: state.server,
         placeholder: "192.168.1.10",
         autocapitalize: "off",
         spellcheck: "false",
         autocomplete: "off"
      });
      var status = el("p", { className: "status", text: message || "" });
      var found = el("div", { className: "chips" });
      var connect = function () {
         connectTo(input.value, status);
      };
      input.addEventListener("keydown", function (e) {
         if (e.keyCode === KEY.ENTER) {
            e.preventDefault();
            connect();
         }
      });

      var scanButton = button({ text: "Find on network" });
      scanButton.addEventListener("click", function () {
         scanButton.disabled = true;
         scanNetwork(found, status, function () { scanButton.disabled = false; });
      });

      var recents = recentServers();
      screen(null, [
         el("div", { className: "login" }, [
            el("div", { className: "brand" }, [
               el("div", { className: "logo", text: "R" }),
               el("h1", { text: "RomM" }),
               el("p", { className: "tagline", text: "Your game library, on the big screen." })
            ]),
            el("div", { className: "card" }, [
               el("label", { className: "label", text: "Server address", "for": "url" }),
               el("p", { className: "hint", text: "Type it with the remote, pick a recent one, or search your network." }),
               input,
               el("div", { className: "row" }, [
                  button({ text: "Connect", on: { click: connect } }),
                  scanButton
               ]),
               status,
               recents.length ? el("p", { className: "label", text: "Recent" }) : null,
               recents.length ? el("div", { className: "chips" }, recents.map(function (url) {
                  return button({ className: "chip", text: url.replace(/^https?:\/\//, ""), on: {
                     click: function () { connectTo(url, status); }
                  } });
               })) : null,
               found
            ])
         ])
      ]);
   }

   function isPrivateIp(ip) {
      return /^192\.168\./.test(ip) || /^10\./.test(ip) || /^172\.(1[6-9]|2\d|3[01])\./.test(ip);
   }

   /* Browsers hide the local address, but the WebRTC candidates still reveal the
      subnet the TV is on; that is enough to know where to look for RomM. */
   function localNetworks() {
      return new Promise(function (resolve) {
         var prefixes = [];
         var pc;
         try {
            pc = new RTCPeerConnection({ iceServers: [] });
         } catch (e) {
            resolve(prefixes);
            return;
         }
         pc.createDataChannel("scan");
         pc.onicecandidate = function (ev) {
            if (!ev.candidate) return;
            var m = /(\d{1,3}(?:\.\d{1,3}){3})/.exec(ev.candidate.candidate);
            if (!m || !isPrivateIp(m[1])) return;
            var prefix = m[1].split(".").slice(0, 3).join(".");
            if (prefixes.indexOf(prefix) < 0) prefixes.push(prefix);
         };
         pc.createOffer().then(function (offer) {
            return pc.setLocalDescription(offer);
         }).catch(function () {});
         setTimeout(function () {
            try {
               pc.close();
            } catch (e) {
               /* already closed */
            }
            resolve(prefixes);
         }, 1500);
      });
   }

   /* A RomM server answers /api/heartbeat with its version. Requires the server to
      allow this origin (ROMM_CORS_ALLOWED_ORIGINS), which the app needs anyway. */
   function probeHost(url) {
      return new Promise(function (resolve) {
         var timer = setTimeout(function () { resolve(null); }, 1200);
         fetch(url + "/api/heartbeat", { mode: "cors", cache: "no-store" })
            .then(function (r) { return r.ok ? r.json() : null; })
            .then(function (body) {
               clearTimeout(timer);
               resolve(body && body.SYSTEM && body.SYSTEM.VERSION ? url : null);
            })
            .catch(function () {
               clearTimeout(timer);
               resolve(null);
            });
      });
   }

   function scanNetwork(found, status, done) {
      found.innerHTML = "";
      status.textContent = "Looking for your network…";
      localNetworks().then(function (prefixes) {
         if (!prefixes.length) prefixes = ["192.168.1", "192.168.0", "10.0.0"];
         var hosts = [];
         prefixes.forEach(function (prefix) {
            for (var i = 1; i < 255; i++) hosts.push("http://" + prefix + "." + i);
         });
         var index = 0;
         var checked = 0;
         var hits = [];
         status.textContent = "Scanning " + prefixes.join(", ") + ".x";

         function next() {
            if (index >= hosts.length) return Promise.resolve();
            var url = hosts[index++];
            return probeHost(url).then(function (hit) {
               checked++;
               if (hit) {
                  hits.push(hit);
                  found.appendChild(button({
                     className: "chip",
                     text: hit.replace(/^https?:\/\//, ""),
                     on: { click: function () { connectTo(hit, status); } }
                  }));
               }
               status.textContent = "Scanning… " + checked + " of " + hosts.length +
                  (hits.length ? " · " + hits.length + " found" : "");
               return next();
            });
         }

         var workers = [];
         for (var w = 0; w < 40; w++) workers.push(next());
         return Promise.all(workers).then(function () {
            status.textContent = hits.length
               ? "Choose your RomM server."
               : "No RomM server found. Type the address instead.";
            done();
         });
      });
   }

   function probe(url) {
      return new Promise(function (resolve) {
         var timer = setTimeout(function () { resolve(false); }, 5000);
         /* no-cors: this only proves the server answers; the API calls that follow check access */
         fetch(url + "/api/heartbeat", { mode: "no-cors", cache: "no-store" }).then(
            function () { clearTimeout(timer); resolve(true); },
            function () { clearTimeout(timer); resolve(false); }
         );
      });
   }

   function connectTo(raw, status) {
      var url = normalize(raw);
      if (!url) {
         status.textContent = "Enter a server address.";
         return;
      }
      status.textContent = "Connecting to " + url + "…";
      probe(url).then(function (ok) {
         if (!ok) {
            status.textContent = "Can't reach " + url;
            return;
         }
         state.server = url;
         save("romm.server", url);
         rememberServer(url);
         state.token = load("romm.token");
         if (state.token) show([viewServer, viewLibrary]);
         else show([viewServer, viewPair]);
      });
   }

   function viewPair(message) {
      var notice = message;
      screen("Connect this TV", [el("p", { className: "hint", text: "Starting…" })], notice);
      var mine = state.pollId;

      api("/api/auth/device/init", {
         method: "POST",
         anon: true,
         body: {
            client_device_identifier: deviceId(),
            name: "Samsung TV",
            client: "romm-tizen",
            platform: "tizen",
            client_version: VERSION,
            requested_scopes: SCOPES
         }
      }).then(function (init) {
         if (mine !== state.pollId) return;
         var link = state.server + init.verification_path + "?user_code=" + encodeURIComponent(init.user_code);
         var status = el("p", { className: "status", text: "Waiting for approval…" });
         var qr = qrcode(0, "M");
         qr.addData(link);
         qr.make();
         var qrBox = el("div", { className: "qr" });
         qrBox.innerHTML = qr.createSvgTag({ cellSize: 6, margin: 2 });
         screen("Connect this TV", [
            el("div", { className: "pair" }, [
               qrBox,
               el("div", { className: "pair-text" }, [
                  el("p", { className: "hint", text: "Scan the code with your phone, or open this link on a computer:" }),
                  el("p", { className: "link", text: link }),
                  el("p", { className: "hint", text: "Then approve the code shown below:" }),
                  el("p", { className: "code", text: init.user_code }),
                  status
               ])
            ]),
            button({ text: "Change server", on: { click: function () { show([viewServer]); } } })
         ], notice);
         poll(init, state.pollId, status);
      }).catch(function (err) {
         if (err.unauthorized) return;
         screen("Connect this TV", errorNodes(err, viewPair));
      });
   }

   function poll(init, mine, status) {
      var wait = (init.interval || 5) * 1000;

      function tick() {
         setTimeout(function () {
            if (mine !== state.pollId) return;
            api("/api/auth/device/token", {
               method: "POST",
               anon: true,
               body: { device_code: init.device_code }
            }).then(function (tokenResponse) {
               if (mine !== state.pollId) return;
               state.token = tokenResponse.access_token;
               save("romm.token", state.token);
               show([viewServer, viewLibrary]);
            }).catch(function (err) {
               if (mine !== state.pollId) return;
               if (!err.status) return tick();
               if (err.detail === "authorization_pending") return tick();
               if (err.detail === "slow_down") {
                  wait += 5000;
                  return tick();
               }
               var message = err.detail === "access_denied"
                  ? "The request was denied in RomM."
                  : "The code expired. Start again.";
               status.textContent = message;
               status.appendChild(button({ text: "New code", on: { click: viewPair } }));
            });
         }, wait);
      }

      tick();
   }

   function viewLibrary() {
      screen("Platforms", [el("p", { className: "hint", text: "Loading…" })]);
      api("/api/platforms").then(function (platforms) {
         var withGames = platforms
            .filter(function (p) { return p.rom_count > 0; })
            .sort(function (a, b) { return (a.custom_name || a.name).localeCompare(b.custom_name || b.name); });

         var tiles = withGames.map(function (p) {
            var name = p.custom_name || p.name;
            var logo = assetUrl(p.url_logo)
               ? el("img", { className: "plogo", alt: "", src: assetUrl(p.url_logo) })
               : el("div", { className: "plogo fallback", text: name.replace(/[^A-Za-z0-9]/g, "").slice(0, 2).toUpperCase() });
            return button({
               className: "tile platform",
               on: { click: function () { push(function () { viewRoms(p, 0, []); }); } }
            }, [
               logo,
               el("span", { className: "tname", text: name }),
               el("span", { className: "tcount", text: p.rom_count + " games" })
            ]);
         });

         screen("Platforms", [
            tiles.length
               ? el("div", { className: "grid" }, tiles)
               : el("p", { className: "hint", text: "No games in this library yet." }),
            button({ text: "Forget this TV", on: { click: forget } })
         ], "Signed in to " + state.server);
      }).catch(function (err) {
         if (err.unauthorized) return;
         screen("Platforms", errorNodes(err, viewLibrary));
      });
   }

   function forget() {
      state.token = "";
      save("romm.token", "");
      show([viewServer, viewPair]);
   }

   function assetUrl(path) {
      if (!path) return null;
      return /^https?:\/\//.test(path) ? path : state.server + path;
   }

   function coverUrl(path) {
      return assetUrl(path);
   }

   function romTile(rom, onClick) {
      var cover = coverUrl(rom.path_cover_small)
         ? el("img", { className: "cover", alt: "", src: coverUrl(rom.path_cover_small) })
         : el("div", { className: "cover empty", text: rom.name || rom.fs_name });
      return button({ className: "tile", on: { click: onClick } }, [
         cover,
         el("span", { className: "tname", text: rom.name || rom.fs_name })
      ]);
   }

   function viewRoms(platform, offset, loaded) {
      var title = platform.custom_name || platform.name;
      screen(title, [el("p", { className: "hint", text: "Loading…" })]);
      var query = "platform_ids=" + platform.id +
         "&limit=" + PAGE + "&offset=" + offset +
         "&with_char_index=false&with_filter_values=false&with_rom_id_index=false";

      api("/api/roms?" + query).then(function (page) {
         var items = loaded.concat(page.items);
         var nodes = [];
         if (!items.length) {
            nodes.push(el("p", { className: "hint", text: "No games on this platform." }));
         } else {
            nodes.push(el("div", { className: "grid" }, items.map(function (rom) {
               return romTile(rom, function () {
                  push(function () { viewRom(rom.id, platform); });
               });
            })));
         }
         if (items.length < page.total) {
            nodes.push(button({
               text: "Load more",
               on: { click: function () { viewRoms(platform, offset + PAGE, items); } }
            }));
         }
         screen(title, nodes, items.length + " of " + page.total + " games");
      }).catch(function (err) {
         if (err.unauthorized) return;
         screen(title, errorNodes(err, function () { viewRoms(platform, offset, loaded); }));
      });
   }

   function openRom(id, platformId) {
      api("/api/platforms").then(function (list) {
         var platform = list.filter(function (p) { return p.id === platformId; })[0];
         viewRom(id, platform);
      }).catch(function (err) {
         if (err.unauthorized) return;
         screen("Game", errorNodes(err, function () { openRom(id, platformId); }));
      });
   }

   function viewRom(id, platform) {
      screen("Game", [el("p", { className: "hint", text: "Loading…" })]);
      api("/api/roms/" + id).then(function (rom) {
         var poster = coverUrl(rom.path_cover_large || rom.path_cover_small);
         var status = el("p", { className: "status" });
         var summary = rom.summary ? rom.summary.slice(0, 500) : "No description.";
         var backdrop = poster ? el("div", { className: "backdrop", id: "backdrop" }) : null;
         if (backdrop) backdrop.style.backgroundImage = "url(\"" + poster + "\")";
         screen(rom.name || rom.fs_name, [
            backdrop,
            el("div", { className: "detail" }, [
               poster ? el("img", { className: "poster", alt: "", src: poster }) : null,
               el("div", { className: "info" }, [
                  el("p", { className: "hint", text: summary }),
                  el("p", { className: "hint", text: rom.fs_name + (rom.fs_size_bytes ? "  ·  " + fmtSize(rom.fs_size_bytes) : "") })
               ])
            ]),
            button({
               text: "Play",
               on: {
                  click: function () {
                     if (!platform) {
                        status.textContent = "This game's platform could not be found. Go back and open it again.";
                        return;
                     }
                     playRom(rom, platform);
                  }
               }
            }),
            status
         ]);
      }).catch(function (err) {
         if (err.unauthorized) return;
         screen("Game", errorNodes(err, function () { viewRom(id, platform); }));
      });
   }

   /* ----------------------------------------------------------- player -- */

   function pickCore(slug) {
      var cores = EJS_CORES[String(slug || "").toLowerCase()] || [];
      for (var i = 0; i < cores.length; i++) {
         if (THREADED_CORES.indexOf(cores[i]) < 0) return cores[i];
      }
      return null;
   }

   /* Neo Geo keeps its BIOS as neogeo.zip; other systems use the platform's only firmware. */
   function pickBios(platform) {
      var list = (platform.firmware || []).filter(function (f) { return !f.missing_from_fs; });
      var named = list.filter(function (f) { return /neogeo/i.test(f.file_name); })[0];
      if (named) return named;
      return list.length === 1 ? list[0] : null;
   }

   function playRom(rom, platform) {
      var core = pickCore(platform.slug);
      if (!core) {
         screen(rom.name || rom.fs_name, [el("p", { className: "status", text: "This system can't run on the TV yet." }),
            button({ text: "Back", on: { click: back } })]);
         return;
      }
      var bios = pickBios(platform);
      var needsBios = /^neogeo(mvs|aes)$/i.test(platform.slug || "");
      /* Arcade cores also read a Neo Geo style archive whole (RomM's keepArcadeBiosWhole). */
      var wholeBios = /^(arcade|mame|neogeomvs|neogeoaes)$/i.test(platform.slug || "");
      if (needsBios && !bios) {
         screen(rom.name || rom.fs_name, [el("p", { className: "status", text: "The BIOS for this system is missing in RomM." }),
            button({ text: "Back", on: { click: back } })]);
         return;
      }

      state.current = { romId: rom.id, platformId: platform.id };
      screen("Loading", [el("p", { className: "hint", text: "Downloading " + rom.fs_name + "…" })]);

      Promise.all([
         apiBlob("/api/roms/" + rom.id + "/content/" + encodeURIComponent(rom.fs_name)),
         bios ? apiBlob("/api/firmware/" + bios.id + "/content/" + encodeURIComponent(bios.file_name)) : null
      ]).then(function (parts) {
         /* Neo Geo reads neogeo.zip whole, so it goes in as an external file under its own
            name, as RomM does (keepArcadeBiosWhole). Other systems get a plain BIOS URL. */
         var biosBlob = parts[1] ? URL.createObjectURL(parts[1]) : "";
         startEmulator({
            core: core,
            gameUrl: URL.createObjectURL(parts[0]),
            gameName: rom.fs_name,
            biosUrl: wholeBios ? "" : biosBlob,
            externalFiles: wholeBios && bios ? { ["/" + bios.file_name]: biosBlob } : {}
         });
      }).catch(function (err) {
         if (err.unauthorized) return;
         screen(rom.name || rom.fs_name, errorNodes(err, function () { playRom(rom, platform); }));
      });
   }

   function startEmulator(game) {
      state.playing = true;
      root.innerHTML = "";
      root.appendChild(el("div", { id: "game", className: "game" }));

      /* EmulatorJS reads its settings from these globals when its loader runs. */
      window.EJS_player = "#game";
      window.EJS_core = game.core;
      window.EJS_gameUrl = game.gameUrl;
      window.EJS_gameName = game.gameName;
      window.EJS_biosUrl = game.biosUrl;
      window.EJS_externalFiles = game.externalFiles || {};
      /* VSync off by default. Saved settings would override this default once a user
         changes anything, so they are turned off; the TV has no settings to keep. */
      window.EJS_defaultOptions = { vsync: "disabled" };
      window.EJS_disableLocalStorage = true;
      /* The defaults above are not always applied to the running core, so VSync is also
         switched off once the game starts. */
      window.EJS_onGameStart = function () {
         try {
            window.EJS_emulator.gameManager.setVSync(false);
         } catch (e) {
            /* the core has no VSync control */
         }
      };
      window.EJS_pathtodata = state.server + EMULATORJS_PATH;
      window.EJS_threads = false;
      window.EJS_startOnLoaded = true;
      window.EJS_color = "#4f8cff";
      window.EJS_backgroundColor = "#000000";

      var loader = document.createElement("script");
      loader.src = state.server + EMULATORJS_PATH + "/loader.js";
      loader.onerror = function () {
         exitPlayer("The emulator could not be loaded. Check that RomM serves /assets/emulatorjs.");
      };
      document.body.appendChild(loader);
   }

   /* EmulatorJS keeps global state, so leaving a game reloads the app; the app then
      returns to the game it was playing. */
   function exitPlayer(notice) {
      var ret = state.current ? { romId: state.current.romId, platformId: state.current.platformId, notice: notice || "" } : null;
      try {
         sessionStorage.setItem("romm.return", JSON.stringify(ret));
      } catch (e) {
         /* without session storage the app opens on the library */
      }
      window.location.reload();
   }

   /* ----------------------------------------------------------- remote -- */

   function visible(node) {
      return node.getClientRects().length > 0;
   }

   function move(dir) {
      var items = [].slice.call(root.querySelectorAll(".f")).filter(visible);
      if (!items.length) return;
      var current = document.activeElement;
      if (items.indexOf(current) < 0) {
         items[0].focus();
         return;
      }
      var a = current.getBoundingClientRect();
      var ax = a.left + a.width / 2;
      var ay = a.top + a.height / 2;
      var best = null;
      var bestScore = Infinity;

      items.forEach(function (node) {
         if (node === current) return;
         var b = node.getBoundingClientRect();
         var dx = b.left + b.width / 2 - ax;
         var dy = b.top + b.height / 2 - ay;
         var primary;
         var secondary;
         if (dir === "L") {
            if (dx >= -1) return;
            primary = -dx;
            secondary = Math.abs(dy);
         } else if (dir === "R") {
            if (dx <= 1) return;
            primary = dx;
            secondary = Math.abs(dy);
         } else if (dir === "U") {
            if (dy >= -1) return;
            primary = -dy;
            secondary = Math.abs(dx);
         } else {
            if (dy <= 1) return;
            primary = dy;
            secondary = Math.abs(dx);
         }
         var score = primary + secondary * 2;
         if (score < bestScore) {
            bestScore = score;
            best = node;
         }
      });

      if (best) {
         best.focus();
         best.scrollIntoView({ block: "nearest" });
      }
   }

   document.addEventListener("keydown", function (e) {
      var k = e.keyCode;
      if (state.playing) {
         if (k === KEY.BACK || k === KEY.ESC) {
            e.preventDefault();
            exitPlayer("");
         }
         return;
      }
      if (k === KEY.BACK || k === KEY.ESC) {
         e.preventDefault();
         back();
         return;
      }
      var dir = DIRECTION[k];
      if (!dir) return;
      if (e.target && e.target.tagName === "INPUT" && (dir === "L" || dir === "R")) return;
      e.preventDefault();
      move(dir);
   });

   /* ------------------------------------------------------------- start -- */

   function autoConnect(ret) {
      show([viewServer], "Connecting to " + state.server + "…");
      probe(state.server).then(function (ok) {
         if (!ok) {
            show([viewServer], "Can't reach " + state.server);
            return;
         }
         var stack = [viewServer, viewLibrary];
         if (ret && ret.romId) stack.push(function () { openRom(ret.romId, ret.platformId); });
         show(stack, ret && ret.notice ? ret.notice : undefined);
      });
   }

   state.server = normalize(load("romm.server") || (window.ROMM_URL || ""));
   state.token = load("romm.token");

   var resume = null;
   try {
      resume = JSON.parse(sessionStorage.getItem("romm.return") || "null");
      sessionStorage.removeItem("romm.return");
   } catch (e) {
      resume = null;
   }

   if (state.server && state.token) autoConnect(resume);
   else show([viewServer], resume && resume.notice ? resume.notice : undefined);
})();
