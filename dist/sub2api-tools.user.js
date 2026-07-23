// ==UserScript==
// @name         Sub2API Tools
// @namespace    s2a.sub2api-tools
// @version      2.1.1
// @description  Sub2API 管理后台工具集：Grok 额度探测、批量删除错误账号等
// @author       local
// @homepageURL  https://github.com/jeck5001/sub2api-tools
// @supportURL   https://github.com/jeck5001/sub2api-tools/issues
// @downloadURL  https://raw.githubusercontent.com/jeck5001/sub2api-tools/main/dist/sub2api-tools.user.js
// @updateURL    https://raw.githubusercontent.com/jeck5001/sub2api-tools/main/dist/sub2api-tools.user.js
// @match        *://*/admin/*
// @match        *://*/admin/accounts*
// @grant        GM_xmlhttpRequest
// @grant        GM_addStyle
// @grant        GM_setValue
// @grant        GM_getValue
// @connect      *
// @run-at       document-idle
// ==/UserScript==


/* ==== src/bootstrap.js ==== */
(function () {
  'use strict';

  /** @type {any} */
  const S2A = (window.__S2A__ = window.__S2A__ || {});
  S2A.version = '2.1.1';
  S2A.NS = 's2a';
  S2A.util = S2A.util || {};
  S2A.storage = S2A.storage || {};
  S2A.auth = S2A.auth || {};
  S2A.api = S2A.api || {};
  S2A.domAccounts = S2A.domAccounts || {};
  S2A.shell = S2A.shell || {};
  S2A.registry = S2A.registry || {};
  S2A.tools = S2A.tools || {};
  // registerTool / openTool etc. filled by registry.js
  // Modules below close over this IIFE scope and attach to S2A.



/* ==== src/core/util.js ==== */
  // --- S2A.util ---
  (function (S2A) {
    function $(sel, root = document) {
      return root.querySelector(sel);
    }

    function $$(sel, root = document) {
      return Array.from(root.querySelectorAll(sel));
    }

    function sleep(ms) {
      return new Promise((r) => setTimeout(r, ms));
    }

    function esc(s) {
      return String(s ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
    }

    function formatNum(n) {
      const x = Number(n);
      if (!Number.isFinite(x)) return String(n);
      if (x >= 1e6) return (x / 1e6).toFixed(x % 1e6 === 0 ? 0 : 1) + 'M';
      if (x >= 1e3) return (x / 1e3).toFixed(x % 1e3 === 0 ? 0 : 1) + 'K';
      return String(x);
    }

    function parseIdsText(text) {
      return String(text || '')
        .split(/[\s,;|]+/)
        .map((x) => x.trim())
        .filter(Boolean)
        .filter((x, i, arr) => arr.indexOf(x) === i);
    }

    function downloadBlob(blob, filename) {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = filename;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    }

    S2A.util = { $, $$, sleep, esc, formatNum, parseIdsText, downloadBlob };
  })(S2A);



/* ==== src/core/storage.js ==== */
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



/* ==== src/core/auth.js ==== */
  // --- S2A.auth ---
  (function (S2A) {
    function getAuthToken() {
      return (
        localStorage.getItem('auth_token') ||
        sessionStorage.getItem('auth_token') ||
        ''
      ).trim();
    }

    function assertLoggedIn() {
      const token = getAuthToken();
      if (!token) {
        throw new Error('未登录：localStorage 中没有 auth_token，请先登录管理后台');
      }
      return token;
    }

    S2A.auth = { getAuthToken, assertLoggedIn };
  })(S2A);



/* ==== src/core/api.js ==== */
  // --- S2A.api ---
  (function (S2A) {
    function getApiBase() {
      // sub2api SPA axios baseURL = /api/v1
      return `${location.origin}/api/v1`;
    }

    async function apiRequest(path, opts = {}) {
      const token = S2A.auth.getAuthToken();
      if (!token) throw new Error('未登录：localStorage 中没有 auth_token，请先登录管理后台');

      const url = path.startsWith('http')
        ? path
        : `${getApiBase()}${path.startsWith('/') ? '' : '/'}${path}`;
      const method = (opts.method || 'GET').toUpperCase();
      const headers = {
        Accept: 'application/json',
        Authorization: `Bearer ${token}`,
        ...(opts.headers || {}),
      };
      if (opts.body && !headers['Content-Type']) headers['Content-Type'] = 'application/json';

      // Prefer same-origin fetch
      if (url.startsWith(location.origin) || !url.startsWith('http')) {
        const res = await fetch(url, {
          method,
          headers,
          credentials: 'include',
          body: opts.body || undefined,
        });
        let data = null;
        const ct = (res.headers.get('content-type') || '').toLowerCase();
        if (ct.includes('application/json')) data = await res.json();
        else {
          const text = await res.text();
          try {
            data = JSON.parse(text);
          } catch {
            data = { message: text.slice(0, 300) };
          }
        }
        if (!res.ok) {
          const msg = data?.message || data?.detail || data?.error || res.statusText || `HTTP ${res.status}`;
          const err = new Error(typeof msg === 'string' ? msg : JSON.stringify(msg));
          err.status = res.status;
          err.data = data;
          throw err;
        }
        // sub2api wraps {code, message, data}
        if (data && typeof data === 'object' && 'code' in data) {
          if (data.code === 0 || data.code === 200) return data.data;
          throw new Error(data.message || `业务错误 code=${data.code}`);
        }
        return data;
      }

      // Fallback GM_xmlhttpRequest for cross-origin
      return new Promise((resolve, reject) => {
        if (typeof GM_xmlhttpRequest !== 'function') {
          reject(new Error('跨域请求需要 GM_xmlhttpRequest'));
          return;
        }
        GM_xmlhttpRequest({
          method,
          url,
          headers,
          data: opts.body || undefined,
          responseType: 'json',
          onload(resp) {
            let data = resp.response;
            if (data == null && resp.responseText) {
              try {
                data = JSON.parse(resp.responseText);
              } catch {
                data = { message: resp.responseText.slice(0, 300) };
              }
            }
            if (resp.status < 200 || resp.status >= 300) {
              const err = new Error(data?.message || `HTTP ${resp.status}`);
              err.status = resp.status;
              err.data = data;
              reject(err);
              return;
            }
            if (data && typeof data === 'object' && 'code' in data) {
              if (data.code === 0 || data.code === 200) resolve(data.data);
              else reject(new Error(data.message || `业务错误 code=${data.code}`));
              return;
            }
            resolve(data);
          },
          onerror: () => reject(new Error('网络错误')),
          ontimeout: () => reject(new Error('请求超时')),
        });
      });
    }

    async function deleteAccount(accountId) {
      return apiRequest(`/admin/accounts/${encodeURIComponent(accountId)}`, { method: 'DELETE' });
    }

    S2A.api = { getApiBase, apiRequest, deleteAccount };
  })(S2A);



/* ==== src/core/dom-accounts.js ==== */
  // --- S2A.domAccounts ---
  (function (S2A) {
    const { $, $$ } = S2A.util;

    function rowLooksGrok(row) {
      if (!row) return true;
      const text = (row.textContent || '').toLowerCase();
      return text.includes('grok');
    }

    function extractIdFromRow(row) {
      if (!row) return '';
      const dataRowId = row.getAttribute?.('data-row-id');
      if (dataRowId && /^\d+$/.test(dataRowId)) return dataRowId;

      const host = row.closest?.('[data-row-id]') || row;
      const hostId = host?.getAttribute?.('data-row-id');
      if (hostId && /^\d+$/.test(hostId)) return hostId;

      const candidates = $$('span, td, div', row).map((el) => (el.textContent || '').trim());
      for (const t of candidates) {
        const m = t.match(/^#(\d+)$/);
        if (m) return m[1];
      }
      for (const attr of ['data-id', 'data-account-id', 'data-row-key']) {
        const v = row.getAttribute?.(attr);
        if (v && /^\d+$/.test(v)) return v;
      }
      const m2 = (row.textContent || '').match(/#(\d{1,12})\b/);
      return m2 ? m2[1] : '';
    }

    /**
     * Detect forbidden / validation / violation badge in usage window column.
     */
    function detectForbiddenInRow(row) {
      if (!row) return null;
      const badges = $$('span, div, button', row).filter((el) => {
        const t = (el.textContent || '').trim().toLowerCase();
        if (!t || t.length > 40) return false;
        return (
          t === 'forbidden' ||
          t === 'validation' ||
          t === 'violation' ||
          t.includes('forbidden') ||
          t === '禁止' ||
          t === '违规' ||
          t === '需验证' ||
          /forbidden|validation|violation/.test(t)
        );
      });

      for (const el of badges) {
        const t = (el.textContent || '').trim().toLowerCase();
        const cls = String(el.className || '');
        const looksBadge =
          cls.includes('bg-red') ||
          cls.includes('bg-yellow') ||
          cls.includes('rounded') ||
          (el.textContent || '').trim().length <= 20;
        if (!looksBadge && t.length > 20) continue;

        if (/\bvalidation\b|需验证/.test(t)) return { type: 'validation', text: (el.textContent || '').trim() };
        if (/\bviolation\b|违规/.test(t)) return { type: 'violation', text: (el.textContent || '').trim() };
        if (/\bforbidden\b|禁止/.test(t) || t === 'forbidden') {
          return { type: 'forbidden', text: (el.textContent || '').trim() };
        }
      }

      const rowText = (row.textContent || '').toLowerCase();
      if (/\bforbidden\b/.test(rowText)) return { type: 'forbidden', text: 'forbidden' };
      return null;
    }

    function extractNameFromRow(row) {
      if (!row) return '';
      const texts = $$('span, div', row)
        .map((el) => (el.textContent || '').trim())
        .filter((t) => t && !/^#\d+$/.test(t) && t.length < 80);
      const email = texts.find((t) => t.includes('@'));
      if (email) return email;
      return texts.find((t) => !/grok|oauth|api|启用|禁用|正常|错误/i.test(t)) || '';
    }

    function shouldSkipNonGrok(row, onlyGrok) {
      if (!onlyGrok || !row) return false;
      const txt = (row.textContent || '').toLowerCase();
      if (/(openai|anthropic|gemini|antigravity|claude)/.test(txt) && !txt.includes('grok')) return true;
      return false;
    }

    /**
     * Detect account status badge in the「状态」column.
     * UI shows pink/red pill: "错误" (also error / Error / failed).
     * @returns {{ type: string, text: string }|null}
     */
    function detectAccountStatusInRow(row) {
      if (!row) return null;

      const badgeMatchers = [
        { type: 'error', re: /^(错误|error|failed|fail)$/i },
        { type: 'error', re: /错误|error|failed/i },
        { type: 'normal', re: /^(正常|normal|ok|active|healthy|enabled)$/i },
        { type: 'disabled', re: /^(禁用|disabled|inactive)$/i },
        { type: 'warning', re: /^(警告|warning|warn)$/i },
      ];

      const nodes = $$('span, div, button, td', row).filter((el) => {
        const t = (el.textContent || '').trim();
        if (!t || t.length > 24) return false;
        // Prefer badge-like short labels
        return /错误|正常|禁用|警告|error|normal|disabled|warning|ok|active|failed/i.test(t);
      });

      for (const el of nodes) {
        const text = (el.textContent || '').trim();
        const t = text.toLowerCase();
        const cls = String(el.className || '');
        const looksBadge =
          cls.includes('bg-red') ||
          cls.includes('bg-green') ||
          cls.includes('bg-yellow') ||
          cls.includes('bg-gray') ||
          cls.includes('rounded') ||
          text.length <= 12;
        if (!looksBadge && text.length > 12) continue;

        for (const m of badgeMatchers) {
          if (m.re.test(text) || m.re.test(t)) {
            // Prefer exact short match for 错误 pill
            if (m.type === 'error' && /^(错误|error|failed|fail)$/i.test(text)) {
              return { type: 'error', text };
            }
            if (m.type !== 'error') return { type: m.type, text };
          }
        }
      }

      // Exact short badge second pass for error (avoid matching "错误信息" in long cells)
      for (const el of nodes) {
        const text = (el.textContent || '').trim();
        if (/^(错误|error|failed|fail)$/i.test(text)) return { type: 'error', text };
      }

      return null;
    }

    function normalizeStatusType(raw) {
      const s = String(raw ?? '').trim().toLowerCase();
      if (!s) return '';
      if (/(错误|error|failed|fail)/.test(s)) return 'error';
      if (/(禁用|disabled|inactive)/.test(s)) return 'disabled';
      if (/(警告|warning|warn)/.test(s)) return 'warning';
      if (/(正常|normal|ok|active|healthy|enabled)/.test(s)) return 'normal';
      return s;
    }

    /**
     * Collect accounts whose status badge matches.
     * @param {{ onlyGrok?: boolean, statuses?: string[], panelRoot?: Element|null }} [opts]
     *   statuses: status types, default ['error']
     */
    function collectByStatusFromDom(opts = {}) {
      const onlyGrok = opts.onlyGrok === true; // default: all platforms for delete tool
      const want = new Set(
        (opts.statuses || ['error']).map((x) => normalizeStatusType(x)).filter(Boolean)
      );
      if (!want.size) want.add('error');

      let rows = $$('tr[data-row-id], [role="row"][data-row-id]');
      if (!rows.length) {
        rows = $$('tr, [role="row"]').filter((r) => r.querySelector('input[type="checkbox"]'));
      }

      const items = [];
      const seen = new Set();
      for (const row of rows) {
        if (opts.panelRoot && opts.panelRoot.contains(row)) continue;
        if (row.closest('#s2a-shell-panel')) continue;

        const hit = detectAccountStatusInRow(row);
        if (!hit || !want.has(hit.type)) continue;

        const id = extractIdFromRow(row);
        if (!id || seen.has(id)) continue;
        if (shouldSkipNonGrok(row, onlyGrok)) continue;

        seen.add(id);
        items.push({
          id,
          name: extractNameFromRow(row),
          platform: rowLooksGrok(row) ? 'grok' : '',
          statusType: hit.type,
          statusText: hit.text,
        });
      }
      return items;
    }

    /**
     * @param {{ onlyGrok?: boolean, panelRoot?: Element|null }} [opts]
     */
    function collectSelectedFromDom(opts = {}) {
      const onlyGrok = opts.onlyGrok !== false;
      const panelRoot = opts.panelRoot || null;
      const boxes = $$('input[type="checkbox"]');
      const items = [];
      const seen = new Set();

      for (const box of boxes) {
        if (!box.checked) continue;
        if (panelRoot && panelRoot.contains(box)) continue;
        if (box.closest('#s2a-shell-panel') || box.closest('[id^="s2a-tool-"]')) continue;
        if (box.id && /bulk-edit|enabled|remember/i.test(box.id)) continue;

        const row =
          box.closest('tr[data-row-id]') ||
          box.closest('[data-row-id]') ||
          box.closest('tr') ||
          box.closest('[role="row"]') ||
          box.parentElement?.parentElement;

        const id = extractIdFromRow(row);
        if (!id) continue;
        if (seen.has(id)) continue;
        if (shouldSkipNonGrok(row, onlyGrok)) continue;

        seen.add(id);
        const forbidden = detectForbiddenInRow(row);
        items.push({
          id,
          name: extractNameFromRow(row),
          platform: rowLooksGrok(row) ? 'grok' : '',
          forbiddenType: forbidden?.type || '',
          forbiddenText: forbidden?.text || '',
        });
      }
      return items;
    }

    /**
     * @param {{ onlyGrok?: boolean }} [opts]
     */
    function collectPageAccountsFromDom(opts = {}) {
      const onlyGrok = opts.onlyGrok !== false;
      const items = [];
      const seen = new Set();

      const rows = $$('tr[data-row-id], [role="row"][data-row-id]');
      if (rows.length) {
        for (const row of rows) {
          const id = extractIdFromRow(row);
          if (!id || seen.has(id)) continue;
          if (shouldSkipNonGrok(row, onlyGrok)) continue;
          seen.add(id);
          items.push({ id, name: extractNameFromRow(row), platform: rowLooksGrok(row) ? 'grok' : '' });
        }
        return items;
      }

      const idSpans = $$('span').filter((el) => /^#\d+$/.test((el.textContent || '').trim()));
      for (const span of idSpans) {
        const id = (span.textContent || '').trim().replace(/^#/, '');
        if (!id || seen.has(id)) continue;
        const row =
          span.closest('tr') ||
          span.closest('[role="row"]') ||
          span.parentElement?.parentElement?.parentElement;
        if (shouldSkipNonGrok(row, onlyGrok)) continue;
        const hasCheck = row && row.querySelector('input[type="checkbox"]');
        if (!hasCheck) continue;
        seen.add(id);
        items.push({ id, name: extractNameFromRow(row), platform: row && rowLooksGrok(row) ? 'grok' : '' });
      }
      return items;
    }

    /**
     * @param {{ onlyGrok?: boolean, includeValidation?: boolean, includeViolation?: boolean }} [opts]
     */
    function collectForbiddenFromDom(opts = {}) {
      const onlyGrok = opts.onlyGrok !== false;
      const includeValidation = opts.includeValidation !== false;
      const includeViolation = opts.includeViolation !== false;
      const allowed = new Set(['forbidden']);
      if (includeValidation) allowed.add('validation');
      if (includeViolation) allowed.add('violation');

      let rows = $$('tr[data-row-id], [role="row"][data-row-id]');
      if (!rows.length) {
        rows = $$('tr, [role="row"]').filter((r) => r.querySelector('input[type="checkbox"]'));
      }

      const items = [];
      const seen = new Set();
      for (const row of rows) {
        const hit = detectForbiddenInRow(row);
        if (!hit || !allowed.has(hit.type)) continue;

        const id = extractIdFromRow(row);
        if (!id || seen.has(id)) continue;
        if (shouldSkipNonGrok(row, onlyGrok)) continue;

        seen.add(id);
        items.push({
          id,
          name: extractNameFromRow(row),
          platform: rowLooksGrok(row) ? 'grok' : '',
          forbiddenType: hit.type,
          forbiddenText: hit.text,
        });
      }
      return items;
    }

    /**
     * @param {{
     *   onlyGrok?: boolean,
     *   timezone?: string,
     *   platform?: string,
     *   status?: string,
     *   statuses?: string[],
     *   extraParams?: Record<string, string>,
     * }} [opts]
     * statuses: client-side filter after fetch (error/normal/disabled/…).
     * status: passed as query param if set (server-side filter attempt).
     */
    async function fetchAllAccountIdsFromApi(opts = {}) {
      // Default onlyGrok=true for backward compat with grok-quota tool
      const onlyGrok = opts.onlyGrok !== false;
      const timezone =
        (opts.timezone || '').trim() ||
        (() => {
          try {
            return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Shanghai';
          } catch (_) {
            return 'Asia/Shanghai';
          }
        })();

      const statusFilter = (opts.statuses || [])
        .map((x) => normalizeStatusType(x))
        .filter(Boolean);
      const wantStatus = statusFilter.length ? new Set(statusFilter) : null;

      const pageSize = 100;
      let page = 1;
      let total = Infinity;
      const items = [];
      const seen = new Set();

      while (true) {
        const params = new URLSearchParams({
          page: String(page),
          page_size: String(pageSize),
          timezone,
        });
        if (onlyGrok) params.set('platform', 'grok');
        else if (opts.platform) params.set('platform', String(opts.platform));
        if (opts.status) params.set('status', String(opts.status));
        if (opts.extraParams && typeof opts.extraParams === 'object') {
          for (const [k, v] of Object.entries(opts.extraParams)) {
            if (v != null && v !== '') params.set(k, String(v));
          }
        }

        const data = await S2A.api.apiRequest(`/admin/accounts?${params.toString()}`);
        const rows = data?.items || data?.list || data?.accounts || data?.data || (Array.isArray(data) ? data : []);
        if (!wantStatus) {
          total = Number(data?.total ?? data?.count ?? rows.length) || rows.length;
        }

        for (const row of rows) {
          const id = String(row.id ?? row.account_id ?? '').trim();
          if (!id || seen.has(id)) continue;
          if (onlyGrok && row.platform && String(row.platform).toLowerCase() !== 'grok') continue;

          const statusRaw =
            row.status_label ??
            row.status_text ??
            row.status ??
            row.state ??
            row.account_status ??
            row.error_status ??
            '';
          const statusType = normalizeStatusType(statusRaw);

          if (wantStatus && !wantStatus.has(statusType)) continue;

          seen.add(id);
          items.push({
            id,
            name: row.name || row.email || '',
            platform: row.platform || '',
            type: row.type || '',
            statusType: statusType || '',
            statusText: statusRaw ? String(statusRaw) : statusType || '',
          });
        }

        if (!rows.length || rows.length < pageSize) break;
        if (!wantStatus && items.length >= total) break;
        page += 1;
        if (page > 500) break;
        await S2A.util.sleep(80);
      }
      return items;
    }

    S2A.domAccounts = {
      rowLooksGrok,
      extractIdFromRow,
      extractNameFromRow,
      detectForbiddenInRow,
      detectAccountStatusInRow,
      normalizeStatusType,
      collectSelectedFromDom,
      collectPageAccountsFromDom,
      collectForbiddenFromDom,
      collectByStatusFromDom,
      fetchAllAccountIdsFromApi,
    };
  })(S2A);



/* ==== src/core/registry.js ==== */
  // --- S2A.registry ---
  (function (S2A) {
    /** @type {Map<string, any>} */
    const tools = new Map();
    let activeToolId = null;
    /** @type {(() => void)|null} */
    let activeDispose = null;

    function makeCtx() {
      return {
        pathname: location.pathname,
        origin: location.origin,
        api: S2A.api,
        auth: S2A.auth,
        storage: S2A.storage,
        dom: S2A.domAccounts,
        util: S2A.util,
        shell: S2A.shell,
      };
    }

    function registerTool(def) {
      if (!def || !def.id) throw new Error('registerTool: id required');
      if (tools.has(def.id)) {
        console.warn('[S2A] tool already registered:', def.id);
        return;
      }
      tools.set(def.id, {
        id: def.id,
        name: def.name || def.id,
        description: def.description || '',
        order: Number(def.order) || 100,
        match: typeof def.match === 'function' ? def.match : null,
        barActions: typeof def.barActions === 'function' ? def.barActions : null,
        onInit: typeof def.onInit === 'function' ? def.onInit : null,
        onOpen: typeof def.onOpen === 'function' ? def.onOpen : null,
        onClose: typeof def.onClose === 'function' ? def.onClose : null,
        onRouteChange: typeof def.onRouteChange === 'function' ? def.onRouteChange : null,
      });
    }

    function getTool(id) {
      return tools.get(id) || null;
    }

    function listTools() {
      return Array.from(tools.values()).sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
    }

    function getActiveToolId() {
      return activeToolId;
    }

    /**
     * @param {{ showLauncher?: boolean }} [opts]
     */
    function closeActiveTool(opts) {
      if (!activeToolId) return;
      const showLauncher = !opts || opts.showLauncher !== false;
      const def = tools.get(activeToolId);
      const ctx = makeCtx();
      try {
        if (typeof activeDispose === 'function') activeDispose();
      } catch (e) {
        console.warn('[S2A] dispose error', e);
      }
      activeDispose = null;
      try {
        if (def?.onClose) def.onClose(ctx);
      } catch (e) {
        console.warn('[S2A] onClose error', e);
      }
      activeToolId = null;
      if (showLauncher && S2A.shell && typeof S2A.shell.showLauncher === 'function') {
        S2A.shell.showLauncher();
      }
    }

    function openTool(id) {
      const def = tools.get(id);
      if (!def) {
        console.warn('[S2A] unknown tool', id);
        return;
      }
      if (activeToolId === id) {
        // already open: ensure shell visible
        if (S2A.shell && typeof S2A.shell.openShell === 'function') S2A.shell.openShell();
        return;
      }
      if (activeToolId) {
        closeActiveTool({ showLauncher: false });
      }
      const ctx = makeCtx();
      activeToolId = id;
      if (S2A.shell && typeof S2A.shell.mountTool === 'function') {
        const hostEl = S2A.shell.mountTool(def);
        if (def.onOpen) {
          try {
            const dispose = def.onOpen(ctx, hostEl);
            if (typeof dispose === 'function') activeDispose = dispose;
          } catch (e) {
            console.error('[S2A] onOpen error', e);
          }
        }
      }
    }

    function dispatchInits() {
      const ctx = makeCtx();
      for (const def of listTools()) {
        if (def.match && !def.match(ctx)) continue;
        if (def.onInit) {
          try {
            def.onInit(ctx);
          } catch (e) {
            console.warn('[S2A] onInit error', def.id, e);
          }
        }
      }
    }

    function dispatchRouteChange() {
      const ctx = makeCtx();
      for (const def of listTools()) {
        if (def.onRouteChange) {
          try {
            def.onRouteChange(ctx);
          } catch (e) {
            console.warn('[S2A] onRouteChange error', def.id, e);
          }
        }
      }
      // re-init match tools (bar inject etc.)
      for (const def of listTools()) {
        if (def.match && !def.match(ctx)) continue;
        if (def.onInit) {
          try {
            def.onInit(ctx);
          } catch (_) {}
        }
      }
    }

    S2A.registerTool = registerTool;
    S2A.getTool = getTool;
    S2A.listTools = listTools;
    S2A.openTool = openTool;
    S2A.closeActiveTool = closeActiveTool;
    S2A.getActiveToolId = getActiveToolId;
    S2A.registry = {
      registerTool,
      getTool,
      listTools,
      openTool,
      closeActiveTool,
      getActiveToolId,
      makeCtx,
      dispatchInits,
      dispatchRouteChange,
    };
  })(S2A);



/* ==== src/core/ui-shell.js ==== */
  // --- S2A.shell ---
  (function (S2A) {
    const { $, $$, esc } = S2A.util;
    const SHELL_ID = 's2a-shell-panel';
    const FAB_ID = 's2a-shell-fab';
    const STYLE_ID = 's2a-shell-style';
    const HOST_ID = 's2a-shell-host';
    const LIST_ID = 's2a-shell-list';

    let lastPath = location.pathname;
    let mo = null;
    let intervalId = null;

    function injectStyles() {
      if (document.getElementById(STYLE_ID)) return;
      const css = `
#${FAB_ID} {
  position: fixed; right: 16px; bottom: 16px; z-index: 2147483645;
  border: 0; border-radius: 999px; padding: 10px 14px; cursor: pointer;
  background: #0891b2; color: #fff; font-weight: 700; font-size: 12px;
  box-shadow: 0 8px 24px rgba(8,145,178,.45);
}
#${SHELL_ID} {
  position: fixed;
  right: 16px;
  bottom: 16px;
  z-index: 2147483646;
  width: 520px;
  max-width: calc(100vw - 24px);
  max-height: calc(100vh - 32px);
  display: flex;
  flex-direction: column;
  background: #0f172a;
  color: #e2e8f0;
  border: 1px solid #334155;
  border-radius: 12px;
  box-shadow: 0 12px 40px rgba(0,0,0,.45);
  font: 12px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  overflow: hidden;
}
#${SHELL_ID}.s2a-collapsed { width: 240px; max-height: none; }
#${SHELL_ID}.s2a-collapsed .s2a-body { display: none; }
#${SHELL_ID} .s2a-hd {
  display: flex; align-items: center; justify-content: space-between;
  gap: 8px; padding: 10px 12px; background: #1e293b; cursor: move; user-select: none;
}
#${SHELL_ID} .s2a-hd h3 { margin: 0; font-size: 13px; font-weight: 700; color: #f8fafc; }
#${SHELL_ID} .s2a-hd .s2a-sub { color: #94a3b8; font-size: 11px; }
#${SHELL_ID} .s2a-hd-actions { display: flex; gap: 6px; }
#${SHELL_ID} .s2a-hd-actions button {
  border: 0; background: #334155; color: #e2e8f0; border-radius: 6px;
  padding: 4px 8px; cursor: pointer; font-size: 11px;
}
#${SHELL_ID} .s2a-hd-actions button:hover { background: #475569; }
#${SHELL_ID} .s2a-body { padding: 10px 12px 12px; overflow: auto; min-height: 0; flex: 1; }
#${SHELL_ID} .s2a-tool-item {
  display: block; width: 100%; text-align: left;
  border: 1px solid #1f2937; background: #111827; color: #e2e8f0;
  border-radius: 8px; padding: 10px 12px; margin-bottom: 8px; cursor: pointer;
}
#${SHELL_ID} .s2a-tool-item:hover { border-color: #0891b2; background: #0f172a; }
#${SHELL_ID} .s2a-tool-item b { display: block; font-size: 13px; margin-bottom: 4px; }
#${SHELL_ID} .s2a-tool-item span { color: #94a3b8; font-size: 11px; }
#${SHELL_ID} .s2a-row { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 8px; align-items: center; }
#${SHELL_ID} label.s2a-lbl { display: inline-flex; align-items: center; gap: 4px; color: #cbd5e1; }
#${SHELL_ID} input[type="number"],
#${SHELL_ID} input[type="text"],
#${SHELL_ID} textarea {
  background: #111827; color: #e5e7eb; border: 1px solid #374151;
  border-radius: 6px; padding: 5px 8px; font-size: 12px;
}
#${SHELL_ID} input[type="number"] { width: 70px; }
#${SHELL_ID} input[type="text"] { width: 160px; }
#${SHELL_ID} textarea {
  width: 100%; min-height: 54px; resize: vertical; font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
}
#${SHELL_ID} .s2a-btn {
  border: 0; border-radius: 7px; padding: 6px 10px; cursor: pointer;
  font-size: 12px; font-weight: 600; color: #fff;
}
#${SHELL_ID} .s2a-btn:disabled { opacity: .55; cursor: not-allowed; }
#${SHELL_ID} .s2a-btn-primary { background: #0891b2; }
#${SHELL_ID} .s2a-btn-primary:hover:not(:disabled) { background: #0e7490; }
#${SHELL_ID} .s2a-btn-secondary { background: #475569; }
#${SHELL_ID} .s2a-btn-danger { background: #b91c1c; }
#${SHELL_ID} .s2a-btn-ok { background: #15803d; }
#${SHELL_ID} .s2a-stats {
  display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; margin: 8px 0;
}
#${SHELL_ID} .s2a-stat {
  background: #111827; border: 1px solid #1f2937; border-radius: 8px; padding: 6px 8px;
}
#${SHELL_ID} .s2a-stat b { display: block; font-size: 16px; color: #f8fafc; }
#${SHELL_ID} .s2a-stat span { color: #94a3b8; font-size: 11px; }
#${SHELL_ID} .s2a-progress {
  height: 6px; background: #1f2937; border-radius: 999px; overflow: hidden; margin: 6px 0 10px;
}
#${SHELL_ID} .s2a-progress > i {
  display: block; height: 100%; width: 0; background: linear-gradient(90deg, #06b6d4, #22c55e);
  transition: width .2s ease;
}
#${SHELL_ID} .s2a-table-wrap {
  max-height: 280px; overflow: auto; border: 1px solid #1f2937; border-radius: 8px;
}
#${SHELL_ID} table { width: 100%; border-collapse: collapse; font-size: 11px; }
#${SHELL_ID} th, #${SHELL_ID} td {
  padding: 6px 8px; border-bottom: 1px solid #1f2937; text-align: left; vertical-align: top;
}
#${SHELL_ID} th {
  position: sticky; top: 0; background: #1e293b; color: #cbd5e1; z-index: 1;
}
#${SHELL_ID} tr.ok td { background: rgba(22, 163, 74, .08); }
#${SHELL_ID} tr.err td { background: rgba(220, 38, 38, .1); }
#${SHELL_ID} tr.run td { background: rgba(8, 145, 178, .1); }
#${SHELL_ID} .s2a-muted { color: #94a3b8; }
#${SHELL_ID} .s2a-tag {
  display: inline-block; padding: 1px 6px; border-radius: 999px; font-size: 10px; font-weight: 700;
}
#${SHELL_ID} .s2a-tag.ok { background: #14532d; color: #bbf7d0; }
#${SHELL_ID} .s2a-tag.warn { background: #713f12; color: #fde68a; }
#${SHELL_ID} .s2a-tag.bad { background: #7f1d1d; color: #fecaca; }
#${SHELL_ID} .s2a-tag.run { background: #164e63; color: #a5f3fc; }
#${SHELL_ID} .s2a-log {
  margin-top: 8px; max-height: 90px; overflow: auto; background: #020617;
  border: 1px solid #1f2937; border-radius: 8px; padding: 6px 8px;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace; color: #94a3b8; white-space: pre-wrap;
}
.s2a-bar-btn { margin-left: 6px; }
`;
      if (typeof GM_addStyle === 'function') GM_addStyle(css);
      else {
        const st = document.createElement('style');
        st.id = STYLE_ID;
        st.textContent = css;
        document.head.appendChild(st);
      }
    }

    function makeDraggable(panel, handle) {
      if (!handle) return;
      let sx = 0,
        sy = 0,
        ox = 0,
        oy = 0,
        dragging = false;
      handle.addEventListener('mousedown', (e) => {
        if (e.target.closest('button')) return;
        dragging = true;
        sx = e.clientX;
        sy = e.clientY;
        const rect = panel.getBoundingClientRect();
        ox = rect.left;
        oy = rect.top;
        panel.style.right = 'auto';
        panel.style.bottom = 'auto';
        panel.style.left = ox + 'px';
        panel.style.top = oy + 'px';
        e.preventDefault();
      });
      window.addEventListener('mousemove', (e) => {
        if (!dragging) return;
        panel.style.left = ox + (e.clientX - sx) + 'px';
        panel.style.top = oy + (e.clientY - sy) + 'px';
      });
      window.addEventListener('mouseup', () => {
        dragging = false;
      });
    }

    function ensureFab() {
      if (document.getElementById(FAB_ID) || document.getElementById(SHELL_ID)) return;
      const btn = document.createElement('button');
      btn.id = FAB_ID;
      btn.type = 'button';
      btn.textContent = 'Sub2API 工具';
      btn.onclick = () => openShell();
      document.body.appendChild(btn);
    }

    function removeFab() {
      const fab = document.getElementById(FAB_ID);
      if (fab) fab.remove();
    }

    function setHeader(title, sub, showBack) {
      const panel = document.getElementById(SHELL_ID);
      if (!panel) return;
      const h3 = panel.querySelector('.s2a-hd h3');
      const subEl = panel.querySelector('.s2a-hd .s2a-sub');
      if (h3) h3.textContent = title || 'Sub2API 工具';
      if (subEl) subEl.textContent = sub || `v${S2A.version || ''}`;
      const backBtn = panel.querySelector('[data-act="back"]');
      if (backBtn) backBtn.style.display = showBack ? '' : 'none';
    }

    function renderLauncherList() {
      const list = document.getElementById(LIST_ID);
      if (!list) return;
      const tools = S2A.listTools();
      if (!tools.length) {
        list.innerHTML = '<div class="s2a-muted">暂无已注册工具</div>';
        return;
      }
      list.innerHTML = tools
        .map(
          (t) => `
        <button type="button" class="s2a-tool-item" data-tool-id="${esc(t.id)}">
          <b>${esc(t.name)}</b>
          <span>${esc(t.description || '')}</span>
        </button>`
        )
        .join('');
      list.querySelectorAll('[data-tool-id]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const id = btn.getAttribute('data-tool-id');
          S2A.openTool(id);
        });
      });
    }

    function showLauncher() {
      const host = document.getElementById(HOST_ID);
      const list = document.getElementById(LIST_ID);
      if (host) {
        host.innerHTML = '';
        host.style.display = 'none';
      }
      if (list) list.style.display = '';
      setHeader('Sub2API 工具', `v${S2A.version || ''} · 选择工具`, false);
      renderLauncherList();
    }

    /**
     * @param {{ id: string, name: string, description?: string }} def
     * @returns {HTMLElement}
     */
    function mountTool(def) {
      ensureShell();
      const host = document.getElementById(HOST_ID);
      const list = document.getElementById(LIST_ID);
      if (list) list.style.display = 'none';
      if (host) {
        host.innerHTML = '';
        host.style.display = '';
        host.id = HOST_ID;
        host.setAttribute('data-tool', def.id);
        // tool-scoped class for CSS
        host.className = `s2a-tool-host s2a-tool-${def.id}`;
      }
      setHeader(def.name, def.description || def.id, true);
      const panel = document.getElementById(SHELL_ID);
      if (panel) {
        panel.style.display = 'flex';
        panel.classList.remove('s2a-collapsed');
      }
      removeFab();
      return host;
    }

    function ensureShell() {
      injectStyles();
      if (document.getElementById(SHELL_ID)) return document.getElementById(SHELL_ID);

      const panel = document.createElement('div');
      panel.id = SHELL_ID;
      panel.innerHTML = `
      <div class="s2a-hd" data-drag="1">
        <div>
          <h3>Sub2API 工具</h3>
          <div class="s2a-sub">v${esc(S2A.version || '')}</div>
        </div>
        <div class="s2a-hd-actions">
          <button type="button" data-act="back" title="返回列表" style="display:none">←</button>
          <button type="button" data-act="collapse" title="折叠">–</button>
          <button type="button" data-act="close" title="关闭">×</button>
        </div>
      </div>
      <div class="s2a-body">
        <div id="${LIST_ID}"></div>
        <div id="${HOST_ID}" style="display:none"></div>
      </div>
    `;
      document.body.appendChild(panel);
      makeDraggable(panel, panel.querySelector('[data-drag]'));

      panel.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-act]');
        if (!btn || !panel.contains(btn)) return;
        const act = btn.getAttribute('data-act');
        if (act === 'close') {
          closeShell();
          return;
        }
        if (act === 'collapse') {
          panel.classList.toggle('s2a-collapsed');
          return;
        }
        if (act === 'back') {
          if (S2A.getActiveToolId()) S2A.closeActiveTool();
          else showLauncher();
        }
      });

      showLauncher();
      return panel;
    }

    function openShell() {
      removeFab();
      const panel = ensureShell();
      panel.style.display = 'flex';
      panel.classList.remove('s2a-collapsed');
      if (!S2A.getActiveToolId()) showLauncher();
    }

    function closeShell() {
      if (typeof S2A.closeActiveTool === 'function' && S2A.getActiveToolId()) {
        try {
          S2A.closeActiveTool({ showLauncher: false });
        } catch (_) {}
      }
      const panel = document.getElementById(SHELL_ID);
      if (panel) panel.remove();
      ensureFab();
    }

    function toggleShell() {
      if (document.getElementById(SHELL_ID)) closeShell();
      else openShell();
    }

    /**
     * Inject toolbar buttons near native accounts toolbar.
     * @param {string} id
     * @param {string} label
     * @param {() => void} onClick
     * @param {string} [classHint]
     */
    function injectBarButton(id, label, onClick, classHint) {
      if (document.getElementById(id)) return true;
      const anchors = $$('button').filter((b) => {
        const t = (b.textContent || '').trim();
        return /添加账号|更多操作|自动刷新|批量删除|批量编辑/.test(t);
      });
      const host = anchors[0]?.parentElement;
      if (!host) return false;
      const btn = document.createElement('button');
      btn.id = id;
      btn.type = 'button';
      btn.className = (classHint || anchors[0].className || '') + ' s2a-bar-btn';
      btn.textContent = label;
      btn.style.marginLeft = '6px';
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        onClick();
      });
      host.appendChild(btn);
      return true;
    }

    function injectToolBarActions() {
      const ctx = S2A.registry.makeCtx();
      for (const def of S2A.listTools()) {
        if (def.match && !def.match(ctx)) continue;
        if (!def.barActions) continue;
        let actions = [];
        try {
          actions = def.barActions(ctx) || [];
        } catch (_) {
          continue;
        }
        for (const act of actions) {
          if (!act || !act.id || !act.label) continue;
          const btnId = `s2a-bar-${def.id}-${act.id}`;
          injectBarButton(btnId, act.label, () => {
            try {
              act.onClick(S2A.registry.makeCtx());
            } catch (e) {
              console.error(e);
            }
          });
        }
      }
    }

    function onRouteMaybeChanged() {
      if (location.pathname !== lastPath) {
        lastPath = location.pathname;
        S2A.registry.dispatchRouteChange();
      }
      injectToolBarActions();
    }

    function init() {
      injectStyles();
      ensureFab();
      injectToolBarActions();

      if (mo) mo.disconnect();
      mo = new MutationObserver(() => {
        ensureFab();
        onRouteMaybeChanged();
      });
      mo.observe(document.documentElement, { childList: true, subtree: true });

      if (intervalId) clearInterval(intervalId);
      intervalId = setInterval(() => {
        onRouteMaybeChanged();
        if (!document.getElementById(SHELL_ID)) ensureFab();
      }, 2000);

      window.addEventListener('keydown', (e) => {
        if (e.altKey && (e.key === 'q' || e.key === 'Q')) {
          e.preventDefault();
          toggleShell();
        }
      });
    }

    S2A.shell = {
      init,
      injectStyles,
      ensureFab,
      openShell,
      closeShell,
      toggleShell,
      showLauncher,
      mountTool,
      injectBarButton,
      injectToolBarActions,
      SHELL_ID,
      FAB_ID,
      HOST_ID,
    };
  })(S2A);



