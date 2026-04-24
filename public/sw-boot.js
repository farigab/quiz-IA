/*
  Service Worker invalidation bootstrap (externalized)
  Runs synchronously to detect new deploys and force unregister+reload.
  Uses defensive storage access to avoid throwing in restricted contexts.
*/
(function () {
  if (!('serviceWorker' in navigator)) return;

  var STORAGE_KEY = 'showdo_build_id';
  var NUKE_FLAG = 'showdo_nuked';

  var safeStorage = {
    get: function (k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set: function (k, v) { try { localStorage.setItem(k, v); } catch (e) { } },
  };

  function nukeAndReload(newId) {
    try { safeStorage.set(STORAGE_KEY, String(newId)); } catch (e) { }
    try { sessionStorage.setItem(NUKE_FLAG, '1'); } catch (e) { }
    Promise.all([
      navigator.serviceWorker.getRegistrations().then(function (regs) {
        return Promise.all(regs.map(function (r) { return r.unregister(); }));
      }),
      caches.keys().then(function (keys) {
        return Promise.all(keys.map(function (k) { return caches.delete(k); }));
      })
    ]).then(function () {
      try { location.reload(); } catch (e) { /* ignore */ }
    });
  }

  try {
    if (sessionStorage.getItem(NUKE_FLAG)) return;
  } catch (e) {
    // sessionStorage might be unavailable in some privacy modes — continue
  }

  function processConfig(cfg) {
    var newId = cfg && cfg.buildId;
    var swFile = cfg && cfg.serviceWorkerFile;
    if (!newId) return;

    var storedId = safeStorage.get(STORAGE_KEY);

    // new deploy
    if (storedId !== String(newId)) {
      nukeAndReload(newId);
      return;
    }

    // same buildId but different SW file registered
    navigator.serviceWorker.getRegistrations().then(function (regs) {
      var hasWrongSW = regs.some(function (r) {
        var url = (r.active || {}).scriptURL || '';
        return swFile && url && !url.endsWith(swFile) && url.indexOf('service-worker') !== -1;
      });
      if (hasWrongSW) nukeAndReload(newId);
    });
  }

  // Try cached config from this session (TTL 60s) to avoid a fetch on every
  // page load while still detecting recent deploys quickly.
  try {
    var cached = null;
    try { cached = sessionStorage.getItem('showdo_cfg_cached'); } catch (e) { cached = null; }
    var ts = 0;
    try { ts = Number(sessionStorage.getItem('showdo_cfg_ts') || '0'); } catch (e) { ts = 0; }
    var now = Date.now();
    if (cached && ts && (now - ts) < 60 * 1000) {
      try { processConfig(JSON.parse(cached)); } catch (e) { /* fallthrough to network */ }
    } else {
      fetch('/config.json', { cache: 'no-store' })
        .then(function (r) { return r.json(); })
        .then(function (cfg) {
          try { sessionStorage.setItem('showdo_cfg_cached', JSON.stringify(cfg)); sessionStorage.setItem('showdo_cfg_ts', String(Date.now())); } catch (e) { }
          processConfig(cfg);
        })
        .catch(function () { /* network error — skip */ });
    }
  } catch (e) {
    // If anything goes wrong with sessionStorage, fall back to the original
    // network-only behaviour.
    fetch('/config.json', { cache: 'no-store' })
      .then(function (r) { return r.json(); })
      .then(function (cfg) { processConfig(cfg); })
      .catch(function () { /* network error — skip */ });
  }
})();
