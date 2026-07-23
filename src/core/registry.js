  // --- S2A.registry ---
  (function (S2A) {
    /** @type {Map<string, any>} */
    const tools = new Map();
    let activeToolId = null;
    /** @type {(() => void)|null} */
    let activeDispose = null;

    function makeCtx() {
      return {
        pathname: location.pathname,
        origin: location.origin,
        api: S2A.api,
        auth: S2A.auth,
        storage: S2A.storage,
        dom: S2A.domAccounts,
        util: S2A.util,
        shell: S2A.shell,
      };
    }

    function registerTool(def) {
      if (!def || !def.id) throw new Error('registerTool: id required');
      if (tools.has(def.id)) {
        console.warn('[S2A] tool already registered:', def.id);
        return;
      }
      tools.set(def.id, {
        id: def.id,
        name: def.name || def.id,
        description: def.description || '',
        order: Number(def.order) || 100,
        match: typeof def.match === 'function' ? def.match : null,
        barActions: typeof def.barActions === 'function' ? def.barActions : null,
        onInit: typeof def.onInit === 'function' ? def.onInit : null,
        onOpen: typeof def.onOpen === 'function' ? def.onOpen : null,
        onClose: typeof def.onClose === 'function' ? def.onClose : null,
        onRouteChange: typeof def.onRouteChange === 'function' ? def.onRouteChange : null,
      });
    }

    function getTool(id) {
      return tools.get(id) || null;
    }

    function listTools() {
      return Array.from(tools.values()).sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
    }

    function getActiveToolId() {
      return activeToolId;
    }

    /**
     * @param {{ showLauncher?: boolean }} [opts]
     */
    function closeActiveTool(opts) {
      if (!activeToolId) return;
      const showLauncher = !opts || opts.showLauncher !== false;
      const def = tools.get(activeToolId);
      const ctx = makeCtx();
      try {
        if (typeof activeDispose === 'function') activeDispose();
      } catch (e) {
        console.warn('[S2A] dispose error', e);
      }
      activeDispose = null;
      try {
        if (def?.onClose) def.onClose(ctx);
      } catch (e) {
        console.warn('[S2A] onClose error', e);
      }
      activeToolId = null;
      if (showLauncher && S2A.shell && typeof S2A.shell.showLauncher === 'function') {
        S2A.shell.showLauncher();
      }
    }

    function openTool(id) {
      const def = tools.get(id);
      if (!def) {
        console.warn('[S2A] unknown tool', id);
        return;
      }
      if (activeToolId === id) {
        // already open: ensure shell visible
        if (S2A.shell && typeof S2A.shell.openShell === 'function') S2A.shell.openShell();
        return;
      }
      if (activeToolId) {
        closeActiveTool({ showLauncher: false });
      }
      const ctx = makeCtx();
      activeToolId = id;
      if (S2A.shell && typeof S2A.shell.mountTool === 'function') {
        const hostEl = S2A.shell.mountTool(def);
        if (def.onOpen) {
          try {
            const dispose = def.onOpen(ctx, hostEl);
            if (typeof dispose === 'function') activeDispose = dispose;
          } catch (e) {
            console.error('[S2A] onOpen error', e);
          }
        }
      }
    }

    function dispatchInits() {
      const ctx = makeCtx();
      for (const def of listTools()) {
        if (def.match && !def.match(ctx)) continue;
        if (def.onInit) {
          try {
            def.onInit(ctx);
          } catch (e) {
            console.warn('[S2A] onInit error', def.id, e);
          }
        }
      }
    }

    function dispatchRouteChange() {
      const ctx = makeCtx();
      for (const def of listTools()) {
        if (def.onRouteChange) {
          try {
            def.onRouteChange(ctx);
          } catch (e) {
            console.warn('[S2A] onRouteChange error', def.id, e);
          }
        }
      }
      // re-init match tools (bar inject etc.)
      for (const def of listTools()) {
        if (def.match && !def.match(ctx)) continue;
        if (def.onInit) {
          try {
            def.onInit(ctx);
          } catch (_) {}
        }
      }
    }

    S2A.registerTool = registerTool;
    S2A.getTool = getTool;
    S2A.listTools = listTools;
    S2A.openTool = openTool;
    S2A.closeActiveTool = closeActiveTool;
    S2A.getActiveToolId = getActiveToolId;
    S2A.registry = {
      registerTool,
      getTool,
      listTools,
      openTool,
      closeActiveTool,
      getActiveToolId,
      makeCtx,
      dispatchInits,
      dispatchRouteChange,
    };
  })(S2A);

