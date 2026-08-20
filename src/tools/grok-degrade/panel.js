  // --- Grok degrade panel ---
  (function (S2A) {
    const G = (S2A.tools['grok-degrade'] = S2A.tools['grok-degrade'] || {});
    const { $, esc, parseIdsText } = S2A.util;

    const TOOL_ID = 'grok-degrade';
    const PREFIX = 's2a-tool-grok-degrade';

    const DEFAULT_CFG = {
      concurrency: 3,
      delayMs: 200,
      timezone: 'Asia/Shanghai',
      onlyGrok: true,
      timeoutMs: 15000,
      ssoText: '',
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
          <button type="button" class="s2a-btn s2a-btn-secondary" data-act="read-selected">读取勾选</button>
          <button type="button" class="s2a-btn s2a-btn-secondary" data-act="read-page">读取本页</button>
          <button type="button" class="s2a-btn s2a-btn-secondary" data-act="read-all-pages">拉取全部(API)</button>
          <span class="s2a-muted" id="${PREFIX}-sel-info">未选择</span>
        </div>
        <div class="s2a-row">
          <label class="s2a-lbl"><input type="checkbox" id="${PREFIX}-only-grok" ${cfg.onlyGrok !== false ? 'checked' : ''}> 仅 Grok</label>
          <label class="s2a-lbl">并发 <input type="number" id="${PREFIX}-concurrency" min="1" max="20" value="${esc(cfg.concurrency)}"></label>
          <label class="s2a-lbl">间隔ms <input type="number" id="${PREFIX}-delay" min="0" max="10000" value="${esc(cfg.delayMs)}"></label>
          <label class="s2a-lbl">时区 <input type="text" id="${PREFIX}-tz" value="${esc(cfg.timezone)}" style="width:120px"></label>
        </div>
        <div class="s2a-row">
          <label class="s2a-lbl">超时ms <input type="number" id="${PREFIX}-timeout" min="3000" max="60000" value="${esc(cfg.timeoutMs || 15000)}" style="width:80px"></label>
        </div>
        <div class="s2a-muted" style="margin-bottom:8px">
          按 openai-cpa：用 SSO 请求 https://grok.com/ 解析 botFlagSource；botFlagSource != 0 即已降智。API 拿不到 SSO 时按 ID----sso 填。
        </div>
        <div class="s2a-row" style="margin-bottom:6px">
          <label class="s2a-lbl" style="flex:1">SSO 清单 <textarea id="${PREFIX}-sso" rows="2" style="width:100%; min-height:46px" placeholder="账号ID----sso，每行一个；也可只填 ID，脚本尝试从 API 详情取 sso。">${esc(cfg.ssoText || '')}</textarea></label>
        </div>
        <textarea id="${PREFIX}-ids" placeholder="账号 ID，每行一个。建议先点「读取勾选」或「读取本页」。&#10;示例：&#10;7752&#10;7753"></textarea>
        <div class="s2a-row">
          <button type="button" class="s2a-btn s2a-btn-primary" data-act="start">开始检测</button>
          <button type="button" class="s2a-btn s2a-btn-secondary" data-act="stop" disabled>停止</button>
          <button type="button" class="s2a-btn s2a-btn-secondary" data-act="export">导出 CSV</button>
          <button type="button" class="s2a-btn s2a-btn-ok" data-act="copy-summary">复制摘要</button>
        </div>
        <div class="s2a-stats" style="grid-template-columns: repeat(5, 1fr)">
          <div class="s2a-stat"><b id="${PREFIX}-st-total">0</b><span>总数</span></div>
          <div class="s2a-stat"><b id="${PREFIX}-st-done">0</b><span>完成</span></div>
          <div class="s2a-stat"><b id="${PREFIX}-st-degraded">0</b><span>降智</span></div>
          <div class="s2a-stat"><b id="${PREFIX}-st-ok">0</b><span>正常</span></div>
          <div class="s2a-stat"><b id="${PREFIX}-st-err">0</b><span>失败/未知</span></div>
        </div>
        <div class="s2a-progress"><i id="${PREFIX}-progress-bar"></i></div>
        <div class="s2a-table-wrap">
          <table>
            <thead>
              <tr>
                <th>ID</th>
                <th>名称</th>
                <th>结果</th>
                <th>botFlag</th>
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
            sso: it.sso || it.sso_token || '',
            ssoSource: it.sso ? 'user input' : (it.sso_token ? 'user input' : ''),
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
        const done = all.filter((x) => ['ok', 'degraded', 'err', 'unknown'].includes(x.state)).length;
        const degraded = all.filter((x) => x.state === 'degraded').length;
        const ok = all.filter((x) => x.state === 'ok').length;
        const err = all.filter((x) => x.state === 'err' || x.state === 'unknown').length;
        const set = (id, v) => {
          const el = document.getElementById(id);
          if (el) el.textContent = String(v);
        };
        set(`${PREFIX}-st-total`, total);
        set(`${PREFIX}-st-done`, done);
        set(`${PREFIX}-st-degraded`, degraded);
        set(`${PREFIX}-st-ok`, ok);
        set(`${PREFIX}-st-err`, err);
        const bar = document.getElementById(`${PREFIX}-progress-bar`);
        if (bar) bar.style.width = total ? `${Math.round((done / total) * 100)}%` : '0%';
      }

      function renderTable() {
        const tbody = document.getElementById(`${PREFIX}-tbody`);
        if (!tbody) return;
        const rank = { run: 0, degraded: 1, unknown: 2, err: 3, ok: 4, wait: 5 };
        const rows = Array.from(results.values()).sort((a, b) => {
          const ao = rank[a.state] ?? 9;
          const bo = rank[b.state] ?? 9;
          if (ao !== bo) return ao - bo;
          return String(a.id).localeCompare(String(b.id), undefined, { numeric: true });
        });

        tbody.innerHTML = rows
          .map((r) => {
            let tag;
            if (r.state === 'degraded') tag = `<span class="s2a-tag bad">降智</span>`;
            else if (r.state === 'ok') tag = `<span class="s2a-tag ok">正常</span>`;
            else if (r.state === 'unknown') tag = `<span class="s2a-tag warn">未知</span>`;
            else if (r.state === 'err') tag = `<span class="s2a-tag bad">${r.is403 ? '403' : '失败'}</span>`;
            else if (r.state === 'run') tag = `<span class="s2a-tag run">检测中</span>`;
            else tag = `<span class="s2a-tag warn">等待</span>`;
            const rowCls = r.state === 'degraded' || r.state === 'err' ? 'err' : r.state;
            return `<tr class="${esc(rowCls)}">
              <td>${esc(r.id)}</td>
              <td>${esc(r.name || '—')}</td>
              <td>${tag}</td>
              <td class="s2a-muted">${esc(r.botFlagSource != null ? String(r.botFlagSource) : (r.sso ? `bfs?` : '无SSO'))}</td>
              <td class="s2a-muted">${esc(r.note || r.error || '')}</td>
            </tr>`;
          })
          .join('');
      }

      function readPanelCfg() {
        const concurrency = Math.max(1, Math.min(20, Number($(`#${PREFIX}-concurrency`, root)?.value || cfg.concurrency) || 3));
        const delayMs = Math.max(0, Math.min(10000, Number($(`#${PREFIX}-delay`, root)?.value || cfg.delayMs) || 0));
        const timezone = ($(`#${PREFIX}-tz`, root)?.value || cfg.timezone || 'Asia/Shanghai').trim();
        const onlyGrok = $(`#${PREFIX}-only-grok`, root)?.checked !== false;
        const timeoutMs = Math.max(3000, Math.min(60000, Number($(`#${PREFIX}-timeout`, root)?.value || cfg.timeoutMs || 15000) || 15000));
        const ssoText = $(`#${PREFIX}-sso`, root)?.value || cfg.ssoText || '';
        cfg = { ...cfg, concurrency, delayMs, timezone, onlyGrok, timeoutMs, ssoText };
        saveCfg(cfg);
        return cfg;
      }

      function onlyGrokChecked() {
        return $(`#${PREFIX}-only-grok`, root)?.checked !== false;
      }

      function collectOpts() {
        return { onlyGrok: onlyGrokChecked(), panelRoot: root };
      }

      async function doStartCheck() {
        if (running) return;
        readPanelCfg();

        let ids = parseIdsText($(`#${PREFIX}-ids`, root)?.value || '');
        // 兼容 ID----sso 输入，同时单独支持 SSO 清单。
        const ssoLines = String($(`#${PREFIX}-sso`, root)?.value || cfg.ssoText || '')
          .split(/\r?\n/)
          .map((x) => x.trim())
          .filter(Boolean);
        const ssoById = new Map();
        for (const line of ssoLines) {
          const parts = line.split(/\s*\|\s*|\s*,\s*|\s*;\s*|\s*----\s*/);
          if (parts.length >= 2 && /^\d+$/.test(parts[0])) {
            ssoById.set(parts[0].trim(), parts.slice(1).join(',').trim());
          }
        }
        if (ssoById.size) {
          const merged = [];
          if (!ids.length) ids = Array.from(ssoById.keys());
          for (const i of ids) {
            merged.push(i);
            if (!accountMeta.get(i)) accountMeta.set(i, { id: i, name: '' });
            if (ssoById.get(i)) {
              accountMeta.get(i).sso = ssoById.get(i);
              accountMeta.get(i).ssoSource = 'user input';
            }
          }
          ids = merged;
        }
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

        running = true;
        abortFlag = false;
        results.clear();
        for (const id of ids) {
          const meta = accountMeta.get(id) || {};
          results.set(id, {
            id,
            name: meta.name || '',
            state: 'wait',
            model: '',
            degraded: '',
            note: '',
            error: '',
            is403: false,
          });
        }
        updateStats();
        renderTable();

        const startBtn = root.querySelector('[data-act="start"]');
        const stopBtn = root.querySelector('[data-act="stop"]');
        if (startBtn) startBtn.disabled = true;
        if (stopBtn) stopBtn.disabled = false;

        const runCfg = {
          ...cfg,
          fetchDetail: true,
          timeoutMs: Number(cfg.timeoutMs || 15000),
        };

        log(`开始检测 ${ids.length} 个账号，并发=${cfg.concurrency}，间隔=${cfg.delayMs}ms`);

        const job = G.startCheck({
          ids,
          accountMeta,
          results,
          cfg: runCfg,
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
        const degraded = Array.from(results.values()).filter((r) => r.state === 'degraded').length;
        const ok = Array.from(results.values()).filter((r) => r.state === 'ok').length;
        log(abortFlag ? '已停止' : `全部完成 · 降智=${degraded} · 正常=${ok}`);
      }

      function refreshSelectionCount() {
        try {
          const items = S2A.domAccounts.collectSelectedFromDom(collectOpts());
          const info = $(`#${PREFIX}-sel-info`, root);
          if (info && !$(`#${PREFIX}-ids`, root)?.value?.trim()) {
            info.textContent = items.length ? `勾选 ${items.length} 个` : '未选择';
          }
        } catch (_) {}
      }

      const onClick = async (e) => {
        const btn = e.target.closest('[data-act]');
        if (!btn) return;
        const act = btn.getAttribute('data-act');
        if (act === 'read-selected') {
          const items = S2A.domAccounts.collectSelectedFromDom(collectOpts());
          fillIds(items);
          log(`读取勾选：${items.length} 个`);
          if (!items.length) alert('未勾选任何账号');
          return;
        }
        if (act === 'read-page') {
          const items = S2A.domAccounts.collectPageAccountsFromDom(collectOpts());
          fillIds(items);
          log(`读取本页：${items.length} 个`);
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
        if (act === 'start') return doStartCheck();
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

      G._activeSession = {
        fillIds,
        log,
        startCheck: doStartCheck,
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
        startCheck: doStartCheck,
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
