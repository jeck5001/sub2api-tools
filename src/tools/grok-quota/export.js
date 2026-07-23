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

