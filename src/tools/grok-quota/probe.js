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

