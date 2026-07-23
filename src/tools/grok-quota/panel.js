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

