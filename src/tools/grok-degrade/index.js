  // --- Grok degrade tool registration ---
  (function (S2A) {
    const G = (S2A.tools['grok-degrade'] = S2A.tools['grok-degrade'] || {});
    let session = null;

    function register() {
      S2A.registerTool({
        id: 'grok-degrade',
        name: 'Grok 批量降智检测',
        description: '批量检测 Grok 账号是否被降智（模型降级）',
        order: 15,
        match: (ctx) => /\/admin\/accounts\b/.test(ctx.pathname),
        barActions: () => [
          {
            id: 'open',
            label: '批量降智检测',
            onClick: () => {
              S2A.openTool('grok-degrade');
              setTimeout(() => {
                if (!G._activeSession) return;
                const items = S2A.domAccounts.collectSelectedFromDom({ onlyGrok: true });
                if (items.length) {
                  G._activeSession.fillIds(items);
                  G._activeSession.log(`已从批量栏读取勾选 ${items.length} 个`);
                }
              }, 50);
            },
          },
        ],
        onInit() {},
        onOpen(ctx, hostEl) {
          if (session) {
            try {
              session.dispose();
            } catch (_) {}
            session = null;
          }
          session = G.mount(hostEl);
          return () => {
            if (session) {
              try {
                session.dispose();
              } catch (_) {}
              session = null;
            }
            G._activeSession = null;
          };
        },
        onClose() {
          if (G._activeSession && typeof G._activeSession.abort === 'function') {
            G._activeSession.abort();
          }
          if (session) {
            try {
              session.dispose();
            } catch (_) {}
            session = null;
          }
          G._activeSession = null;
        },
        onRouteChange() {},
      });
    }

    G.register = register;
  })(S2A);
