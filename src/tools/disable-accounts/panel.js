// --- Disable accounts panel ---
(function (S2A) {
  const T = (S2A.tools['disable-accounts'] = S2A.tools['disable-accounts'] || {});
  const { $, esc, parseIdsText } = S2A.util;

  const TOOL_ID = 'disable-accounts';
  const PREFIX = 's2a-tool-dis-';

  const DEFAULT_CFG = {
    concurrency: 50,
    delayMs: 0,
    onlyGrok: false,
    requireConfirm: true,
    timezone: 'Asia/Shanghai',
    configVersion: 3,
  };

  function loadCfg() {
    const stored = S2A.storage.getToolCfg(TOOL_ID, {});
    const cfg = { ...DEFAULT_CFG, ...stored };
    // Upgrade prior shipped defaults without overriding a user-selected setting.
    if (
      (!stored.configVersion && stored.concurrency === 3 && stored.delayMs === 200) ||
      (stored.configVersion === 2 && stored.concurrency === 20 && stored.delayMs === 0)
    ) {
      cfg.concurrency = DEFAULT_CFG.concurrency;
      cfg.delayMs = DEFAULT_CFG.delayMs;
      cfg.configVersion = DEFAULT_CFG.configVersion;
      S2A.storage.setToolCfg(TOOL_ID, cfg);
    }
    return cfg;
  }

  function saveCfg(cfg) {
    S2A.storage.setToolCfg(TOOL_ID, cfg);
  }

  function mount(hostEl) {
    let cfg = loadCfg();
    let running = false;
    let abortFlag = false;
    let runStartedAt = 0;
    let runCfg = null;
    let progress = { total: 0, done: 0, ok: 0, err: 0 };
    const results = new Map();
    const accountMeta = new Map();

    const root = document.createElement('div');
    root.id = `${PREFIX}-root`;
    root.innerHTML = `
      <div class="s2a-row">
        <button type="button" class="s2a-btn s2a-btn-danger" data-act="read-disabled" title="扫描当前页「状态」列为「停用」的账号">读取本页停用</button>
        <button type="button" class="s2a-btn s2a-btn-secondary" data-act="read-selected">读取勾选</button>
        <button type="button" class="s2a-btn s2a-btn-secondary" data-act="read-page">读取本页</button>
        <button type="button" class="s2a-btn s2a-btn-secondary" data-act="read-all-disabled" title="分页拉取账号列表，按状态筛选停用（兼容服务端无 status 过滤时的客户端筛选）">拉取全部停用(API)</button>
        <span class="s2a-muted" id="${PREFIX}-sel-info">未选择</span>
      </div>
      <div class="s2a-row">
        <label class="s2a-lbl"><input type="checkbox" id="${PREFIX}-only-grok" ${cfg.onlyGrok ? 'checked' : ''}> 仅 Grok</label>
        <label class="s2a-lbl">并发 <input type="number" id="${PREFIX}-concurrency" min="1" max="200" value="${esc(cfg.concurrency)}"></label>
        <label class="s2a-lbl">间隔ms <input type="number" id="${PREFIX}-delay" min="0" max="10000" value="${esc(cfg.delayMs)}"></label>
        <label class="s2a-lbl"><input type="checkbox" id="${PREFIX}-confirm" ${cfg.requireConfirm !== false ? 'checked' : ''}> 删除前确认</label>
      </div>
      <div class="s2a-muted" style="margin-bottom:8px">
        匹配状态列标签「停用」/ disabled / inactive。运行中仅显示删除中和失败项以保持批量删除速度。删除调用 DELETE /admin/accounts/{id}，不可恢复，请确认后再执行。
      </div>
      <textarea id="${PREFIX}-ids" placeholder="账号 ID，每行一个。建议先点「读取本页停用」。&#10;示例：&#10;7752&#10;7753"></textarea>
      <div class="s2a-row" style="margin-top:8px">
        <button type="button" class="s2a-btn s2a-btn-danger" data-act="start">开始删除</button>
        <button type="button" class="s2a-btn s2a-btn-secondary" data-act="stop" disabled>停止</button>
        <button type="button" class="s2a-btn s2a-btn-secondary" data-act="export">导出 CSV</button>
        <button type="button" class="s2a-btn s2a-btn-ok" data-act="copy-summary">复制摘要</button>
      </div>
      <div class="s2a-stats" style="grid-template-columns: repeat(5, 1fr)">
        <div class="s2a-stat"><b id="${PREFIX}-st-total">0</b><span>总数</span></div>
        <div class="s2a-stat"><b id="${PREFIX}-st-done">0</b><span>完成</span></div>
        <div class="s2a-stat"><b id="${PREFIX}-st-ok">0</b><span>已删</span></div>
        <div class="s2a-stat"><b id="${PREFIX}-st-err">0</b><span>失败</span></div>
        <div class="s2a-stat"><b id="${PREFIX}-st-eta">—</b><span>预计剩余</span></div>
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
      accountMeta.clear();
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
      const { total, done, ok, err } = progress;
      const set = (id, v) => {
        const el = document.getElementById(id);
        if (el) el.textContent = String(v);
      };
      set(`${PREFIX}-st-total`, total);
      set(`${PREFIX}-st-done`, done);
      set(`${PREFIX}-st-ok`, ok);
      set(`${PREFIX}-st-err`, err);
      const etaEl = document.getElementById(`${PREFIX}-st-eta`);
      if (etaEl) etaEl.textContent = getEtaText(total, done);
      const bar = document.getElementById(`${PREFIX}-progress-bar`);
      if (bar) bar.style.width = total ? `${Math.round((done / total) * 100)}%` : '0%';
    }

    function formatDuration(seconds) {
      const totalSeconds = Math.max(0, Math.ceil(seconds));
      const hours = Math.floor(totalSeconds / 3600);
      const minutes = Math.floor((totalSeconds % 3600) / 60);
      const secs = totalSeconds % 60;
      if (hours) return `${hours}小时${minutes}分`;
      if (minutes) return `${minutes}分${secs}秒`;
      return `${secs}秒`;
    }

    function getEtaText(total, done) {
      if (!running || !runCfg || !total) return '—';
      if (done >= total) return '已完成';

      const remaining = total - done;
      if (done > 0) {
        const elapsedSeconds = (Date.now() - runStartedAt) / 1000;
        return `约${formatDuration((elapsedSeconds / done) * remaining)}`;
      }

      // Show an initial estimate until the first delete request completes.
      const requestSeconds = Math.max(0.5, runCfg.delayMs / 1000 + 0.5);
      return `约${formatDuration((Math.ceil(total / runCfg.concurrency) * requestSeconds))}`;
    }

    function renderTable() {
      const tbody = document.getElementById(`${PREFIX}-tbody`);
      if (!tbody) return;
      const rank = { run: 0, del_fail: 1, del: 2, wait: 3 };
      const sourceRows = running
        ? Array.from(results.values()).filter((r) => r.state === 'run' || r.state === 'del_fail')
        : Array.from(results.values());
      const rows = sourceRows.sort((a, b) => {
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
            <td>${esc(r.statusText || r.statusType || '停用')}</td>
            <td class="s2a-muted">${esc(r.note || r.error || '')}</td>
          </tr>`;
        })
        .join('');
    }

    function readPanelCfg() {
      const concurrency = Math.max(
        1,
        Math.min(200, Number($(`#${PREFIX}-concurrency`, root)?.value || cfg.concurrency) || 50)
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
        statuses: ['disabled'],
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
        alert('请先读取本页停用账号，或手动填入账号 ID');
        return;
      }

      const tip =
        `即将删除 ${ids.length} 个账号（状态筛选为「停用」装载，最终以 ID 列表为准）。\n\n` +
        `操作不可恢复：DELETE /admin/accounts/{id}\n\n是否继续？`;
      if (cfg.requireConfirm && !confirm(tip)) {
        log('已取消删除');
        return;
      }

      running = true;
      abortFlag = false;
      runStartedAt = Date.now();
      runCfg = { ...cfg };
      results.clear();
      progress = { total: ids.length, done: 0, ok: 0, err: 0 };
      for (const id of ids) {
        const meta = accountMeta.get(id) || {};
        results.set(id, {
          id,
          name: meta.name || '',
          state: 'wait',
          statusType: meta.statusType || 'disabled',
          statusText: meta.statusText || '停用',
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

      const etaTimer = setInterval(updateStats, 1000);

      let renderTimer = null;
      let renderPending = false;
      const flushRender = () => {
        if (renderTimer) {
          clearTimeout(renderTimer);
          renderTimer = null;
        }
        renderPending = false;
        renderTable();
        updateStats();
      };
      const scheduleRender = (nextProgress) => {
        if (nextProgress) progress = nextProgress;
        updateStats();
        renderPending = true;
        if (renderTimer) return;
        renderTimer = setTimeout(flushRender, 500);
      };

      const job = T.startDelete({
        ids,
        accountMeta,
        results,
        cfg,
        log,
        onProgress: scheduleRender,
        getAbort: () => abortFlag,
      });

      await job.done;
      clearInterval(etaTimer);
      if (renderPending || renderTimer) flushRender();
      running = false;
      updateStats();
      if (startBtn) startBtn.disabled = false;
      if (stopBtn) stopBtn.disabled = true;
      const deleted = progress.ok;
      const failed = progress.err;
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
        `disable-accounts-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.csv`
      );
      log(`已导出 CSV ${rows.length} 行`);
    }

    function copySummary() {
      const rows = Array.from(results.values());
      const del = rows.filter((r) => r.state === 'del');
      const fail = rows.filter((r) => r.state === 'del_fail');
      const lines = [
        `批量删除停用账号摘要 ${new Date().toLocaleString()}`,
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
        navigator.clipboard.writeText(text);
        log('摘要已复制到剪贴板');
      } catch (_) {
        prompt('复制以下内容：', text);
      }
    }

    const onClick = async (e) => {
      const btn = e.target.closest('[data-act]');
      if (!btn || !root.contains(btn)) return;
      const act = btn.getAttribute('data-act');

      if (act === 'read-disabled') {
        const items = S2A.domAccounts.collectByStatusFromDom(collectOpts());
        fillIds(items);
        log(`本页停用账号：${items.length} 个` + (items.length ? ` → ${items.map((x) => x.id).join(',')}` : ''));
        if (!items.length) alert('当前页未找到状态为「停用」的账号');
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
      if (act === 'read-all-disabled') {
        btn.disabled = true;
        try {
          const onlyGrok = onlyGrokChecked();
          let items = await S2A.domAccounts.fetchAllAccountIdsFromApi({
            onlyGrok,
            timezone: cfg.timezone,
            status: 'disabled',
            statuses: ['disabled'],
          });
          if (!items.length) {
            items = await S2A.domAccounts.fetchAllAccountIdsFromApi({
              onlyGrok,
              timezone: cfg.timezone,
              statuses: ['disabled'],
            });
          }
          fillIds(items);
          log(`API 拉取停用账号：${items.length} 个`);
          if (!items.length) {
            alert('API 未筛出停用账号。可能后端 status 字段与 UI 不一致。\n请改用「读取本页停用」并翻页处理。');
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