/* ==== src/tools/grok-quota/export.js ==== */
  // --- Grok quota export ---
  (function (S2A) {
    const G = (S2A.tools['grok-quota'] = S2A.tools['grok-quota'] || {});

    function exportCsv(results, log) {
      const rows = Array.from(results.values());
      if (!rows.length) {
        alert('没有可导出的结果');
        return;
      }
      const header = [
        'id',
        'name',
        'state',
        'is403',
        'deleted',
        'requests',
        'tokens',
        'billing',
        'exhausted',
        'note',
        'error',
      ];
      const lines = [header.join(',')];
      for (const r of rows) {
        const cols = [
          r.id,
          r.name,
          r.state,
          r.is403 ? '1' : '0',
          r.deleted || r.state === 'del' ? '1' : '0',
          r.reqText,
          r.tokText,
          r.billingText,
          r.exhausted ? '1' : '0',
          r.note,
          r.error,
        ].map((v) => {
          const s = String(v ?? '');
          return /["\n,]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
        });
        lines.push(cols.join(','));
      }
      const blob = new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
      S2A.util.downloadBlob(
        blob,
        `grok-quota-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.csv`
      );
      if (log) log(`已导出 CSV ${rows.length} 行`);
    }

    async function copySummary(results, log) {
      const rows = Array.from(results.values());
      const ok = rows.filter((r) => r.state === 'ok');
      const err = rows.filter((r) => r.state === 'err' || r.state === 'del' || r.state === 'del_fail');
      const fail403 = rows.filter((r) => r.is403);
      const deleted = rows.filter((r) => r.state === 'del');
      const exhausted = ok.filter((r) => r.exhausted);
      const lines = [
        `Grok 额度探测摘要 ${new Date().toLocaleString()}`,
        `总数 ${rows.length} · 成功 ${ok.length} · 失败 ${err.length} · 403 ${fail403.length} · 已删 ${deleted.length} · 耗尽 ${exhausted.length}`,
        '',
        ...ok.map((r) => `#${r.id} ${r.name || ''}  req ${r.reqText}  tok ${r.tokText}  ${r.billingText}`),
      ];
      if (err.length) {
        lines.push('', '失败/403:');
        err.forEach((r) => lines.push(`#${r.id} [${r.state}${r.is403 ? '/403' : ''}] ${r.error || r.note}`));
      }
      const text = lines.join('\n');
      try {
        await navigator.clipboard.writeText(text);
        if (log) log('摘要已复制到剪贴板');
      } catch (_) {
        prompt('复制以下内容：', text);
      }
    }

    G.exportCsv = exportCsv;
    G.copySummary = copySummary;
  })(S2A);



/* ==== src/tools/grok-quota/probe.js ==== */
  // --- Grok quota probe ---
  (function (S2A) {
    const G = (S2A.tools['grok-quota'] = S2A.tools['grok-quota'] || {});
    const { formatNum, sleep } = S2A.util;

    function extractProbeErrorText(data, fallback = '') {
      if (data == null) return fallback;
      if (typeof data === 'string') return data;
      const parts = [data.probe_error, data.error, data.message, data.msg, data.detail, data.reason]
        .filter((x) => x != null && String(x).trim())
        .map((x) =>
          typeof x === 'string'
            ? x
            : (() => {
                try {
                  return JSON.stringify(x);
                } catch {
                  return String(x);
                }
              })()
        );
      return parts[0] || fallback;
    }

    /**
     * 判定探测失败：上游 403 / forbidden / GROK_QUOTA_PROBE_UPSTREAM_ERROR 等。
     */
    function classifyProbeFailure(data, httpErr) {
      if (httpErr) {
        const status = Number(httpErr.status || 0);
        const msg = httpErr.message || String(httpErr);
        const is403 =
          status === 403 ||
          /\b403\b/.test(msg) ||
          /GROK_QUOTA_PROBE_UPSTREAM_ERROR/i.test(msg) ||
          /upstream returned 403/i.test(msg) ||
          /\bforbidden\b/i.test(msg);
        return {
          failed: true,
          is403,
          statusCode: status || (is403 ? 403 : 0),
          message: msg,
        };
      }

      const snap = data?.snapshot || {};
      const statusCode = Number(data?.status_code ?? snap.status_code ?? data?.billing?.status_code ?? 0);
      const errText = extractProbeErrorText(data, '');
      const blob = [
        errText,
        data?.reason,
        data?.error_code,
        data?.code,
        data?.probe_error,
        data?.entitlement_status,
        snap.entitlement_status,
      ]
        .filter((x) => x != null)
        .map(String)
        .join(' ');

      const is403 =
        statusCode === 403 ||
        data?.is_forbidden === true ||
        /\b403\b/.test(blob) ||
        /GROK_QUOTA_PROBE_UPSTREAM_ERROR/i.test(blob) ||
        /upstream returned 403/i.test(blob) ||
        (/\bforbidden\b/i.test(blob) && /probe|upstream|quota/i.test(blob));

      const hasProbeError = !!(data?.probe_error || (data?.error && String(data.error).trim()));
      const badStatus = statusCode > 0 && (statusCode < 200 || statusCode >= 300);

      if (is403 || hasProbeError || badStatus) {
        return {
          failed: true,
          is403: is403 || statusCode === 403,
          statusCode: statusCode || (is403 ? 403 : 0),
          message: errText || (is403 ? 'upstream 403' : `status ${statusCode || 'error'}`),
        };
      }

      return { failed: false, is403: false, statusCode, message: '' };
    }

    function summarizeQuota(data) {
      const snap = data?.snapshot || {};
      const req = snap.requests || {};
      const tok = snap.tokens || {};
      const billing = data?.billing || {};
      const local24h = data?.local_usage_24h || {};
      const fail = classifyProbeFailure(data, null);

      const reqText = req.limit != null && req.remaining != null ? `${req.remaining}/${req.limit}` : '—';
      const tokText =
        tok.limit != null && tok.remaining != null
          ? `${formatNum(tok.remaining)}/${formatNum(tok.limit)}`
          : '—';

      let billingText = '—';
      if (billing.period_type) {
        const used = billing.used_cents != null ? (Number(billing.used_cents) / 100).toFixed(2) : '?';
        const limit =
          billing.monthly_limit_cents != null && Number(billing.monthly_limit_cents) > 0
            ? (Number(billing.monthly_limit_cents) / 100).toFixed(2)
            : '∞';
        billingText = `${billing.period_type} $${used}/$${limit}`;
      }

      const exhausted =
        (req.remaining != null && Number(req.remaining) <= 0) ||
        (tok.remaining != null && Number(tok.remaining) <= 0);

      const note = fail.failed ? fail.message : data?.probe_error || '';

      return {
        ok: !fail.failed,
        is403: fail.is403,
        model: data?.model || '',
        source: data?.source || '',
        reqText,
        tokText,
        billingText,
        exhausted,
        reqRemaining: req.remaining,
        reqLimit: req.limit,
        tokRemaining: tok.remaining,
        tokLimit: tok.limit,
        statusCode: fail.statusCode || data?.status_code || snap.status_code,
        headersObserved: !!(data?.headers_observed || snap.headers_observed),
        local24h,
        raw: data,
        note,
        error: fail.failed ? fail.message : '',
      };
    }

    async function queryGrokQuota(accountId, timezone) {
      const tz = encodeURIComponent(timezone || 'Asia/Shanghai');
      const path = `/admin/grok/accounts/${encodeURIComponent(accountId)}/quota?timezone=${tz}`;
      return S2A.api.apiRequest(path);
    }

    async function maybeDeleteOn403(id, row, cfg, log) {
      if (!cfg.autoDeleteOn403 || !row?.is403) return;
      try {
        await S2A.api.deleteAccount(id);
        row.state = 'del';
        row.deleted = true;
        row.note = `已删除 · ${row.error || row.note || '403'}`;
        if (log) log(`#${id} 403 → 已删除`);
      } catch (delErr) {
        row.state = 'del_fail';
        row.deleted = false;
        const msg = delErr.message || String(delErr);
        row.note = `403 且删除失败: ${msg}`;
        row.error = row.note;
        if (log) log(`#${id} 403 删除失败: ${msg}`);
      }
    }

    /**
     * Concurrent probe workers.
     * @returns {{ stop: () => void, done: Promise<void> }}
     */
    function startProbe(opts) {
      const {
        ids,
        accountMeta,
        results,
        cfg,
        log,
        onUpdate,
        getAbort,
      } = opts;

      let cursor = 0;
      const workers = Array.from({ length: cfg.concurrency }, async () => {
        while (!getAbort()) {
          const i = cursor++;
          if (i >= ids.length) break;
          const id = ids[i];
          const row = results.get(id);
          if (!row) continue;
          row.state = 'run';
          if (onUpdate) onUpdate();

          try {
            if (cfg.delayMs > 0) await sleep(cfg.delayMs);
            const data = await queryGrokQuota(id, cfg.timezone);
            const sum = summarizeQuota(data);
            Object.assign(row, sum, {
              name: row.name || accountMeta.get(id)?.name || '',
            });

            if (!sum.ok) {
              row.state = 'err';
              row.error = sum.error || sum.note || '探测失败';
              row.note = row.error;
              if (log) log(`#${id} FAIL${sum.is403 ? ' 403' : ''} ${row.error}`);
              if (sum.is403) await maybeDeleteOn403(id, row, cfg, log);
            } else {
              row.state = 'ok';
              row.note = sum.note || (sum.headersObserved ? sum.model || sum.source : '无 header 观察');
              if (log) log(`#${id} OK  req ${sum.reqText}  tok ${sum.tokText}`);
            }
          } catch (err) {
            const fail = classifyProbeFailure(null, err);
            row.state = 'err';
            row.is403 = fail.is403;
            row.statusCode = fail.statusCode;
            row.error = fail.message || err.message || String(err);
            row.note = row.error;
            if (log) log(`#${id} FAIL${fail.is403 ? ' 403' : ''} ${row.error}`);
            if (fail.is403) await maybeDeleteOn403(id, row, cfg, log);
          }
          if (onUpdate) onUpdate();
        }
      });

      return {
        done: Promise.all(workers).then(() => {}),
      };
    }

    G.classifyProbeFailure = classifyProbeFailure;
    G.summarizeQuota = summarizeQuota;
    G.queryGrokQuota = queryGrokQuota;
    G.maybeDeleteOn403 = maybeDeleteOn403;
    G.startProbe = startProbe;
    G.extractProbeErrorText = extractProbeErrorText;
  })(S2A);



/* ==== src/tools/grok-quota/panel.js ==== */
  // --- Grok quota panel ---
  (function (S2A) {
    const G = (S2A.tools['grok-quota'] = S2A.tools['grok-quota'] || {});
    const { $, esc, parseIdsText } = S2A.util;

    const DEFAULT_CFG = {
      concurrency: 3,
      delayMs: 200,
      timezone: 'Asia/Shanghai',
      onlyGrok: true,
      autoInjectBar: true,
      autoDeleteOn403: false,
      confirmDeleteOn403: true,
    };

    const TOOL_ID = 'grok-quota';
    const PREFIX = 's2a-tool-grok-quota';

    function loadCfg() {
      return S2A.storage.getToolCfg(TOOL_ID, DEFAULT_CFG);
    }

    function saveCfg(cfg) {
      S2A.storage.setToolCfg(TOOL_ID, cfg);
    }

    /**
     * Create panel state and mount UI into hostEl.
     * @returns {{ dispose: () => void, fillIds: Function, log: Function, startProbe: Function, getRunning: () => boolean }}
     */
    function mount(hostEl) {
      let cfg = loadCfg();
      let running = false;
      let abortFlag = false;
      /** @type {Map<string, any>} */
      const results = new Map();
      /** @type {Map<string, any>} */
      let accountMeta = new Map();

      const root = document.createElement('div');
      root.id = `${PREFIX}-root`;
      root.innerHTML = `
        <div class="s2a-row">
          <button type="button" class="s2a-btn s2a-btn-secondary" data-act="read-selected">读取勾选</button>
          <button type="button" class="s2a-btn s2a-btn-secondary" data-act="read-page">读取本页</button>
          <button type="button" class="s2a-btn s2a-btn-danger" data-act="read-forbidden" title="扫描当前页「用量窗口」列为 forbidden / validation / violation 的账号">读取本页 forbidden</button>
          <button type="button" class="s2a-btn s2a-btn-secondary" data-act="read-all-pages">拉取全部(API)</button>
          <span class="s2a-muted" id="${PREFIX}-sel-info">未选择</span>
        </div>
        <div class="s2a-row">
          <label class="s2a-lbl"><input type="checkbox" id="${PREFIX}-include-validation" checked> 含 validation</label>
          <label class="s2a-lbl"><input type="checkbox" id="${PREFIX}-include-violation" checked> 含 violation</label>
          <label class="s2a-lbl"><input type="checkbox" id="${PREFIX}-auto-probe-forbidden"> 读取后自动探测</label>
          <span class="s2a-muted">匹配用量窗口红/黄标签：forbidden</span>
        </div>
        <div class="s2a-row">
          <label class="s2a-lbl">并发 <input type="number" id="${PREFIX}-concurrency" min="1" max="20" value="${esc(cfg.concurrency)}"></label>
          <label class="s2a-lbl">间隔ms <input type="number" id="${PREFIX}-delay" min="0" max="10000" value="${esc(cfg.delayMs)}"></label>
          <label class="s2a-lbl">时区 <input type="text" id="${PREFIX}-tz" value="${esc(cfg.timezone)}"></label>
          <label class="s2a-lbl"><input type="checkbox" id="${PREFIX}-only-grok" ${cfg.onlyGrok ? 'checked' : ''}> 仅 Grok</label>
        </div>
        <div class="s2a-row">
          <label class="s2a-lbl" title="探测结果含 upstream 403 / GROK_QUOTA_PROBE_UPSTREAM_ERROR 时计为失败，并调用 DELETE /admin/accounts/{id}">
            <input type="checkbox" id="${PREFIX}-auto-delete-403" ${cfg.autoDeleteOn403 ? 'checked' : ''}>
            403 自动删除
          </label>
          <label class="s2a-lbl" title="开启自动删除时，开始探测前再确认一次">
            <input type="checkbox" id="${PREFIX}-confirm-delete-403" ${cfg.confirmDeleteOn403 !== false ? 'checked' : ''}>
            删除前确认
          </label>
          <span class="s2a-muted">上游 403（forbidden 探测失败）不算成功</span>
        </div>
        <textarea id="${PREFIX}-ids" placeholder="账号 ID，每行一个，或逗号/空格分隔。也可先点「读取勾选」。&#10;示例：&#10;7752&#10;7753,7754"></textarea>
        <div class="s2a-row" style="margin-top:8px">
          <button type="button" class="s2a-btn s2a-btn-primary" data-act="start">开始探测</button>
          <button type="button" class="s2a-btn s2a-btn-danger" data-act="stop" disabled>停止</button>
          <button type="button" class="s2a-btn s2a-btn-secondary" data-act="export">导出 CSV</button>
          <button type="button" class="s2a-btn s2a-btn-ok" data-act="copy-summary">复制摘要</button>
        </div>
        <div class="s2a-stats" style="grid-template-columns: repeat(5, 1fr)">
          <div class="s2a-stat"><b id="${PREFIX}-st-total">0</b><span>总数</span></div>
          <div class="s2a-stat"><b id="${PREFIX}-st-done">0</b><span>完成</span></div>
          <div class="s2a-stat"><b id="${PREFIX}-st-ok">0</b><span>成功</span></div>
          <div class="s2a-stat"><b id="${PREFIX}-st-err">0</b><span>失败</span></div>
          <div class="s2a-stat"><b id="${PREFIX}-st-del">0</b><span>已删</span></div>
        </div>
        <div class="s2a-progress"><i id="${PREFIX}-progress-bar"></i></div>
        <div class="s2a-table-wrap">
          <table>
            <thead>
              <tr>
                <th>ID</th>
                <th>名称</th>
                <th>状态</th>
                <th>请求</th>
                <th>Token</th>
                <th>计费</th>
                <th>备注</th>
              </tr>
            </thead>
            <tbody id="${PREFIX}-tbody"></tbody>
          </table>
        </div>
        <div class="s2a-log" id="${PREFIX}-log"></div>
      `;
      hostEl.appendChild(root);

      function log(msg) {
        const el = $(`#${PREFIX}-log`, root);
        if (!el) return;
        const ts = new Date().toLocaleTimeString();
        el.textContent = `[${ts}] ${msg}\n` + el.textContent;
      }

      function fillIds(items) {
        accountMeta = new Map();
        const ids = [];
        let forbiddenN = 0;
        for (const it of items) {
          const id = String(it.id || it).trim();
          if (!id) continue;
          ids.push(id);
          if (it.forbiddenType) forbiddenN += 1;
          accountMeta.set(id, {
            id,
            name: it.name || it.email || '',
            platform: it.platform || '',
            type: it.type || '',
            forbiddenType: it.forbiddenType || '',
            forbiddenText: it.forbiddenText || '',
          });
        }
        const ta = $(`#${PREFIX}-ids`, root);
        if (ta) ta.value = ids.join('\n');
        const info = $(`#${PREFIX}-sel-info`, root);
        if (info) {
          info.textContent = forbiddenN
            ? `已装载 ${ids.length} 个 ID（forbidden ${forbiddenN}）`
            : `已装载 ${ids.length} 个 ID`;
        }
      }

      function updateStats() {
        const all = Array.from(results.values());
        const total = all.length;
        const done = all.filter((x) => ['ok', 'err', 'del', 'del_fail'].includes(x.state)).length;
        const ok = all.filter((x) => x.state === 'ok').length;
        const err = all.filter((x) => x.state === 'err' || x.state === 'del_fail' || x.is403).length;
        const del = all.filter((x) => x.state === 'del').length;
        const set = (id, v) => {
          const el = document.getElementById(id);
          if (el) el.textContent = String(v);
        };
        set(`${PREFIX}-st-total`, total);
        set(`${PREFIX}-st-done`, done);
        set(`${PREFIX}-st-ok`, ok);
        set(`${PREFIX}-st-err`, err);
        set(`${PREFIX}-st-del`, del);
        const bar = document.getElementById(`${PREFIX}-progress-bar`);
        if (bar) bar.style.width = total ? `${Math.round((done / total) * 100)}%` : '0%';
      }

      function renderTable() {
        const tbody = document.getElementById(`${PREFIX}-tbody`);
        if (!tbody) return;
        const rank = { run: 0, err: 1, del_fail: 2, del: 3, ok: 4, wait: 5 };
        const rows = Array.from(results.values()).sort((a, b) => {
          const ao = rank[a.state] ?? 9;
          const bo = rank[b.state] ?? 9;
          if (ao !== bo) return ao - bo;
          return String(a.id).localeCompare(String(b.id), undefined, { numeric: true });
        });

        tbody.innerHTML = rows
          .map((r) => {
            let tag;
            if (r.state === 'ok') {
              tag = `<span class="s2a-tag ok">${r.exhausted ? '耗尽' : 'OK'}</span>`;
            } else if (r.state === 'del') {
              tag = `<span class="s2a-tag bad">已删</span>`;
            } else if (r.state === 'del_fail') {
              tag = `<span class="s2a-tag bad">删失败</span>`;
            } else if (r.state === 'err') {
              tag = `<span class="s2a-tag bad">${r.is403 ? '403' : '失败'}</span>`;
            } else if (r.state === 'run') {
              tag = `<span class="s2a-tag run">探测中</span>`;
            } else {
              tag = `<span class="s2a-tag warn">等待</span>`;
            }
            return `<tr class="${esc(r.state === 'del' || r.state === 'del_fail' ? 'err' : r.state)}">
        <td>${esc(r.id)}</td>
        <td>${esc(r.name || '—')}</td>
        <td>${tag}</td>
        <td>${esc(r.reqText || '—')}</td>
        <td>${esc(r.tokText || '—')}</td>
        <td>${esc(r.billingText || '—')}</td>
        <td class="s2a-muted">${esc(r.note || r.error || '')}</td>
      </tr>`;
          })
          .join('');
      }

      function readPanelCfg() {
        const concurrency = Math.max(
          1,
          Math.min(20, Number($(`#${PREFIX}-concurrency`, root)?.value || cfg.concurrency) || 3)
        );
        const delayMs = Math.max(
          0,
          Math.min(10000, Number($(`#${PREFIX}-delay`, root)?.value || cfg.delayMs) || 0)
        );
        const timezone = ($(`#${PREFIX}-tz`, root)?.value || cfg.timezone || 'Asia/Shanghai').trim();
        const onlyGrok = $(`#${PREFIX}-only-grok`, root)?.checked !== false;
        const autoDeleteOn403 = $(`#${PREFIX}-auto-delete-403`, root)?.checked === true;
        const confirmDeleteOn403 = $(`#${PREFIX}-confirm-delete-403`, root)?.checked !== false;
        cfg = { ...cfg, concurrency, delayMs, timezone, onlyGrok, autoDeleteOn403, confirmDeleteOn403 };
        saveCfg(cfg);
        return cfg;
      }

      function onlyGrokChecked() {
        return $(`#${PREFIX}-only-grok`, root)?.checked !== false;
      }

      function collectOpts() {
        return {
          onlyGrok: onlyGrokChecked(),
          includeValidation: $(`#${PREFIX}-include-validation`, root)?.checked !== false,
          includeViolation: $(`#${PREFIX}-include-violation`, root)?.checked !== false,
          panelRoot: root,
        };
      }

      async function doStartProbe() {
        if (running) return;
        readPanelCfg();

        let ids = parseIdsText($(`#${PREFIX}-ids`, root)?.value || '');
        if (!ids.length) {
          const selected = S2A.domAccounts.collectSelectedFromDom(collectOpts());
          if (selected.length) {
            fillIds(selected);
            ids = selected.map((x) => x.id);
          }
        }
        if (!ids.length) {
          alert('请先勾选账号，或手动填入账号 ID');
          return;
        }

        if (cfg.autoDeleteOn403) {
          const tip = `已开启「403 自动删除」：探测到上游 403 / forbidden 时将调用删除接口。\n\n本次将探测 ${ids.length} 个账号。\n是否继续？`;
          if (cfg.confirmDeleteOn403 && !confirm(tip)) {
            log('已取消探测（403 自动删除确认）');
            return;
          }
        }

        running = true;
        abortFlag = false;
        results.clear();
        for (const id of ids) {
          const meta = accountMeta.get(id) || {};
          results.set(id, {
            id,
            name: meta.name || '',
            state: 'wait',
            reqText: '',
            tokText: '',
            billingText: '',
            exhausted: false,
            note: meta.forbiddenType ? `UI:${meta.forbiddenType}` : '',
            error: '',
            forbiddenType: meta.forbiddenType || '',
            is403: false,
            deleted: false,
          });
        }
        updateStats();
        renderTable();

        const startBtn = root.querySelector('[data-act="start"]');
        const stopBtn = root.querySelector('[data-act="stop"]');
        if (startBtn) startBtn.disabled = true;
        if (stopBtn) stopBtn.disabled = false;

        log(
          `开始探测 ${ids.length} 个账号，并发=${cfg.concurrency}，间隔=${cfg.delayMs}ms` +
            (cfg.autoDeleteOn403 ? '，403 自动删除=ON' : '')
        );

        const job = G.startProbe({
          ids,
          accountMeta,
          results,
          cfg,
          log,
          onUpdate: () => {
            renderTable();
            updateStats();
          },
          getAbort: () => abortFlag,
        });

        await job.done;
        running = false;
        if (startBtn) startBtn.disabled = false;
        if (stopBtn) stopBtn.disabled = true;
        const deleted = Array.from(results.values()).filter((r) => r.state === 'del').length;
        const failed403 = Array.from(results.values()).filter((r) => r.is403).length;
        log(abortFlag ? '已停止' : `全部完成 · 403=${failed403} · 已删=${deleted}`);
      }

      function refreshSelectionCount() {
        try {
          const n = S2A.domAccounts.collectSelectedFromDom(collectOpts()).length;
          const info = $(`#${PREFIX}-sel-info`, root);
          if (info && !running) info.textContent = n ? `页面已勾选 ${n} 个` : '未选择（可点读取勾选）';
        } catch (_) {}
      }

      const onClick = async (e) => {
        const btn = e.target.closest('[data-act]');
        if (!btn || !root.contains(btn)) return;
        const act = btn.getAttribute('data-act');
        if (act === 'read-selected') {
          const items = S2A.domAccounts.collectSelectedFromDom(collectOpts());
          fillIds(items);
          log(`已读取勾选 ${items.length} 个账号`);
          return;
        }
        if (act === 'read-page') {
          const items = S2A.domAccounts.collectPageAccountsFromDom(collectOpts());
          fillIds(items);
          log(`已读取本页 ${items.length} 个账号`);
          return;
        }
        if (act === 'read-forbidden') {
          const items = S2A.domAccounts.collectForbiddenFromDom(collectOpts());
          fillIds(items);
          log(
            `本页 forbidden 账号：${items.length} 个` +
              (items.length ? ` → ${items.map((x) => x.id).join(',')}` : '')
          );
          if (!items.length) {
            alert('当前页未找到用量窗口为 forbidden 的账号');
            return;
          }
          if ($(`#${PREFIX}-auto-probe-forbidden`, root)?.checked) {
            doStartProbe();
          }
          return;
        }
        if (act === 'read-all-pages') {
          btn.disabled = true;
          try {
            const items = await S2A.domAccounts.fetchAllAccountIdsFromApi({
              onlyGrok: onlyGrokChecked(),
              timezone: ($(`#${PREFIX}-tz`, root)?.value || cfg.timezone || '').trim(),
            });
            fillIds(items);
            log(`API 拉取完成：${items.length} 个账号`);
          } catch (err) {
            log(`API 拉取失败：${err.message || err}`);
            alert(err.message || String(err));
          } finally {
            btn.disabled = false;
          }
          return;
        }
        if (act === 'start') return doStartProbe();
        if (act === 'stop') {
          abortFlag = true;
          log('正在停止…');
          return;
        }
        if (act === 'export') return G.exportCsv(results, log);
        if (act === 'copy-summary') return G.copySummary(results, log);
      };

      root.addEventListener('click', onClick);

      const selInterval = setInterval(() => {
        if (document.getElementById(`${PREFIX}-root`)) refreshSelectionCount();
      }, 2000);

      refreshSelectionCount();

      function dispose() {
        abortFlag = true;
        clearInterval(selInterval);
        root.removeEventListener('click', onClick);
        if (root.parentNode) root.parentNode.removeChild(root);
      }

      // expose for bar actions / external open with prefill
      G._activeSession = {
        fillIds,
        log,
        startProbe: doStartProbe,
        getRunning: () => running,
        abort: () => {
          abortFlag = true;
        },
        readPanelCfg,
        loadCfg: () => cfg,
      };

      return {
        dispose,
        fillIds,
        log,
        startProbe: doStartProbe,
        getRunning: () => running,
      };
    }

    G.DEFAULT_CFG = DEFAULT_CFG;
    G.loadCfg = loadCfg;
    G.saveCfg = saveCfg;
    G.mount = mount;
    G.PREFIX = PREFIX;
    G.TOOL_ID = TOOL_ID;
  })(S2A);



/* ==== src/tools/grok-quota/index.js ==== */
  // --- Grok quota tool registration ---
  (function (S2A) {
    const G = (S2A.tools['grok-quota'] = S2A.tools['grok-quota'] || {});
    let session = null;

    function register() {
      S2A.registerTool({
        id: 'grok-quota',
        name: 'Grok 批量额度探测',
        description: '批量探测 Grok 额度；403 可自动删除',
        order: 10,
        match: (ctx) => /\/admin\/accounts\b/.test(ctx.pathname),
        barActions: (ctx) => [
          {
            id: 'open',
            label: '批量额度探测',
            onClick: () => {
              S2A.openTool('grok-quota');
              // after open, fill selected if any
              setTimeout(() => {
                if (!G._activeSession) return;
                const items = S2A.domAccounts.collectSelectedFromDom({ onlyGrok: true });
                if (items.length) {
                  G._activeSession.fillIds(items);
                  G._activeSession.log(`已从批量栏读取勾选 ${items.length} 个`);
                }
              }, 50);
            },
          },
          {
            id: 'forbidden',
            label: '读取本页 forbidden',
            onClick: () => {
              S2A.openTool('grok-quota');
              setTimeout(() => {
                if (!G._activeSession) return;
                const items = S2A.domAccounts.collectForbiddenFromDom({ onlyGrok: true });
                G._activeSession.fillIds(items);
                G._activeSession.log(`本页 forbidden：${items.length} 个`);
                if (!items.length) alert('当前页未找到 forbidden 账号');
              }, 50);
            },
          },
        ],
        onInit(ctx) {
          // bar inject handled by shell.injectToolBarActions
        },
        onOpen(ctx, hostEl) {
          if (session) {
            try {
              session.dispose();
            } catch (_) {}
            session = null;
          }
          session = G.mount(hostEl);
          return () => {
            if (session) {
              try {
                session.dispose();
              } catch (_) {}
              session = null;
            }
            G._activeSession = null;
          };
        },
        onClose(ctx) {
          if (G._activeSession && typeof G._activeSession.abort === 'function') {
            G._activeSession.abort();
          }
          if (session) {
            try {
              session.dispose();
            } catch (_) {}
            session = null;
          }
          G._activeSession = null;
        },
        onRouteChange(ctx) {
          // nothing special; shell re-inits bars
        },
      });
    }

    G.register = register;
  })(S2A);



/* ==== src/tools/delete-error-accounts/runner.js ==== */
  // --- Delete error accounts runner ---
  (function (S2A) {
    const T = (S2A.tools['delete-error-accounts'] = S2A.tools['delete-error-accounts'] || {});
    const { sleep } = S2A.util;

    /**
     * Concurrent delete workers.
     * @returns {{ done: Promise<void> }}
     */
    function startDelete(opts) {
      const { ids, accountMeta, results, cfg, log, onUpdate, getAbort } = opts;

      let cursor = 0;
      const workers = Array.from({ length: cfg.concurrency }, async () => {
        while (!getAbort()) {
          const i = cursor++;
          if (i >= ids.length) break;
          const id = ids[i];
          const row = results.get(id);
          if (!row) continue;
          row.state = 'run';
          if (onUpdate) onUpdate();

          try {
            if (cfg.delayMs > 0) await sleep(cfg.delayMs);
            await S2A.api.deleteAccount(id);
            row.state = 'del';
            row.deleted = true;
            row.note = row.note || '已删除';
            if (log) log(`#${id} 已删除${row.name ? ` ${row.name}` : ''}`);
          } catch (err) {
            row.state = 'del_fail';
            row.deleted = false;
            row.error = err.message || String(err);
            row.note = row.error;
            if (log) log(`#${id} 删除失败: ${row.error}`);
          }
          if (onUpdate) onUpdate();
        }
      });

      return {
        done: Promise.all(workers).then(() => {}),
      };
    }

    T.startDelete = startDelete;
  })(S2A);


/* ==== src/tools/delete-error-accounts/panel.js ==== */
  // --- Delete error accounts panel ---
  (function (S2A) {
    const T = (S2A.tools['delete-error-accounts'] = S2A.tools['delete-error-accounts'] || {});
    const { $, esc, parseIdsText } = S2A.util;

    const TOOL_ID = 'delete-error-accounts';
    const PREFIX = 's2a-tool-del-err';

    const DEFAULT_CFG = {
      concurrency: 3,
      delayMs: 200,
      onlyGrok: false,
      requireConfirm: true,
      timezone: 'Asia/Shanghai',
    };

    function loadCfg() {
      return S2A.storage.getToolCfg(TOOL_ID, DEFAULT_CFG);
    }

    function saveCfg(cfg) {
      S2A.storage.setToolCfg(TOOL_ID, cfg);
    }

    function mount(hostEl) {
      let cfg = loadCfg();
      let running = false;
      let abortFlag = false;
      /** @type {Map<string, any>} */
      const results = new Map();
      /** @type {Map<string, any>} */
      let accountMeta = new Map();

      const root = document.createElement('div');
      root.id = `${PREFIX}-root`;
      root.innerHTML = `
        <div class="s2a-row">
          <button type="button" class="s2a-btn s2a-btn-danger" data-act="read-error" title="扫描当前页「状态」列为「错误」的账号">读取本页错误</button>
          <button type="button" class="s2a-btn s2a-btn-secondary" data-act="read-selected">读取勾选</button>
          <button type="button" class="s2a-btn s2a-btn-secondary" data-act="read-page">读取本页</button>
          <button type="button" class="s2a-btn s2a-btn-secondary" data-act="read-all-error" title="分页拉取账号列表，按状态筛选错误（兼容服务端无 status 过滤时的客户端筛选）">拉取全部错误(API)</button>
          <span class="s2a-muted" id="${PREFIX}-sel-info">未选择</span>
        </div>
        <div class="s2a-row">
          <label class="s2a-lbl"><input type="checkbox" id="${PREFIX}-only-grok" ${cfg.onlyGrok ? 'checked' : ''}> 仅 Grok</label>
          <label class="s2a-lbl">并发 <input type="number" id="${PREFIX}-concurrency" min="1" max="20" value="${esc(cfg.concurrency)}"></label>
          <label class="s2a-lbl">间隔ms <input type="number" id="${PREFIX}-delay" min="0" max="10000" value="${esc(cfg.delayMs)}"></label>
          <label class="s2a-lbl"><input type="checkbox" id="${PREFIX}-confirm" ${cfg.requireConfirm !== false ? 'checked' : ''}> 删除前确认</label>
        </div>
        <div class="s2a-muted" style="margin-bottom:8px">
          匹配状态列粉红标签「错误」/ error。删除调用 DELETE /admin/accounts/{id}，不可恢复，请确认后再执行。
        </div>
        <textarea id="${PREFIX}-ids" placeholder="账号 ID，每行一个。建议先点「读取本页错误」。&#10;示例：&#10;7752&#10;7753"></textarea>
        <div class="s2a-row" style="margin-top:8px">
          <button type="button" class="s2a-btn s2a-btn-danger" data-act="start">开始删除</button>
          <button type="button" class="s2a-btn s2a-btn-secondary" data-act="stop" disabled>停止</button>
          <button type="button" class="s2a-btn s2a-btn-secondary" data-act="export">导出 CSV</button>
          <button type="button" class="s2a-btn s2a-btn-ok" data-act="copy-summary">复制摘要</button>
        </div>
        <div class="s2a-stats" style="grid-template-columns: repeat(4, 1fr)">
          <div class="s2a-stat"><b id="${PREFIX}-st-total">0</b><span>总数</span></div>
          <div class="s2a-stat"><b id="${PREFIX}-st-done">0</b><span>完成</span></div>
          <div class="s2a-stat"><b id="${PREFIX}-st-ok">0</b><span>已删</span></div>
          <div class="s2a-stat"><b id="${PREFIX}-st-err">0</b><span>失败</span></div>
        </div>
        <div class="s2a-progress"><i id="${PREFIX}-progress-bar"></i></div>
        <div class="s2a-table-wrap">
          <table>
            <thead>
              <tr>
                <th>ID</th>
                <th>名称</th>
                <th>状态</th>
                <th>账号状态</th>
                <th>备注</th>
              </tr>
            </thead>
            <tbody id="${PREFIX}-tbody"></tbody>
          </table>
        </div>
        <div class="s2a-log" id="${PREFIX}-log"></div>
      `;
      hostEl.appendChild(root);

      function log(msg) {
        const el = $(`#${PREFIX}-log`, root);
        if (!el) return;
        const ts = new Date().toLocaleTimeString();
        el.textContent = `[${ts}] ${msg}\n` + el.textContent;
      }

      function fillIds(items) {
        accountMeta = new Map();
        const ids = [];
        for (const it of items) {
          const id = String(it.id || it).trim();
          if (!id) continue;
          ids.push(id);
          accountMeta.set(id, {
            id,
            name: it.name || it.email || '',
            platform: it.platform || '',
            statusType: it.statusType || '',
            statusText: it.statusText || it.statusType || '',
          });
        }
        const ta = $(`#${PREFIX}-ids`, root);
        if (ta) ta.value = ids.join('\n');
        const info = $(`#${PREFIX}-sel-info`, root);
        if (info) info.textContent = `已装载 ${ids.length} 个 ID`;
      }

      function updateStats() {
        const all = Array.from(results.values());
        const total = all.length;
        const done = all.filter((x) => ['del', 'del_fail'].includes(x.state)).length;
        const ok = all.filter((x) => x.state === 'del').length;
        const err = all.filter((x) => x.state === 'del_fail').length;
        const set = (id, v) => {
          const el = document.getElementById(id);
          if (el) el.textContent = String(v);
        };
        set(`${PREFIX}-st-total`, total);
        set(`${PREFIX}-st-done`, done);
        set(`${PREFIX}-st-ok`, ok);
        set(`${PREFIX}-st-err`, err);
        const bar = document.getElementById(`${PREFIX}-progress-bar`);
        if (bar) bar.style.width = total ? `${Math.round((done / total) * 100)}%` : '0%';
      }

      function renderTable() {
        const tbody = document.getElementById(`${PREFIX}-tbody`);
        if (!tbody) return;
        const rank = { run: 0, del_fail: 1, del: 2, wait: 3 };
        const rows = Array.from(results.values()).sort((a, b) => {
          const ao = rank[a.state] ?? 9;
          const bo = rank[b.state] ?? 9;
          if (ao !== bo) return ao - bo;
          return String(a.id).localeCompare(String(b.id), undefined, { numeric: true });
        });

        tbody.innerHTML = rows
          .map((r) => {
            let tag;
            if (r.state === 'del') tag = `<span class="s2a-tag bad">已删</span>`;
            else if (r.state === 'del_fail') tag = `<span class="s2a-tag bad">失败</span>`;
            else if (r.state === 'run') tag = `<span class="s2a-tag run">删除中</span>`;
            else tag = `<span class="s2a-tag warn">等待</span>`;
            const rowCls = r.state === 'del' || r.state === 'del_fail' ? 'err' : r.state;
            return `<tr class="${esc(rowCls)}">
              <td>${esc(r.id)}</td>
              <td>${esc(r.name || '—')}</td>
              <td>${tag}</td>
              <td>${esc(r.statusText || r.statusType || '错误')}</td>
              <td class="s2a-muted">${esc(r.note || r.error || '')}</td>
            </tr>`;
          })
          .join('');
      }

      function readPanelCfg() {
        const concurrency = Math.max(
          1,
          Math.min(20, Number($(`#${PREFIX}-concurrency`, root)?.value || cfg.concurrency) || 3)
        );
        const delayMs = Math.max(
          0,
          Math.min(10000, Number($(`#${PREFIX}-delay`, root)?.value || cfg.delayMs) || 0)
        );
        const onlyGrok = $(`#${PREFIX}-only-grok`, root)?.checked === true;
        const requireConfirm = $(`#${PREFIX}-confirm`, root)?.checked !== false;
        cfg = { ...cfg, concurrency, delayMs, onlyGrok, requireConfirm };
        saveCfg(cfg);
        return cfg;
      }

      function onlyGrokChecked() {
        return $(`#${PREFIX}-only-grok`, root)?.checked === true;
      }

      function collectOpts() {
        return {
          onlyGrok: onlyGrokChecked(),
          panelRoot: root,
          statuses: ['error'],
        };
      }

      async function doStartDelete() {
        if (running) return;
        readPanelCfg();

        let ids = parseIdsText($(`#${PREFIX}-ids`, root)?.value || '');
        if (!ids.length) {
          const items = S2A.domAccounts.collectByStatusFromDom(collectOpts());
          if (items.length) {
            fillIds(items);
            ids = items.map((x) => x.id);
          }
        }
        if (!ids.length) {
          alert('请先读取本页错误账号，或手动填入账号 ID');
          return;
        }

        const tip =
          `即将删除 ${ids.length} 个账号（状态筛选为「错误」装载，最终以 ID 列表为准）。\n\n` +
          `操作不可恢复：DELETE /admin/accounts/{id}\n\n是否继续？`;
        if (cfg.requireConfirm && !confirm(tip)) {
          log('已取消删除');
          return;
        }

        running = true;
        abortFlag = false;
        results.clear();
        for (const id of ids) {
          const meta = accountMeta.get(id) || {};
          results.set(id, {
            id,
            name: meta.name || '',
            state: 'wait',
            statusType: meta.statusType || 'error',
            statusText: meta.statusText || '错误',
            note: '',
            error: '',
            deleted: false,
          });
        }
        updateStats();
        renderTable();

        const startBtn = root.querySelector('[data-act="start"]');
        const stopBtn = root.querySelector('[data-act="stop"]');
        if (startBtn) startBtn.disabled = true;
        if (stopBtn) stopBtn.disabled = false;

        log(`开始删除 ${ids.length} 个账号，并发=${cfg.concurrency}，间隔=${cfg.delayMs}ms`);

        const job = T.startDelete({
          ids,
          accountMeta,
          results,
          cfg,
          log,
          onUpdate: () => {
            renderTable();
            updateStats();
          },
          getAbort: () => abortFlag,
        });

        await job.done;
        running = false;
        if (startBtn) startBtn.disabled = false;
        if (stopBtn) stopBtn.disabled = true;
        const deleted = Array.from(results.values()).filter((r) => r.state === 'del').length;
        const failed = Array.from(results.values()).filter((r) => r.state === 'del_fail').length;
        log(abortFlag ? '已停止' : `全部完成 · 已删=${deleted} · 失败=${failed}`);
      }

      function exportCsv() {
        const rows = Array.from(results.values());
        if (!rows.length) {
          alert('没有可导出的结果');
          return;
        }
        const header = ['id', 'name', 'state', 'status', 'deleted', 'note', 'error'];
        const lines = [header.join(',')];
        for (const r of rows) {
          const cols = [
            r.id,
            r.name,
            r.state,
            r.statusText || r.statusType,
            r.deleted || r.state === 'del' ? '1' : '0',
            r.note,
            r.error,
          ].map((v) => {
            const s = String(v ?? '');
            return /["\n,]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
          });
          lines.push(cols.join(','));
        }
        const blob = new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
        S2A.util.downloadBlob(
          blob,
          `delete-error-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.csv`
        );
        log(`已导出 CSV ${rows.length} 行`);
      }

      async function copySummary() {
        const rows = Array.from(results.values());
        const del = rows.filter((r) => r.state === 'del');
        const fail = rows.filter((r) => r.state === 'del_fail');
        const lines = [
          `批量删除错误账号摘要 ${new Date().toLocaleString()}`,
          `总数 ${rows.length} · 已删 ${del.length} · 失败 ${fail.length}`,
          '',
          ...del.map((r) => `#${r.id} ${r.name || ''} OK`),
        ];
        if (fail.length) {
          lines.push('', '失败:');
          fail.forEach((r) => lines.push(`#${r.id} ${r.error || r.note}`));
        }
        const text = lines.join('\n');
        try {
          await navigator.clipboard.writeText(text);
          log('摘要已复制到剪贴板');
        } catch (_) {
          prompt('复制以下内容：', text);
        }
      }

      const onClick = async (e) => {
        const btn = e.target.closest('[data-act]');
        if (!btn || !root.contains(btn)) return;
        const act = btn.getAttribute('data-act');

        if (act === 'read-error') {
          const items = S2A.domAccounts.collectByStatusFromDom(collectOpts());
          fillIds(items);
          log(`本页错误账号：${items.length} 个` + (items.length ? ` → ${items.map((x) => x.id).join(',')}` : ''));
          if (!items.length) alert('当前页未找到状态为「错误」的账号');
          return;
        }
        if (act === 'read-selected') {
          const items = S2A.domAccounts.collectSelectedFromDom({
            onlyGrok: onlyGrokChecked(),
            panelRoot: root,
          });
          fillIds(items);
          log(`已读取勾选 ${items.length} 个账号`);
          return;
        }
        if (act === 'read-page') {
          const items = S2A.domAccounts.collectPageAccountsFromDom({ onlyGrok: onlyGrokChecked() });
          fillIds(items);
          log(`已读取本页 ${items.length} 个账号`);
          return;
        }
        if (act === 'read-all-error') {
          btn.disabled = true;
          try {
            // Try server filter status=error first; then fall back to client-side status filter
            // onlyGrok must be explicit (API helper defaults onlyGrok=true for grok tool)
            const onlyGrok = onlyGrokChecked();
            let items = await S2A.domAccounts.fetchAllAccountIdsFromApi({
              onlyGrok,
              timezone: cfg.timezone,
              status: 'error',
              statuses: ['error'],
            });
            // If server ignored status / field mismatch and nothing matched, try without status query
            if (!items.length) {
              items = await S2A.domAccounts.fetchAllAccountIdsFromApi({
                onlyGrok,
                timezone: cfg.timezone,
                statuses: ['error'],
              });
            }
            fillIds(items);
            log(`API 拉取错误账号：${items.length} 个`);
            if (!items.length) {
              alert(
                'API 未筛出错误账号。可能后端 status 字段与 UI 不一致。\n请改用「读取本页错误」并翻页处理，或先在后台筛「错误」再读本页。'
              );
            }
          } catch (err) {
            log(`API 拉取失败：${err.message || err}`);
            alert(err.message || String(err));
          } finally {
            btn.disabled = false;
          }
          return;
        }
        if (act === 'start') return doStartDelete();
        if (act === 'stop') {
          abortFlag = true;
          log('正在停止…');
          return;
        }
        if (act === 'export') return exportCsv();
        if (act === 'copy-summary') return copySummary();
      };

      root.addEventListener('click', onClick);

      function dispose() {
        abortFlag = true;
        root.removeEventListener('click', onClick);
        if (root.parentNode) root.parentNode.removeChild(root);
      }

      T._activeSession = {
        fillIds,
        log,
        startDelete: doStartDelete,
        abort: () => {
          abortFlag = true;
        },
      };

      return {
        dispose,
        fillIds,
        log,
        startDelete: doStartDelete,
      };
    }

    T.DEFAULT_CFG = DEFAULT_CFG;
    T.loadCfg = loadCfg;
    T.saveCfg = saveCfg;
    T.mount = mount;
    T.PREFIX = PREFIX;
    T.TOOL_ID = TOOL_ID;
  })(S2A);


/* ==== src/tools/delete-error-accounts/index.js ==== */
  // --- Delete error accounts tool registration ---
  (function (S2A) {
    const T = (S2A.tools['delete-error-accounts'] = S2A.tools['delete-error-accounts'] || {});
    let session = null;

    function register() {
      S2A.registerTool({
        id: 'delete-error-accounts',
        name: '批量删除错误账号',
        description: '扫描状态=错误 的账号并批量删除（需确认）',
        order: 20,
        match: (ctx) => /\/admin\/accounts\b/.test(ctx.pathname),
        barActions: () => [
          {
            id: 'open-error',
            label: '删除本页错误',
            onClick: () => {
              S2A.openTool('delete-error-accounts');
              setTimeout(() => {
                if (!T._activeSession) return;
                const items = S2A.domAccounts.collectByStatusFromDom({
                  onlyGrok: false,
                  statuses: ['error'],
                });
                T._activeSession.fillIds(items);
                T._activeSession.log(
                  `本页错误账号：${items.length} 个` +
                    (items.length ? ` → ${items.map((x) => x.id).join(',')}` : '')
                );
                if (!items.length) alert('当前页未找到状态为「错误」的账号');
              }, 50);
            },
          },
        ],
        onInit() {},
        onOpen(ctx, hostEl) {
          if (session) {
            try {
              session.dispose();
            } catch (_) {}
            session = null;
          }
          session = T.mount(hostEl);
          return () => {
            if (session) {
              try {
                session.dispose();
              } catch (_) {}
              session = null;
            }
            T._activeSession = null;
          };
        },
        onClose() {
          if (T._activeSession && typeof T._activeSession.abort === 'function') {
            T._activeSession.abort();
          }
          if (session) {
            try {
              session.dispose();
            } catch (_) {}
            session = null;
          }
          T._activeSession = null;
        },
        onRouteChange() {},
      });
    }

    T.register = register;
  })(S2A);


/* ==== src/tools/register-all.js ==== */
  // --- Register all tools (add one line per tool) ---
  (function (S2A) {
    if (S2A.tools['grok-quota'] && typeof S2A.tools['grok-quota'].register === 'function') {
      S2A.tools['grok-quota'].register();
    }
    if (
      S2A.tools['delete-error-accounts'] &&
      typeof S2A.tools['delete-error-accounts'].register === 'function'
    ) {
      S2A.tools['delete-error-accounts'].register();
    }
    // Add more tools here:
    // if (S2A.tools['foo'] && typeof S2A.tools['foo'].register === 'function') S2A.tools['foo'].register();
  })(S2A);



/* ==== src/main.js ==== */
  // --- main boot ---
  (function (S2A) {
    function boot() {
      try {
        if (S2A.shell && typeof S2A.shell.injectStyles === 'function') {
          S2A.shell.injectStyles();
        }
        // tools already registered by register-all.js
        if (S2A.shell && typeof S2A.shell.init === 'function') {
          S2A.shell.init();
        }
        if (S2A.registry && typeof S2A.registry.dispatchInits === 'function') {
          S2A.registry.dispatchInits();
        }
        console.info(`[S2A] Sub2API Tools v${S2A.version} ready`);
      } catch (e) {
        console.error('[S2A] boot failed', e);
      }
    }

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', boot);
    } else {
      boot();
    }
  })(S2A);

})();


