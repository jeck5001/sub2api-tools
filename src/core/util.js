  // --- S2A.util ---
  (function (S2A) {
    function $(sel, root = document) {
      return root.querySelector(sel);
    }

    function $$(sel, root = document) {
      return Array.from(root.querySelectorAll(sel));
    }

    function sleep(ms) {
      return new Promise((r) => setTimeout(r, ms));
    }

    function esc(s) {
      return String(s ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
    }

    function formatNum(n) {
      const x = Number(n);
      if (!Number.isFinite(x)) return String(n);
      if (x >= 1e6) return (x / 1e6).toFixed(x % 1e6 === 0 ? 0 : 1) + 'M';
      if (x >= 1e3) return (x / 1e3).toFixed(x % 1e3 === 0 ? 0 : 1) + 'K';
      return String(x);
    }

    function parseIdsText(text) {
      return String(text || '')
        .split(/[\s,;|]+/)
        .map((x) => x.trim())
        .filter(Boolean)
        .filter((x, i, arr) => arr.indexOf(x) === i);
    }

    function downloadBlob(blob, filename) {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = filename;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    }

    S2A.util = { $, $$, sleep, esc, formatNum, parseIdsText, downloadBlob };
  })(S2A);

