/*
 * RomM for Tizen - splash and server selection.
 *
 * The TV opens the RomM web UI itself, so there is nothing to reimplement here:
 * the app only works out which server to load, checks that it answers, and
 * hands the screen over. Everything after that (login, library, player) is
 * RomM's own web frontend running on the TV's Chromium.
 *
 * Written without syntax newer than Chromium 85, which is what Tizen 6.5 ships.
 */
(function () {
   "use strict";

   var STORAGE_KEY = "romm.url";
   var PROBE_TIMEOUT_MS = 5000;
   var HEALTH_PATH = "/api/heartbeat";

   var statusEl = document.getElementById("status");
   var formEl = document.getElementById("form");
   var inputEl = document.getElementById("url");
   var hintEl = document.getElementById("hint");
   var retryEl = document.getElementById("retry");
   var forceEl = document.getElementById("force");
   var changeEl = document.getElementById("change");
   var goEl = document.getElementById("go");

   var current = "";

   function readStored() {
      try {
         return localStorage.getItem(STORAGE_KEY);
      } catch (e) {
         return null;
      }
   }

   function writeStored(url) {
      try {
         localStorage.setItem(STORAGE_KEY, url);
      } catch (e) {
         /* private mode or full quota - the default from config.js still works */
      }
   }

   function normalize(raw) {
      var url = (raw || "").trim();
      if (!url) return "";
      if (!/^https?:\/\//i.test(url)) url = "http://" + url;
      return url.replace(/\/+$/, "");
   }

   function defaultUrl() {
      return normalize(window.ROMM_URL || "");
   }

   function hostOf(url) {
      return url.replace(/^https?:\/\//i, "");
   }

   function setStatus(text) {
      statusEl.textContent = text;
   }

   function hideActions() {
      formEl.hidden = true;
      hintEl.hidden = true;
      retryEl.hidden = true;
      forceEl.hidden = true;
      changeEl.hidden = true;
   }

   function showForm(url) {
      hideActions();
      formEl.hidden = false;
      hintEl.hidden = false;
      inputEl.value = url || "";
      inputEl.focus();
      setStatus("Enter your RomM server address");
   }

   function showUnreachable(url) {
      hideActions();
      retryEl.hidden = false;
      forceEl.hidden = false;
      changeEl.hidden = false;
      setStatus("Can't reach " + hostOf(url));
   }

   function open(url) {
      writeStored(url);
      setStatus("Opening " + hostOf(url) + "…");
      hideActions();
      window.location.replace(url + "/");
   }

   /*
    * Reachability probe. A no-cors request is sent but cannot be read, which is
    * exactly what we want: RomM sends no CORS headers to foreign origins, yet a
    * resolved promise still proves the server answered.
    */
   function reachable(url) {
      return new Promise(function (resolve) {
         var settled = false;
         var timer = null;

         function finish(ok) {
            if (settled) return;
            settled = true;
            if (timer) clearTimeout(timer);
            resolve(ok);
         }

         if (typeof AbortController !== "function") {
            finish(true);
            return;
         }

         var controller = new AbortController();
         timer = setTimeout(function () {
            try {
               controller.abort();
            } catch (e) {
               /* already finished */
            }
            finish(false);
         }, PROBE_TIMEOUT_MS);

         fetch(url + HEALTH_PATH, {
            mode: "no-cors",
            cache: "no-store",
            signal: controller.signal
         }).then(
            function () {
               finish(true);
            },
            function () {
               finish(false);
            }
         );
      });
   }

   function attempt(url) {
      current = url;
      setStatus("Connecting to " + hostOf(url) + "…");
      hideActions();

      reachable(url).then(function (ok) {
         if (ok) open(url);
         else showUnreachable(url);
      });
   }

   function start() {
      var url = normalize(readStored() || defaultUrl());
      if (!url) {
         showForm("");
         return;
      }
      attempt(url);
   }

   formEl.addEventListener("submit", function (event) {
      event.preventDefault();
      var url = normalize(inputEl.value);
      if (!url) {
         inputEl.focus();
         return;
      }
      attempt(url);
   });

   retryEl.addEventListener("click", function () {
      if (current) attempt(current);
      else start();
   });

   changeEl.addEventListener("click", function () {
      showForm(current);
   });

   forceEl.addEventListener("click", function () {
      if (current) open(current);
   });

   goEl.addEventListener("keydown", function (event) {
      if (event.keyCode === 13) {
         event.preventDefault();
         formEl.dispatchEvent(new Event("submit", { cancelable: true }));
      }
   });

   start();
})();
