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

   var root = document.getElementById("app");
   var state = {
      server: "",
      token: "",
      stack: [],
      pollId: 0
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

   /* ------------------------------------------------------------ screens -- */

   function screen(title, nodes, sub) {
      state.pollId++;
      root.innerHTML = "";
      var header = el("header", { className: "top" }, [
         el("h1", { text: title }),
         sub ? el("p", { className: "sub", text: sub }) : null
      ]);
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

   function viewServer(message) {
      var input = el("input", {
         className: "f",
         type: "url",
         id: "url",
         value: state.server,
         placeholder: "http://192.168.1.10",
         autocapitalize: "off",
         spellcheck: "false"
      });
      var status = el("p", { className: "status", text: message || "" });
      var connect = function () {
         connectTo(input.value, status);
      };
      input.addEventListener("keydown", function (e) {
         if (e.keyCode === KEY.ENTER) {
            e.preventDefault();
            connect();
         }
      });
      screen("RomM", [
         el("p", { className: "hint", text: "Enter the address of your RomM server, for example http://192.168.1.10" }),
         input,
         button({ text: "Connect", on: { click: connect } }),
         status
      ]);
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
         screen("Connect this TV", [
            el("p", { className: "hint", text: "In RomM on a phone or computer, open this page and approve the code:" }),
            el("p", { className: "link", text: link }),
            el("p", { className: "code", text: init.user_code }),
            status,
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
            return button({
               className: "tile",
               on: { click: function () { push(function () { viewRoms(p, 0, []); }); } }
            }, [
               el("span", { className: "tname", text: p.custom_name || p.name }),
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

   function coverUrl(path) {
      return path ? state.server + path : null;
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

   function viewRom(id) {
      screen("Game", [el("p", { className: "hint", text: "Loading…" })]);
      api("/api/roms/" + id).then(function (rom) {
         var poster = coverUrl(rom.path_cover_large || rom.path_cover_small);
         var status = el("p", { className: "status" });
         var summary = rom.summary ? rom.summary.slice(0, 500) : "No description.";
         screen(rom.name || rom.fs_name, [
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
                     status.textContent = "Playing on the TV is the next step. This version only browses the library.";
                  }
               }
            }),
            status
         ]);
      }).catch(function (err) {
         if (err.unauthorized) return;
         screen("Game", errorNodes(err, function () { viewRom(id); }));
      });
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

   state.server = normalize(load("romm.server") || (window.ROMM_URL || ""));
   state.token = load("romm.token");
   show([viewServer]);
})();
