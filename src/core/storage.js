  // --- S2A.storage ---
  (function (S2A) {
    const NS = S2A.NS || 's2a';
    const LEGACY_GROK_KEY = 's2a_grok_quota_cfg';

    function rawGet(key, def = null) {
      try {
        if (typeof GM_getValue === 'function') {
          const v = GM_getValue(key, def);
          return v == null ? def : v;
        }
        const v = localStorage.getItem(key);
        return v == null ? def : v;
      } catch (_) {
        return def;
      }
    }

    function rawSet(key, val) {
      try {
        if (typeof GM_setValue === 'function') {
          GM_setValue(key, val);
          return;
        }
        localStorage.setItem(key, typeof val === 'string' ? val : JSON.stringify(val));
      } catch (_) {}
    }

    function cfgKey(toolId) {
      if (!toolId || toolId === 'shell') return `${NS}.cfg.shell`;
      return `${NS}.cfg.${toolId}`;
    }

    function getJson(key, defaults = {}) {
      try {
        let raw = rawGet(key, null);
        // migrate legacy grok-quota key
        if ((raw == null || raw === '') && key === cfgKey('grok-quota')) {
          raw = rawGet(LEGACY_GROK_KEY, null);
          if (raw != null && raw !== '') {
            const migrated = typeof raw === 'string' ? JSON.parse(raw) : raw;
            setJson(key, { ...defaults, ...migrated });
            return { ...defaults, ...migrated };
          }
        }
        if (raw == null || raw === '') return { ...defaults };
        const obj = typeof raw === 'string' ? JSON.parse(raw) : raw;
        return { ...defaults, ...obj };
      } catch (_) {
        return { ...defaults };
      }
    }

    function setJson(key, obj) {
      rawSet(key, obj);
    }

    function getToolCfg(toolId, defaults = {}) {
      return getJson(cfgKey(toolId), defaults);
    }

    function setToolCfg(toolId, cfg) {
      setJson(cfgKey(toolId), cfg);
    }

    function getShellCfg(defaults = {}) {
      return getJson(cfgKey('shell'), defaults);
    }

    function setShellCfg(cfg) {
      setJson(cfgKey('shell'), cfg);
    }

    S2A.storage = {
      rawGet,
      rawSet,
      cfgKey,
      getJson,
      setJson,
      getToolCfg,
      setToolCfg,
      getShellCfg,
      setShellCfg,
      LEGACY_GROK_KEY,
    };
  })(S2A);

