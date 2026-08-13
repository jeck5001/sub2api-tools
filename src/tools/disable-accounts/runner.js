// --- Disable accounts runner ---
(function (S2A) {
  const T = (S2A.tools['disable-accounts'] = S2A.tools['disable-accounts'] || {});
  const { sleep } = S2A.util;

  function startDelete(opts) {
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
          await S2A.api.deleteAccount(id);
          row.state = 'del';
          row.deleted = true;
          row.note = row.note || '已删除';
          if (log) log(`#${id} 已删除${row.name ? ` ${row.name}` : ''}`);
        } catch (err) {
          row.state = 'del_fail';
          row.deleted = false;
          row.error = err.message || String(err);
          row.note = row.error;
          if (log) log(`#${id} 删除失败: ${row.error}`);
        }
        if (onUpdate) onUpdate();
      }
    });

    return {
      done: Promise.all(workers).then(() => {}),
    };
  }

  T.startDelete = startDelete;
})(S2A);
