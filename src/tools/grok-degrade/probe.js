  // --- Grok degrade probe (openai-cpa botFlag logic) ---
  // 参考 openai-cpa: 注册后拿 SSO 请求 https://grok.com/，解析 botFlagSource
  // 和 botFlagDetails。botFlagSource != 0 表示账号已降智，policy=deny 表示被拒死号。
  (function (S2A) {
    const G = (S2A.tools['grok-degrade'] = S2A.tools['grok-degrade'] || {});
    const { sleep } = S2A.util;

    function extractAccountSso(raw) {
      const candidates = [];
      function walk(value, depth) {
        if (!value || depth > 8) return;
        if (typeof value === 'string') {
          if (/^(sso=)?eyJ/i.test(value)) candidates.push(value.replace(/^sso=/i, '').trim());
          return;
        }
        if (Array.isArray(value)) {
          for (const item of value) walk(item, depth + 1);
          return;
        }
        if (typeof value === 'object') {
          for (const [key, item] of Object.entries(value)) {
            const k = String(key || '').toLowerCase();
            if (k === 'sso' || k === 'sso_token' || k === 'ssotoken' || k === 'sso_tokens') {
              if (Array.isArray(item)) {
                for (const token of item) walk(token, depth + 1);
              } else {
                walk(item, depth + 1);
              }
            } else {
              walk(item, depth + 1);
            }
          }
        }
      }
      walk(raw, 0);
      return candidates.find((x) => x && x.trim()) || '';
    }

    async function fetchAccountDetail(accountId) {
      const paths = [
        `/admin/grok/accounts/${encodeURIComponent(accountId)}`,
        `/admin/accounts/${encodeURIComponent(accountId)}`,
        `/admin/grok/accounts/${encodeURIComponent(accountId)}/detail`,
        `/admin/accounts/${encodeURIComponent(accountId)}/detail`,
      ];
      for (const path of paths) {
        try {
          const data = await S2A.api.apiRequest(path);
          const sso = extractAccountSso(data);
          if (sso) return { sso, source: path };
        } catch (_) {}
      }
      return { sso: '', source: '' };
    }

    function normalizeSso(value) {
      let sso = String(value || '')
        .trim()
        .replace(/^["']+|["']+$/g, '');
      if (sso.startsWith('sso=')) sso = sso.slice(4);
      return sso.trim();
    }

    function parseGrokState(htmlText) {
      const raw = String(htmlText || '');
      const result = {
        found: false,
        botFlagSource: null,
        botFlagDetails: '',
        details: {},
        policy: '',
        event: '',
        risk: null,
        denied: false,
        cloudflare: false,
        ssoInvalid: false,
        error: '',
      };

      if (/Just a moment|cf-browser-verification|cf-turnstile/i.test(raw)) {
        result.cloudflare = true;
        result.error = '被 CF 拦截';
        return result;
      }
      if (/Sign in to xAI|sign in/i.test(raw)) {
        result.ssoInvalid = true;
        result.error = 'SSO 无效';
        return result;
      }

      const normalized = raw.replace(/\\"/g, '"');
      const sourceMatch = normalized.match(/botFlagSource"\s*:\s*(null|-?\d+|"[^"]*")/);
      const detailsMatch = normalized.match(/botFlagDetails"\s*:\s*(?:null|"([^"]*)")/);

      if (sourceMatch && sourceMatch[1] !== 'null') {
        let rawSource = sourceMatch[1].replace(/^"|"$/g, '');
        const numSource = Number(rawSource);
        result.botFlagSource = Number.isFinite(numSource) ? numSource : rawSource;
      }

      const detailsRaw = detailsMatch && detailsMatch[1] ? detailsMatch[1] : '';
      result.botFlagDetails = detailsRaw;

      const detailFields = {};
      for (const item of detailsRaw.split(',')) {
        const sep = item.indexOf('=');
        if (sep > 0) {
          const key = item.slice(0, sep).trim().toLowerCase();
          const value = item.slice(sep + 1).trim();
          if (key) detailFields[key] = value;
        }
      }
      result.details = detailFields;
      if (detailFields.risk) {
        const risk = Number(detailFields.risk);
        result.risk = Number.isFinite(risk) ? risk : null;
      }
      result.policy = String(detailFields.policy || '').toLowerCase();
      result.event = String(detailFields.event || '');
      result.denied = result.policy === 'deny' && result.event === '$registration';
      result.found = sourceMatch !== null || detailsMatch !== null;
      if (!result.found) result.error = '未找到 botFlag 字段';
      return result;
    }

    async function fetchGrokHome(sso, opts = {}) {
      const url = 'https://grok.com/';
      const headers = {
        'Accept': 'text/html,application/json',
        'User-Agent': opts.userAgent || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/125.0 Safari/537.36',
        'Cookie': `sso=${sso}; sso-rw=${sso}`,
        ...(opts.headers || {}),
      };
      if (typeof GM_xmlhttpRequest === 'function') {
        return new Promise((resolve, reject) => {
          GM_xmlhttpRequest({
            method: 'GET',
            url,
            headers,
            timeout: opts.timeout || 15000,
            onload(resp) {
              resolve({ status: resp.status, text: resp.responseText || '' });
            },
            onerror: () => reject(new Error('grok.com 请求失败')),
            ontimeout: () => reject(new Error('grok.com 请求超时')),
          });
        });
      }
      const resp = await fetch(url, { method: 'GET', headers, redirect: 'follow' });
      const text = await resp.text();
      return { status: resp.status, text };
    }

    function judgeGrokState(state, ssoOk) {
      if (!ssoOk) {
        return { degraded: 'no', state: 'err', reason: '缺少 SSO，无法按 openai-cpa 校验 botFlag' };
      }
      if (state.cloudflare) {
        return { degraded: 'unknown', state: 'err', reason: `CF 拦截，需更换检测代理：${state.error}` };
      }
      if (state.ssoInvalid) {
        return { degraded: 'yes', state: 'degraded', reason: `SSO 无效/已死：${state.error}` };
      }
      if (state.denied) {
        return { degraded: 'yes', state: 'degraded', reason: `风控拒绝死号（${state.policy}/${state.event}）` };
      }
      if (state.found) {
        if (state.botFlagSource === 0) {
          return { degraded: 'no', state: 'ok', reason: '账号智商正常 (botFlagSource=0)' };
        }
        const detail = state.botFlagDetails ? ` ${state.botFlagDetails}` : '';
        return {
          degraded: 'yes',
          state: 'degraded',
          reason: `账号已降智(bfs=${state.botFlagSource})${detail}，可能需更换IP`,
        };
      }
      return { degraded: 'unknown', state: 'err', reason: state.error || '未找到 botFlag 字段' };
    }

    async function startCheck(opts) {
      const { ids, accountMeta, results, cfg, log, onUpdate, getAbort } = opts;
      let cursor = 0;
      const workers = Array.from({ length: cfg.concurrency || 1 }, async () => {
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
            let sso = row.sso || accountMeta.get(id)?.sso || '';
            let ssoSource = row.ssoSource || accountMeta.get(id)?.ssoSource || '';
            if (!sso && cfg.fetchDetail !== false) {
              const detail = await fetchAccountDetail(id);
              sso = sso || detail.sso;
              ssoSource = detail.source || 'API详情';
              if (sso) {
                accountMeta.get(id).sso = sso;
                accountMeta.get(id).ssoSource = ssoSource;
              }
            }
            row.sso = sso;
            row.ssoSource = ssoSource || (sso ? 'user input' : '');

            if (!sso) {
              row.probeState = 'no_sso';
              row.judgeReason = '缺少 SSO，可手动填 ID----sso 或从 API 详情获取';
              row.degraded = 'unknown';
              row.state = 'err';
              row.error = row.judgeReason;
              row.note = row.error;
              if (log) log(`#${id} 缺 SSO（未从 API/DOM 拿到）`);
            } else {
              const fetched = await fetchGrokHome(sso, { timeout: cfg.timeoutMs || 15000 });
              if (fetched.status >= 400) {
                row.state = 'err';
                row.probeState = 'http_error';
                row.probeReason = `grok.com HTTP ${fetched.status}`;
                row.degraded = 'unknown';
                row.error = row.probeReason;
                row.note = row.error;
                if (log) log(`#${id} grok.com HTTP ${fetched.status}`);
              } else {
                const state = parseGrokState(fetched.text);
                row.probeState = state.found ? 'parsed' : 'unparsed';
                row.botFlagSource = state.botFlagSource;
                row.botFlagDetails = state.botFlagDetails;
                row.botFlagRisk = state.risk;
                row.botFlagDenied = state.denied;
                const j = judgeGrokState(state, true);
                row.degraded = j.degraded;
                row.probeReason = j.reason;
                if (j.state === 'degraded') {
                  row.state = 'degraded';
                  row.note = `疑似降智：${j.reason}`;
                  if (log) log(`#${id} 降智（botFlagSource=${state.botFlagSource ?? ''}）`);
                } else if (j.state === 'ok') {
                  row.state = 'ok';
                  row.note = `正常：${j.reason}`;
                  if (log) log(`#${id} 正常（botFlagSource=${state.botFlagSource ?? ''}）`);
                } else {
                  row.state = 'err';
                  row.error = j.reason;
                  row.note = row.error;
                  if (log) log(`#${id} FAIL ${j.reason}`);
                }
              }
            }
          } catch (err) {
            row.state = 'err';
            row.error = String(err.message || err);
            row.note = row.error;
            if (log) log(`#${id} ERR ${row.error}`);
          }
          if (onUpdate) onUpdate();
        }
      });

      return { done: Promise.all(workers).then(() => {}) };
    }

    G.extractAccountSso = extractAccountSso;
    G.fetchAccountDetail = fetchAccountDetail;
    
    G.parseGrokState = parseGrokState;
    G.fetchGrokHome = fetchGrokHome;
    G.judgeGrokState = judgeGrokState;
    G.startCheck = startCheck;
  })(S2A);
