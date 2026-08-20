  // --- Grok degrade export ---
  (function (S2A) {
    const G = (S2A.tools['grok-degrade'] = S2A.tools['grok-degrade'] || {});

    function exportCsv(results, log) {
      const rows = Array.from(results.values());
      if (!rows.length) {
        alert('没有可导出的结果');
        return;
      }
      const header = ['id', 'name', 'state', 'degraded', 'bot_flag_source', 'bot_flag_details', 'bot_flag_risk', 'bot_flag_denied', 'sso_source', 'note', 'error'];
      const lines = [header.join(',')];
      for (const r of rows) {
        const cols = [
          r.id,
          r.name,
          r.state,
          r.state === 'degraded' ? '1' : r.state === 'ok' ? '0' : '',
          r.botFlagSource != null ? String(r.botFlagSource) : '',
          r.botFlagDetails || '',
          r.botFlagRisk != null ? String(r.botFlagRisk) : '',
          r.botFlagDenied ? '1' : '0',
          r.ssoSource || '',
          r.note,
          r.error,
        ].map((v) => {
          const s = String(v ?? '');
          return /["\n,]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
        });
        lines.push(cols.join(','));
      }
      const blob = new Blob(['\ufeff' + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
      S2A.util.downloadBlob(
        blob,
        `grok-degrade-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.csv`
      );
      if (log) log(`已导出 CSV ${rows.length} 行`);
    }

    async function copySummary(results, log) {
      const rows = Array.from(results.values());
      const degraded = rows.filter((r) => r.state === 'degraded');
      const ok = rows.filter((r) => r.state === 'ok');
      const unknown = rows.filter((r) => r.state === 'unknown');
      const err = rows.filter((r) => r.state === 'err');
      const lines = [
        `Grok 降智检测摘要 ${new Date().toLocaleString()}`,
        `总数 ${rows.length} · 降智 ${degraded.length} · 正常 ${ok.length} · 未知 ${unknown.length} · 失败 ${err.length}`,
        '',
      ];
      if (degraded.length) {
        lines.push('疑似降智:');
        degraded.forEach((r) => lines.push(`#${r.id} ${r.name || ''}  bfs=${r.botFlagSource != null ? r.botFlagSource : '?'}  ${r.note || ''}`));
        lines.push('');
      }
      if (unknown.length) {
        lines.push('无法确认:');
        unknown.forEach((r) => lines.push(`#${r.id} ${r.name || ''}  bfs=${r.botFlagSource != null ? r.botFlagSource : '?'}  ${r.note || ''}`));
        lines.push('');
      }
      if (err.length) {
        lines.push('失败:');
        err.forEach((r) => lines.push(`#${r.id} [${r.is403 ? '403' : 'err'}] ${r.error || r.note}`));
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
