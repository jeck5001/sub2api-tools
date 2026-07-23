  // --- main boot ---
  (function (S2A) {
    function boot() {
      try {
        if (S2A.shell && typeof S2A.shell.injectStyles === 'function') {
          S2A.shell.injectStyles();
        }
        // tools already registered by register-all.js
        if (S2A.shell && typeof S2A.shell.init === 'function') {
          S2A.shell.init();
        }
        if (S2A.registry && typeof S2A.registry.dispatchInits === 'function') {
          S2A.registry.dispatchInits();
        }
        console.info(`[S2A] Sub2API Tools v${S2A.version} ready`);
      } catch (e) {
        console.error('[S2A] boot failed', e);
      }
    }

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', boot);
    } else {
      boot();
    }
  })(S2A);

})();

