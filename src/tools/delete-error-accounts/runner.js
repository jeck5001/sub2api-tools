  // --- Delete error accounts runner ---
  (function (S2A) {
    const T = (S2A.tools['delete-error-accounts'] = S2A.tools['delete-error-accounts'] || {});
    const { sleep } = S2A.util;

    /**
     * Concurrent delete workers.
     * @returns {{ done: Promise<void> }}
     */
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
