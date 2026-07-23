// ==UserScript==
// @name         Sub2API Grok 批量额度探测
// @namespace    http://tampermonkey.net/
// @version      1.3.0
// @description  在 sub2api 账号管理页批量勾选/读取本页 forbidden 的 Grok 账号，并发探测额度；403 计失败并可自动删除
// @author       local
// @match        http://192.168.5.35:8084/*
// @match        https://192.168.5.35:8084/*
// @match        *://*/admin/accounts*
// @match        *://*/admin/*
// @grant        GM_xmlhttpRequest
// @grant        GM_addStyle
// @grant        GM_setValue
// @grant        GM_getValue
// @connect      192.168.5.35
// @connect      *
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  const PANEL_ID = 's2a-grok-quota-panel';
  const STYLE_ID = 's2a-grok-quota-style';
  const STORAGE_KEY = 's2a_grok_quota_cfg';

  const DEFAULT_CFG = {
    concurrency: 3,
    delayMs: 200,
    timezone: 'Asia/Shanghai',
    onlyGrok: true,
    autoInjectBar: true,
    autoDeleteOn403: false,
    confirmDeleteOn403: true,
  };

  function loadCfg() {
    try {
      const raw = typeof GM_getValue === 'function' ? GM_getValue(STORAGE_KEY, null) : localStorage.getItem(STORAGE_KEY);
      if (!raw) return { ...DEFAULT_CFG };
      const obj = typeof raw === 'string' ? JSON.parse(raw) : raw;
      return { ...DEFAULT_CFG, ...obj };
    } catch (_) {
      return { ...DEFAULT_CFG };
    }
  }

  function saveCfg(cfg) {
    try {
      if (typeof GM_setValue === 'function') GM_setValue(STORAGE_KEY, cfg);
      else localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg));
    } catch (_) {}
  }

  let cfg = loadCfg();
  let running = false;
  let abortFlag = false;
  /** @type {Map<string, any>} */
  const results = new Map();

  function $(sel, root = document) {
    return root.querySelector(sel);
  }

  function $$(sel, root = document) {
    return Array.from(root.querySelectorAll(sel));
  }

  function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  function getAuthToken() {
    return (
      localStorage.getItem('auth_token') ||
      sessionStorage.getItem('auth_token') ||
      ''
    ).trim();
  }

  function getApiBase() {
    // sub2api SPA axios baseURL = /api/v1
    return `${location.origin}/api/v1`;
  }

  function getTimezone() {
    const fromCfg = (cfg.timezone || '').trim();
    if (fromCfg) return fromCfg;
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Shanghai';
    } catch (_) {
      return 'Asia/Shanghai';
    }
  }

  function esc(s) {
    return String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const css = `
#${PANEL_ID} {
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
#${PANEL_ID}.s2a-collapsed { width: 220px; max-height: none; }
#${PANEL_ID}.s2a-collapsed .s2a-body { display: none; }
#${PANEL_ID} .s2a-hd {
  display: flex; align-items: center; justify-content: space-between;
  gap: 8px; padding: 10px 12px; background: #1e293b; cursor: move; user-select: none;
}
#${PANEL_ID} .s2a-hd h3 { margin: 0; font-size: 13px; font-weight: 700; color: #f8fafc; }
#${PANEL_ID} .s2a-hd .s2a-sub { color: #94a3b8; font-size: 11px; }
#${PANEL_ID} .s2a-hd-actions { display: flex; gap: 6px; }
#${PANEL_ID} .s2a-hd-actions button {
  border: 0; background: #334155; color: #e2e8f0; border-radius: 6px;
  padding: 4px 8px; cursor: pointer; font-size: 11px;
}
#${PANEL_ID} .s2a-hd-actions button:hover { background: #475569; }
#${PANEL_ID} .s2a-body { padding: 10px 12px 12px; overflow: auto; min-height: 0; flex: 1; }
#${PANEL_ID} .s2a-row { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 8px; align-items: center; }
#${PANEL_ID} label.s2a-lbl { display: inline-flex; align-items: center; gap: 4px; color: #cbd5e1; }
#${PANEL_ID} input[type="number"],
#${PANEL_ID} input[type="text"],
#${PANEL_ID} textarea {
  background: #111827; color: #e5e7eb; border: 1px solid #374151;
  border-radius: 6px; padding: 5px 8px; font-size: 12px;
}
#${PANEL_ID} input[type="number"] { width: 70px; }
#${PANEL_ID} input[type="text"] { width: 160px; }
#${PANEL_ID} textarea {
  width: 100%; min-height: 54px; resize: vertical; font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
}
#${PANEL_ID} .s2a-btn {
  border: 0; border-radius: 7px; padding: 6px 10px; cursor: pointer;
  font-size: 12px; font-weight: 600; color: #fff;
}
#${PANEL_ID} .s2a-btn:disabled { opacity: .55; cursor: not-allowed; }
#${PANEL_ID} .s2a-btn-primary { background: #0891b2; }
#${PANEL_ID} .s2a-btn-primary:hover:not(:disabled) { background: #0e7490; }
#${PANEL_ID} .s2a-btn-secondary { background: #475569; }
#${PANEL_ID} .s2a-btn-danger { background: #b91c1c; }
#${PANEL_ID} .s2a-btn-ok { background: #15803d; }
#${PANEL_ID} .s2a-stats {
  display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; margin: 8px 0;
}
#${PANEL_ID} .s2a-stat {
  background: #111827; border: 1px solid #1f2937; border-radius: 8px; padding: 6px 8px;
}
#${PANEL_ID} .s2a-stat b { display: block; font-size: 16px; color: #f8fafc; }
#${PANEL_ID} .s2a-stat span { color: #94a3b8; font-size: 11px; }
#${PANEL_ID} .s2a-progress {
  height: 6px; background: #1f2937; border-radius: 999px; overflow: hidden; margin: 6px 0 10px;
}
#${PANEL_ID} .s2a-progress > i {
  display: block; height: 100%; width: 0; background: linear-gradient(90deg, #06b6d4, #22c55e);
  transition: width .2s ease;
}
#${PANEL_ID} .s2a-table-wrap {
  max-height: 280px; overflow: auto; border: 1px solid #1f2937; border-radius: 8px;
}
#${PANEL_ID} table { width: 100%; border-collapse: collapse; font-size: 11px; }
#${PANEL_ID} th, #${PANEL_ID} td {
  padding: 6px 8px; border-bottom: 1px solid #1f2937; text-align: left; vertical-align: top;
}
#${PANEL_ID} th {
  position: sticky; top: 0; background: #1e293b; color: #cbd5e1; z-index: 1;
}
#${PANEL_ID} tr.ok td { background: rgba(22, 163, 74, .08); }
#${PANEL_ID} tr.err td { background: rgba(220, 38, 38, .1); }
#${PANEL_ID} tr.run td { background: rgba(8, 145, 178, .1); }
#${PANEL_ID} .s2a-muted { color: #94a3b8; }
#${PANEL_ID} .s2a-tag {
  display: inline-block; padding: 1px 6px; border-radius: 999px; font-size: 10px; font-weight: 700;
}
#${PANEL_ID} .s2a-tag.ok { background: #14532d; color: #bbf7d0; }
#${PANEL_ID} .s2a-tag.warn { background: #713f12; color: #fde68a; }
#${PANEL_ID} .s2a-tag.bad { background: #7f1d1d; color: #fecaca; }
#${PANEL_ID} .s2a-tag.run { background: #164e63; color: #a5f3fc; }
#${PANEL_ID} .s2a-log {
  margin-top: 8px; max-height: 90px; overflow: auto; background: #020617;
  border: 1px solid #1f2937; border-radius: 8px; padding: 6px 8px;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace; color: #94a3b8; white-space: pre-wrap;
}
#s2a-grok-quota-fab {
  position: fixed; right: 16px; bottom: 16px; z-index: 2147483645;
  border: 0; border-radius: 999px; padding: 10px 14px; cursor: pointer;
  background: #0891b2; color: #fff; font-weight: 700; font-size: 12px;
  box-shadow: 0 8px 24px rgba(8,145,178,.45);
}
#s2a-grok-quota-bar-btn {
  margin-left: 8px;
}
`;
    if (typeof GM_addStyle === 'function') GM_addStyle(css);
    else {
      const st = document.createElement('style');
      st.id = STYLE_ID;
      st.textContent = css;
      document.head.appendChild(st);
    }
  }

  function log(msg) {
    const el = $(`#${PANEL_ID} .s2a-log`);
    if (!el) return;
    const ts = new Date().toLocaleTimeString();
    el.textContent = `[${ts}] ${msg}\n` + el.textContent;
  }

  function ensureFab() {
    if (document.getElementById('s2a-grok-quota-fab') || document.getElementById(PANEL_ID)) return;
    const btn = document.createElement('button');
    btn.id = 's2a-grok-quota-fab';
    btn.type = 'button';
    btn.textContent = 'Grok 额度探测';
    btn.onclick = () => openPanel();
    document.body.appendChild(btn);
  }

  function openPanel() {
    const fab = document.getElementById('s2a-grok-quota-fab');
    if (fab) fab.remove();
    if (!document.getElementById(PANEL_ID)) createPanel();
    const panel = document.getElementById(PANEL_ID);
    if (panel) {
      panel.style.display = 'flex';
      panel.classList.remove('s2a-collapsed');
    }
    refreshSelectionCount();
  }

  function closePanel() {
    const panel = document.getElementById(PANEL_ID);
    if (panel) panel.remove();
    ensureFab();
  }

  function createPanel() {
    injectStyle();
    if (document.getElementById(PANEL_ID)) return;

    const panel = document.createElement('div');
    panel.id = PANEL_ID;
    panel.innerHTML = `
      <div class="s2a-hd" data-drag="1">
        <div>
          <h3>Grok 批量额度探测</h3>
          <div class="s2a-sub">sub2api · /admin/grok/accounts/{id}/quota</div>
        </div>
        <div class="s2a-hd-actions">
          <button type="button" data-act="collapse" title="折叠">–</button>
          <button type="button" data-act="close" title="关闭">×</button>
        </div>
      </div>
      <div class="s2a-body">
        <div class="s2a-row">
          <button type="button" class="s2a-btn s2a-btn-secondary" data-act="read-selected">读取勾选</button>
          <button type="button" class="s2a-btn s2a-btn-secondary" data-act="read-page">读取本页</button>
          <button type="button" class="s2a-btn s2a-btn-danger" data-act="read-forbidden" title="扫描当前页「用量窗口」列为 forbidden / validation / violation 的账号">读取本页 forbidden</button>
          <button type="button" class="s2a-btn s2a-btn-secondary" data-act="read-all-pages">拉取全部(API)</button>
          <span class="s2a-muted" id="s2a-sel-info">未选择</span>
        </div>
        <div class="s2a-row">
          <label class="s2a-lbl"><input type="checkbox" id="s2a-include-validation" checked> 含 validation</label>
          <label class="s2a-lbl"><input type="checkbox" id="s2a-include-violation" checked> 含 violation</label>
          <label class="s2a-lbl"><input type="checkbox" id="s2a-auto-probe-forbidden"> 读取后自动探测</label>
          <span class="s2a-muted">匹配用量窗口红/黄标签：forbidden</span>
        </div>
        <div class="s2a-row">
          <label class="s2a-lbl">并发 <input type="number" id="s2a-concurrency" min="1" max="20" value="${esc(cfg.concurrency)}"></label>
          <label class="s2a-lbl">间隔ms <input type="number" id="s2a-delay" min="0" max="10000" value="${esc(cfg.delayMs)}"></label>
          <label class="s2a-lbl">时区 <input type="text" id="s2a-tz" value="${esc(cfg.timezone)}"></label>
          <label class="s2a-lbl"><input type="checkbox" id="s2a-only-grok" ${cfg.onlyGrok ? 'checked' : ''}> 仅 Grok</label>
        </div>
        <div class="s2a-row">
          <label class="s2a-lbl" title="探测结果含 upstream 403 / GROK_QUOTA_PROBE_UPSTREAM_ERROR 时计为失败，并调用 DELETE /admin/accounts/{id}">
            <input type="checkbox" id="s2a-auto-delete-403" ${cfg.autoDeleteOn403 ? 'checked' : ''}>
            403 自动删除
          </label>
          <label class="s2a-lbl" title="开启自动删除时，开始探测前再确认一次">
            <input type="checkbox" id="s2a-confirm-delete-403" ${cfg.confirmDeleteOn403 !== false ? 'checked' : ''}>
            删除前确认
          </label>
          <span class="s2a-muted">上游 403（forbidden 探测失败）不算成功</span>
        </div>
        <textarea id="s2a-ids" placeholder="账号 ID，每行一个，或逗号/空格分隔。也可先点「读取勾选」。&#10;示例：&#10;7752&#10;7753,7754"></textarea>
        <div class="s2a-row" style="margin-top:8px">
          <button type="button" class="s2a-btn s2a-btn-primary" data-act="start">开始探测</button>
          <button type="button" class="s2a-btn s2a-btn-danger" data-act="stop" disabled>停止</button>
          <button type="button" class="s2a-btn s2a-btn-secondary" data-act="export">导出 CSV</button>
          <button type="button" class="s2a-btn s2a-btn-ok" data-act="copy-summary">复制摘要</button>
        </div>
        <div class="s2a-stats" style="grid-template-columns: repeat(5, 1fr)">
          <div class="s2a-stat"><b id="s2a-st-total">0</b><span>总数</span></div>
          <div class="s2a-stat"><b id="s2a-st-done">0</b><span>完成</span></div>
          <div class="s2a-stat"><b id="s2a-st-ok">0</b><span>成功</span></div>
          <div class="s2a-stat"><b id="s2a-st-err">0</b><span>失败</span></div>
          <div class="s2a-stat"><b id="s2a-st-del">0</b><span>已删</span></div>
        </div>
        <div class="s2a-progress"><i id="s2a-progress-bar"></i></div>
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
            <tbody id="s2a-tbody"></tbody>
          </table>
        </div>
        <div class="s2a-log"></div>
      </div>
    `;
    document.body.appendChild(panel);
    bindPanel(panel);
    makeDraggable(panel, panel.querySelector('[data-drag]'));
  }

  function bindPanel(panel) {
    panel.addEventListener('click', async (e) => {
      const btn = e.target.closest('[data-act]');
      if (!btn) return;
      const act = btn.getAttribute('data-act');
      if (act === 'close') return closePanel();
      if (act === 'collapse') {
        panel.classList.toggle('s2a-collapsed');
        return;
      }
      if (act === 'read-selected') {
        const items = collectSelectedFromDom();
        fillIds(items);
        log(`已读取勾选 ${items.length} 个账号`);
        return;
      }
      if (act === 'read-page') {
        const items = collectPageAccountsFromDom();
        fillIds(items);
        log(`已读取本页 ${items.length} 个账号`);
        return;
      }
      if (act === 'read-forbidden') {
        const items = collectForbiddenFromDom();
        fillIds(items);
        log(`本页 forbidden 账号：${items.length} 个` + (items.length ? ` → ${items.map((x) => x.id).join(',')}` : ''));
        if (!items.length) {
          alert('当前页未找到用量窗口为 forbidden 的账号');
          return;
        }
        if ($('#s2a-auto-probe-forbidden')?.checked) {
          startProbe();
        }
        return;
      }
      if (act === 'read-all-pages') {
        btn.disabled = true;
        try {
          const items = await fetchAllAccountIdsFromApi({ onlyGrok: $('#s2a-only-grok')?.checked !== false });
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
      if (act === 'start') return startProbe();
      if (act === 'stop') {
        abortFlag = true;
        log('正在停止…');
        return;
      }
      if (act === 'export') return exportCsv();
      if (act === 'copy-summary') return copySummary();
    });
  }

  function makeDraggable(panel, handle) {
    if (!handle) return;
    let sx = 0, sy = 0, ox = 0, oy = 0, dragging = false;
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
    window.addEventListener('mouseup', () => { dragging = false; });
  }

  function parseIdsText(text) {
    return String(text || '')
      .split(/[\s,;|]+/)
      .map((x) => x.trim())
      .filter(Boolean)
      .filter((x, i, arr) => arr.indexOf(x) === i);
  }

  /** @type {Map<string, {id:string,name?:string,platform?:string,type?:string}>} */
  let accountMeta = new Map();

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
    const ta = $('#s2a-ids');
    if (ta) ta.value = ids.join('\n');
    const info = $('#s2a-sel-info');
    if (info) {
      info.textContent = forbiddenN
        ? `已装载 ${ids.length} 个 ID（forbidden ${forbiddenN}）`
        : `已装载 ${ids.length} 个 ID`;
    }
  }

  function findAccountTableRoot() {
    // Prefer the accounts data table region
    const refs = $$('[class*="overflow"], table, [role="table"]');
    // Walk checked boxes' ancestors that look like rows
    return document.body;
  }

  function rowLooksGrok(row) {
    if (!row) return true;
    const text = (row.textContent || '').toLowerCase();
    // platform badge usually contains "Grok"
    return text.includes('grok');
  }

  function extractIdFromRow(row) {
    if (!row) return '';
    // DataTable rows: <tr data-row-id="7752">
    const dataRowId = row.getAttribute?.('data-row-id');
    if (dataRowId && /^\d+$/.test(dataRowId)) return dataRowId;

    // walk up if checkbox/cell inside tr
    const host = row.closest?.('[data-row-id]') || row;
    const hostId = host?.getAttribute?.('data-row-id');
    if (hostId && /^\d+$/.test(hostId)) return hostId;

    // cell-id: <span>#7752</span>
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
   * UI shows pink/red pill text: "forbidden" (also i18n variants).
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
      // Prefer short badge-like nodes (the pink pill in screenshot)
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

    // Fallback: whole row text contains standalone forbidden near usage area
    const rowText = (row.textContent || '').toLowerCase();
    if (/\bforbidden\b/.test(rowText)) return { type: 'forbidden', text: 'forbidden' };
    return null;
  }

  function collectForbiddenFromDom() {
    const onlyGrok = $('#s2a-only-grok')?.checked !== false;
    const includeValidation = $('#s2a-include-validation')?.checked !== false;
    const includeViolation = $('#s2a-include-violation')?.checked !== false;
    const allowed = new Set(['forbidden']);
    if (includeValidation) allowed.add('validation');
    if (includeViolation) allowed.add('violation');

    // Prefer real table body rows with data-row-id
    let rows = $$('tr[data-row-id], [role="row"][data-row-id]');
    if (!rows.length) {
      // fallback: any node that has both checkbox and #id-ish content
      rows = $$('tr, [role="row"]').filter((r) => r.querySelector('input[type="checkbox"]'));
    }

    const items = [];
    const seen = new Set();
    for (const row of rows) {
      const hit = detectForbiddenInRow(row);
      if (!hit || !allowed.has(hit.type)) continue;

      const id = extractIdFromRow(row);
      if (!id || seen.has(id)) continue;

      if (onlyGrok) {
        const txt = (row.textContent || '').toLowerCase();
        // page is often filtered to grok already; still skip obvious non-grok
        if (/(openai|anthropic|gemini|antigravity)/.test(txt) && !txt.includes('grok')) continue;
      }

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

  function extractNameFromRow(row) {
    if (!row) return '';
    // Usually second meaningful text after id
    const texts = $$( 'span, div', row)
      .map((el) => (el.textContent || '').trim())
      .filter((t) => t && !/^#\d+$/.test(t) && t.length < 80);
    // Prefer email-like or longer name
    const email = texts.find((t) => t.includes('@'));
    if (email) return email;
    return texts.find((t) => !/grok|oauth|api|启用|禁用|正常|错误/i.test(t)) || '';
  }

  function collectSelectedFromDom() {
    const onlyGrok = $('#s2a-only-grok')?.checked !== false;
    const boxes = $$('input[type="checkbox"]');
    const items = [];
    const seen = new Set();

    for (const box of boxes) {
      if (!box.checked) continue;
      if (box.closest(`#${PANEL_ID}`)) continue;
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
      if (onlyGrok && row && !rowLooksGrok(row) && !String(accountMeta.get(id)?.platform || '').includes('grok')) {
        const txt = (row.textContent || '').toLowerCase();
        if (/(openai|anthropic|gemini|antigravity|claude)/.test(txt) && !txt.includes('grok')) continue;
      }
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

  function collectPageAccountsFromDom() {
    const onlyGrok = $('#s2a-only-grok')?.checked !== false;
    const items = [];
    const seen = new Set();

    // Best: DataTable rows
    const rows = $$('tr[data-row-id], [role="row"][data-row-id]');
    if (rows.length) {
      for (const row of rows) {
        const id = extractIdFromRow(row);
        if (!id || seen.has(id)) continue;
        if (onlyGrok) {
          const txt = (row.textContent || '').toLowerCase();
          if (/(openai|anthropic|gemini|antigravity)/.test(txt) && !txt.includes('grok')) continue;
        }
        seen.add(id);
        items.push({ id, name: extractNameFromRow(row), platform: rowLooksGrok(row) ? 'grok' : '' });
      }
      return items;
    }

    // Fallback: spans that look like #12345 near checkboxes
    const idSpans = $$('span').filter((el) => /^#\d+$/.test((el.textContent || '').trim()));
    for (const span of idSpans) {
      const id = (span.textContent || '').trim().replace(/^#/, '');
      if (!id || seen.has(id)) continue;
      const row =
        span.closest('tr') ||
        span.closest('[role="row"]') ||
        span.parentElement?.parentElement?.parentElement;
      if (onlyGrok && row) {
        const txt = (row.textContent || '').toLowerCase();
        if (/(openai|anthropic|gemini|antigravity)/.test(txt) && !txt.includes('grok')) continue;
      }
      const hasCheck = row && row.querySelector('input[type="checkbox"]');
      if (!hasCheck) continue;
      seen.add(id);
      items.push({ id, name: extractNameFromRow(row), platform: row && rowLooksGrok(row) ? 'grok' : '' });
    }
    return items;
  }

  async function apiRequest(path, opts = {}) {
    const token = getAuthToken();
    if (!token) throw new Error('未登录：localStorage 中没有 auth_token，请先登录管理后台');

    const url = path.startsWith('http') ? path : `${getApiBase()}${path.startsWith('/') ? '' : '/'}${path}`;
    const method = (opts.method || 'GET').toUpperCase();
    const headers = {
      Accept: 'application/json',
      Authorization: `Bearer ${token}`,
      ...(opts.headers || {}),
    };
    if (opts.body && !headers['Content-Type']) headers['Content-Type'] = 'application/json';

    // Prefer same-origin fetch (cookie + CORS not an issue on matched origin)
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
        try { data = JSON.parse(text); } catch { data = { message: text.slice(0, 300) }; }
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
            try { data = JSON.parse(resp.responseText); } catch { data = { message: resp.responseText.slice(0, 300) }; }
          }
          if (resp.status < 200 || resp.status >= 300) {
            reject(new Error(data?.message || `HTTP ${resp.status}`));
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

  async function fetchAllAccountIdsFromApi({ onlyGrok = true } = {}) {
    const pageSize = 100;
    let page = 1;
    let total = Infinity;
    const items = [];
    const seen = new Set();

    while (items.length < total) {
      const params = new URLSearchParams({
        page: String(page),
        page_size: String(pageSize),
        timezone: getTimezone(),
      });
      if (onlyGrok) params.set('platform', 'grok');

      const data = await apiRequest(`/admin/accounts?${params.toString()}`);
      const rows = data?.items || data?.list || data?.accounts || data?.data || (Array.isArray(data) ? data : []);
      const count = Number(data?.total ?? data?.count ?? rows.length) || rows.length;
      total = count;

      for (const row of rows) {
        const id = String(row.id ?? row.account_id ?? '').trim();
        if (!id || seen.has(id)) continue;
        if (onlyGrok && row.platform && String(row.platform).toLowerCase() !== 'grok') continue;
        seen.add(id);
        items.push({
          id,
          name: row.name || row.email || '',
          platform: row.platform || '',
          type: row.type || '',
        });
      }

      if (!rows.length || rows.length < pageSize) break;
      page += 1;
      if (page > 500) break;
      await sleep(80);
    }
    return items;
  }

  async function queryGrokQuota(accountId) {
    const tz = encodeURIComponent(getTimezone());
    const path = `/admin/grok/accounts/${encodeURIComponent(accountId)}/quota?timezone=${tz}`;
    return apiRequest(path);
  }

  async function deleteAccount(accountId) {
    // 与后台「批量删除」一致：DELETE /api/v1/admin/accounts/{id}
    return apiRequest(`/admin/accounts/${encodeURIComponent(accountId)}`, { method: 'DELETE' });
  }

  function extractProbeErrorText(data, fallback = '') {
    if (data == null) return fallback;
    if (typeof data === 'string') return data;
    const parts = [
      data.probe_error,
      data.error,
      data.message,
      data.msg,
      data.detail,
      data.reason,
    ]
      .filter((x) => x != null && String(x).trim())
      .map((x) => (typeof x === 'string' ? x : (() => { try { return JSON.stringify(x); } catch { return String(x); } })()));
    return parts[0] || fallback;
  }

  /**
   * 判定探测失败：上游 403 / forbidden / GROK_QUOTA_PROBE_UPSTREAM_ERROR 等。
   * 注意：sub2api 可能 HTTP 200 + code=0，但 data 里带 error/probe_error。
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
    const statusCode = Number(
      data?.status_code ??
      snap.status_code ??
      data?.billing?.status_code ??
      0
    );
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

    // 明确的探测错误字段
    const hasProbeError = !!(data?.probe_error || (data?.error && String(data.error).trim()));
    // status_code 非 2xx 也算失败
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

    const reqText =
      req.limit != null && req.remaining != null
        ? `${req.remaining}/${req.limit}`
        : '—';
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

    const note = fail.failed
      ? fail.message
      : (data?.probe_error || '');

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

  function formatNum(n) {
    const x = Number(n);
    if (!Number.isFinite(x)) return String(n);
    if (x >= 1e6) return (x / 1e6).toFixed(x % 1e6 === 0 ? 0 : 1) + 'M';
    if (x >= 1e3) return (x / 1e3).toFixed(x % 1e3 === 0 ? 0 : 1) + 'K';
    return String(x);
  }

  function updateStats() {
    const all = Array.from(results.values());
    const total = all.length;
    const done = all.filter((x) => ['ok', 'err', 'del', 'del_fail'].includes(x.state)).length;
    const ok = all.filter((x) => x.state === 'ok').length;
    const err = all.filter((x) => x.state === 'err' || x.state === 'del_fail' || x.is403).length;
    const del = all.filter((x) => x.state === 'del').length;
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = String(v); };
    set('s2a-st-total', total);
    set('s2a-st-done', done);
    set('s2a-st-ok', ok);
    set('s2a-st-err', err);
    set('s2a-st-del', del);
    const bar = document.getElementById('s2a-progress-bar');
    if (bar) bar.style.width = total ? `${Math.round((done / total) * 100)}%` : '0%';
  }

  function renderTable() {
    const tbody = document.getElementById('s2a-tbody');
    if (!tbody) return;
    const rank = { run: 0, err: 1, del_fail: 2, del: 3, ok: 4, wait: 5 };
    const rows = Array.from(results.values()).sort((a, b) => {
      const ao = rank[a.state] ?? 9;
      const bo = rank[b.state] ?? 9;
      if (ao !== bo) return ao - bo;
      return String(a.id).localeCompare(String(b.id), undefined, { numeric: true });
    });

    tbody.innerHTML = rows.map((r) => {
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
    }).join('');
  }

  function readPanelCfg() {
    const concurrency = Math.max(1, Math.min(20, Number($('#s2a-concurrency')?.value || cfg.concurrency) || 3));
    const delayMs = Math.max(0, Math.min(10000, Number($('#s2a-delay')?.value || cfg.delayMs) || 0));
    const timezone = ($('#s2a-tz')?.value || cfg.timezone || 'Asia/Shanghai').trim();
    const onlyGrok = $('#s2a-only-grok')?.checked !== false;
    const autoDeleteOn403 = $('#s2a-auto-delete-403')?.checked === true;
    const confirmDeleteOn403 = $('#s2a-confirm-delete-403')?.checked !== false;
    cfg = { ...cfg, concurrency, delayMs, timezone, onlyGrok, autoDeleteOn403, confirmDeleteOn403 };
    saveCfg(cfg);
    return cfg;
  }

  async function maybeDeleteOn403(id, row) {
    if (!cfg.autoDeleteOn403 || !row?.is403) return;
    try {
      await deleteAccount(id);
      row.state = 'del';
      row.deleted = true;
      row.note = `已删除 · ${row.error || row.note || '403'}`;
      log(`#${id} 403 → 已删除`);
    } catch (delErr) {
      row.state = 'del_fail';
      row.deleted = false;
      const msg = delErr.message || String(delErr);
      row.note = `403 且删除失败: ${msg}`;
      row.error = row.note;
      log(`#${id} 403 删除失败: ${msg}`);
    }
  }

  async function startProbe() {
    if (running) return;
    readPanelCfg();

    let ids = parseIdsText($('#s2a-ids')?.value || '');
    if (!ids.length) {
      const selected = collectSelectedFromDom();
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

    const startBtn = $(`#${PANEL_ID} [data-act="start"]`);
    const stopBtn = $(`#${PANEL_ID} [data-act="stop"]`);
    if (startBtn) startBtn.disabled = true;
    if (stopBtn) stopBtn.disabled = false;

    log(
      `开始探测 ${ids.length} 个账号，并发=${cfg.concurrency}，间隔=${cfg.delayMs}ms` +
      (cfg.autoDeleteOn403 ? '，403 自动删除=ON' : '')
    );

    let cursor = 0;
    const workers = Array.from({ length: cfg.concurrency }, async () => {
      while (!abortFlag) {
        const i = cursor++;
        if (i >= ids.length) break;
        const id = ids[i];
        const row = results.get(id);
        if (!row) continue;
        row.state = 'run';
        renderTable();
        updateStats();

        try {
          if (cfg.delayMs > 0) await sleep(cfg.delayMs);
          const data = await queryGrokQuota(id);
          const sum = summarizeQuota(data);
          Object.assign(row, sum, {
            name: row.name || accountMeta.get(id)?.name || '',
          });

          if (!sum.ok) {
            row.state = 'err';
            row.error = sum.error || sum.note || '探测失败';
            row.note = row.error;
            log(`#${id} FAIL${sum.is403 ? ' 403' : ''} ${row.error}`);
            if (sum.is403) await maybeDeleteOn403(id, row);
          } else {
            row.state = 'ok';
            row.note = sum.note || (sum.headersObserved ? sum.model || sum.source : '无 header 观察');
            log(`#${id} OK  req ${sum.reqText}  tok ${sum.tokText}`);
          }
        } catch (err) {
          const fail = classifyProbeFailure(null, err);
          row.state = 'err';
          row.is403 = fail.is403;
          row.statusCode = fail.statusCode;
          row.error = fail.message || err.message || String(err);
          row.note = row.error;
          log(`#${id} FAIL${fail.is403 ? ' 403' : ''} ${row.error}`);
          if (fail.is403) await maybeDeleteOn403(id, row);
        }
        renderTable();
        updateStats();
      }
    });

    await Promise.all(workers);
    running = false;
    if (startBtn) startBtn.disabled = false;
    if (stopBtn) stopBtn.disabled = true;
    const deleted = Array.from(results.values()).filter((r) => r.state === 'del').length;
    const failed403 = Array.from(results.values()).filter((r) => r.is403).length;
    log(
      abortFlag
        ? '已停止'
        : `全部完成 · 403=${failed403} · 已删=${deleted}`
    );
  }

  function exportCsv() {
    const rows = Array.from(results.values());
    if (!rows.length) {
      alert('没有可导出的结果');
      return;
    }
    const header = ['id', 'name', 'state', 'is403', 'deleted', 'requests', 'tokens', 'billing', 'exhausted', 'note', 'error'];
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
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `grok-quota-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    log(`已导出 CSV ${rows.length} 行`);
  }

  async function copySummary() {
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
      log('摘要已复制到剪贴板');
    } catch (_) {
      prompt('复制以下内容：', text);
    }
  }

  function refreshSelectionCount() {
    try {
      const n = collectSelectedFromDom().length;
      const info = $('#s2a-sel-info');
      if (info && !running) info.textContent = n ? `页面已勾选 ${n} 个` : '未选择（可点读取勾选）';
    } catch (_) {}
  }

  function tryInjectBulkBarButton() {
    if (!cfg.autoInjectBar) return;

    // Prefer toolbar near 「添加账号」/「更多操作」
    const injectNear = (id, label, onClick, classHint) => {
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
      btn.className = classHint || anchors[0].className || '';
      btn.textContent = label;
      btn.style.marginLeft = '6px';
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        onClick();
      });
      host.appendChild(btn);
      return true;
    };

    injectNear('s2a-grok-quota-bar-btn', '批量额度探测', () => {
      openPanel();
      const items = collectSelectedFromDom();
      if (items.length) {
        fillIds(items);
        log(`已从批量栏读取勾选 ${items.length} 个`);
      }
    });

    injectNear('s2a-grok-forbidden-bar-btn', '读取本页 forbidden', () => {
      openPanel();
      const items = collectForbiddenFromDom();
      fillIds(items);
      log(`本页 forbidden：${items.length} 个`);
      if (!items.length) alert('当前页未找到 forbidden 账号');
    }, 'btn btn-secondary btn-sm');
  }

  function isAccountsPage() {
    return /\/admin\/accounts\b/.test(location.pathname);
  }

  function boot() {
    injectStyle();
    if (isAccountsPage()) {
      ensureFab();
      tryInjectBulkBarButton();
    }
    // SPA route changes
    const mo = new MutationObserver(() => {
      if (isAccountsPage()) {
        ensureFab();
        tryInjectBulkBarButton();
      }
    });
    mo.observe(document.documentElement, { childList: true, subtree: true });

    // re-check selection periodically while panel open
    setInterval(() => {
      if (document.getElementById(PANEL_ID)) refreshSelectionCount();
      if (isAccountsPage()) tryInjectBulkBarButton();
    }, 2000);

    // hotkey: Alt+Q
    window.addEventListener('keydown', (e) => {
      if (e.altKey && (e.key === 'q' || e.key === 'Q')) {
        e.preventDefault();
        if (document.getElementById(PANEL_ID)) closePanel();
        else openPanel();
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
