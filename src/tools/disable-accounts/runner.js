// --- Disable accounts runner ---
(function (S2A) {
  const T = (S2A.tools['disable-accounts'] = S2A.tools['disable-accounts'] || {});
  const { sleep } = S2A.util;

  function startDelete(opts) {
    const { ids, accountMeta, results, cfg, log, onProgress, getAbort } = opts;

    let cursor = 0;
    let successCount = 0;
    let failureCount = 0;
    let doneCount = 0;
    const reportProgress = () => {
      if (onProgress) onProgress({ total: ids.length, done: doneCount, ok: successCount, err: failureCount });
    };
    const workers = Array.from({ length: cfg.concurrency }, async () => {
      while (!getAbort()) {
        const i = cursor++;
        if (i >= ids.length) break;
        const id = ids[i];
        const row = results.get(id);
        if (!row) continue;
        row.state = 'run';

        try {
          if (cfg.delayMs > 0) await sleep(cfg.delayMs);
          await S2A.api.deleteAccount(id);
          row.state = 'del';
          row.deleted = true;
          row.note = row.note || '已删除';
          successCount += 1;
          if (log && (successCount === 1 || successCount % 100 === 0)) {
            log(`删除进度：已删 ${successCount} 个`);
          }
        } catch (err) {
          row.state = 'del_fail';
          row.deleted = false;
          row.error = err.message || String(err);
          row.note = row.error;
          failureCount += 1;
          if (log && (failureCount === 1 || failureCount % 50 === 0)) {
            log(`删除失败：${failureCount} 个，最近错误：${row.error}`);
          }
        }
        doneCount += 1;
        reportProgress();
      }
    });

    return {
      done: Promise.all(workers).then(() => {}),
    };
  }

  T.startDelete = startDelete;
})(S2A);
