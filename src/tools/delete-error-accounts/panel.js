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
