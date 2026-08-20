  // --- Grok degrade (降智) probe ---
  // 复用 /admin/grok/accounts/{id}/quota 返回数据，判定账号是否被「降智」。
  // 「降智」定义：账号生效/可用的模型不再是期望的高级模型（默认关键字 grok-4），
  // 而被静默降级为低级模型（如 grok-3 / mini），或未观察到高级模型授权。
  (function (S2A) {
    const G = (S2A.tools['grok-degrade'] = S2A.tools['grok-degrade'] || {});
    const { sleep } = S2A.util;

    function quotaTool() {
      return S2A.tools['grok-quota'] || {};
    }

    async function queryGrokQuota(accountId, timezone) {
      const q = quotaTool();
      if (typeof q.queryGrokQuota === 'function') {
        return q.queryGrokQuota(accountId, timezone);
      }
      const tz = encodeURIComponent(timezone || 'Asia/Shanghai');
      const path = `/admin/grok/accounts/${encodeURIComponent(accountId)}/quota?timezone=${tz}`;
      return S2A.api.apiRequest(path);
    }

    function summarizeQuota(data) {
      const q = quotaTool();
      if (typeof q.summarizeQuota === 'function') return q.summarizeQuota(data);
      return { ok: true, is403: false, model: data?.model || '', source: data?.source || '', raw: data };
    }

    function classifyProbeFailure(data, httpErr) {
      const q = quotaTool();
      if (typeof q.classifyProbeFailure === 'function') return q.classifyProbeFailure(data, httpErr);
      const msg = httpErr ? httpErr.message || String(httpErr) : '';
      const is403 = httpErr ? Number(httpErr.status || 0) === 403 : false;
      return { failed: !!httpErr, is403, statusCode: httpErr?.status || 0, message: msg };
    }

    function collectModelBlob(sum) {
      const raw = sum?.raw || {};
      const snap = raw.snapshot || {};
      const parts = [
        sum?.model,
        sum?.source,
        raw.model,
        raw.active_model,
        raw.current_model,
        raw.default_model,
        raw.entitlement_status,
        snap.model,
        snap.entitlement_status,
        raw.plan,
        raw.tier,
        raw.subscription_tier,
        raw.billing?.period_type,
      ]
        .filter((x) => x != null && String(x).trim())
        .map((x) => String(x));
      return parts.join(' ').toLowerCase();
    }

    // 参考 grok2api / openai-cpa 的降智判定：真正决定是否被降级的是「高级模型配额窗口」，
    // 而非 quota 里的 model/plan 字符串（后者常显示订阅套餐，账号仍会被静默降级）。
    // 判定优先级：
    //   1) 高级模型请求/令牌配额耗尽（remaining<=0 或窗口 limit<=0）→ 降智；
    //   2) 命中降级关键字且未见期望模型 → 降智；
    //   3) 命中期望模型且配额未耗尽 → 正常；
    //   4) 数据缺失 → unknown（可配置视为降智）。
    function judgeDegrade(sum, cfg) {
      const blob = collectModelBlob(sum);
      const expect = (cfg.expectKeywords || []).map((s) => String(s).trim().toLowerCase()).filter(Boolean);
      const degrade = (cfg.degradeKeywords || []).map((s) => String(s).trim().toLowerCase()).filter(Boolean);

      const matchedDegrade = degrade.find((k) => blob.includes(k)) || '';
      const matchedExpect = expect.find((k) => blob.includes(k)) || '';

      // --- 配额信号（grok2api 的核心依据）---
      const reqRemaining = sum?.reqRemaining;
      const reqLimit = sum?.reqLimit;
      const tokRemaining = sum?.tokRemaining;
      const tokLimit = sum?.tokLimit;
      const hasReq = reqRemaining != null && reqLimit != null;
      const hasTok = tokRemaining != null && tokLimit != null;
      const hasQuota = hasReq || hasTok;

      // 高级模型窗口不存在 / 上限为 0：授权中根本没有高级模型 → 视为已降级。
      const noAdvancedWindow =
        (hasReq && Number(reqLimit) <= 0) || (hasTok && Number(tokLimit) <= 0);
      // 配额被打空：remaining<=0，Grok 会静默掉级到低级模型。
      const quotaExhausted =
        sum?.exhausted === true ||
        (reqRemaining != null && Number(reqRemaining) <= 0) ||
        (tokRemaining != null && Number(tokRemaining) <= 0);

      if (noAdvancedWindow) {
        return {
          degraded: 'yes',
          matchedExpect,
          matchedDegrade,
          blob,
          reason: '高级模型配额窗口缺失/上限为 0（未授权高级模型）',
        };
      }
      if (quotaExhausted) {
        return {
          degraded: 'yes',
          matchedExpect,
          matchedDegrade,
          blob,
          reason: `高级模型配额已耗尽（req ${sum?.reqText || '—'} / tok ${sum?.tokText || '—'}）`,
        };
      }

      // --- 关键字兜底 ---
      if (matchedDegrade && !matchedExpect) {
        return {
          degraded: 'yes',
          matchedExpect,
          matchedDegrade,
          blob,
          reason: `命中降级特征「${matchedDegrade}」且未见期望模型`,
        };
      }

      // 命中期望模型 + 配额充足 → 正常。
      if (matchedExpect) {
        return {
          degraded: 'no',
          matchedExpect,
          matchedDegrade,
          blob,
          reason: hasQuota
            ? `命中期望模型「${matchedExpect}」且配额充足（req ${sum?.reqText || '—'}）`
            : `命中期望模型「${matchedExpect}」`,
        };
      }

      if (matchedDegrade) {
        return { degraded: 'yes', matchedExpect, matchedDegrade, blob, reason: `命中降级特征「${matchedDegrade}」` };
      }

      // 无关键字命中，但有充足配额窗口 → 高级模型仍在授权，判正常。
      if (hasQuota && !quotaExhausted) {
        return {
          degraded: 'no',
          matchedExpect,
          matchedDegrade,
          blob,
          reason: `高级模型配额窗口存在且未耗尽（req ${sum?.reqText || '—'} / tok ${sum?.tokText || '—'}）`,
        };
      }

      if (!blob.trim() && !hasQuota) {
        return {
          degraded: cfg.treatUnknownAsDegraded ? 'yes' : 'unknown',
          matchedExpect: '',
          matchedDegrade: '',
          blob,
          reason: '未从 quota 观察到模型/授权/配额信息',
        };
      }

      return {
        degraded: cfg.treatUnknownAsDegraded ? 'yes' : 'unknown',
        matchedExpect,
        matchedDegrade,
        blob,
        reason: '未见期望模型关键字，且无配额信号（无法确认）',
      };
    }

    function startCheck(opts) {
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
            const data = await queryGrokQuota(id, cfg.timezone);
            const sum = summarizeQuota(data);
            row.name = row.name || accountMeta.get(id)?.name || '';
            row.model = sum.model || '';
            row.source = sum.source || '';
            row.reqText = sum.reqText || '';
            row.tokText = sum.tokText || '';

            if (!sum.ok) {
              row.state = 'err';
              row.is403 = sum.is403;
              row.error = sum.error || sum.note || '探测失败';
              row.note = row.error;
              if (log) log(`#${id} FAIL${sum.is403 ? ' 403' : ''} ${row.error}`);
            } else {
              const j = judgeDegrade(sum, cfg);
              row.degraded = j.degraded;
              row.judgeReason = j.reason;
              row.modelBlob = j.blob;
              if (j.degraded === 'yes') {
                row.state = 'degraded';
                row.note = `疑似降智：${j.reason}`;
                if (log) log(`#${id} 降智  ${row.model || j.matchedDegrade || ''}  (${j.reason})`);
              } else if (j.degraded === 'no') {
                row.state = 'ok';
                row.note = `正常：${j.reason}`;
                if (log) log(`#${id} 正常  ${row.model || j.matchedExpect || ''}`);
              } else {
                row.state = 'unknown';
                row.note = `无法确认：${j.reason}`;
                if (log) log(`#${id} 未知  (${j.reason})`);
              }
            }
          } catch (err) {
            const fail = classifyProbeFailure(null, err);
            row.state = 'err';
            row.is403 = fail.is403;
            row.error = fail.message || err.message || String(err);
            row.note = row.error;
            if (log) log(`#${id} FAIL${fail.is403 ? ' 403' : ''} ${row.error}`);
          }
          if (onUpdate) onUpdate();
        }
      });

      return { done: Promise.all(workers).then(() => {}) };
    }

    G.queryGrokQuota = queryGrokQuota;
    G.summarizeQuota = summarizeQuota;
    G.collectModelBlob = collectModelBlob;
    G.judgeDegrade = judgeDegrade;
    G.startCheck = startCheck;
  })(S2A);
