  // --- Grok quota tool registration ---
  (function (S2A) {
    const G = (S2A.tools['grok-quota'] = S2A.tools['grok-quota'] || {});
    let session = null;

    function register() {
      S2A.registerTool({
        id: 'grok-quota',
        name: 'Grok 批量额度探测',
        description: '批量探测 Grok 额度；403 可自动删除',
        order: 10,
        match: (ctx) => /\/admin\/accounts\b/.test(ctx.pathname),
        barActions: (ctx) => [
          {
            id: 'open',
            label: '批量额度探测',
            onClick: () => {
              S2A.openTool('grok-quota');
              // after open, fill selected if any
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
          {
            id: 'forbidden',
            label: '读取本页 forbidden',
            onClick: () => {
              S2A.openTool('grok-quota');
              setTimeout(() => {
                if (!G._activeSession) return;
                const items = S2A.domAccounts.collectForbiddenFromDom({ onlyGrok: true });
                G._activeSession.fillIds(items);
                G._activeSession.log(`本页 forbidden：${items.length} 个`);
                if (!items.length) alert('当前页未找到 forbidden 账号');
              }, 50);
            },
          },
        ],
        onInit(ctx) {
          // bar inject handled by shell.injectToolBarActions
        },
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
        onClose(ctx) {
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
        onRouteChange(ctx) {
          // nothing special; shell re-inits bars
        },
      });
    }

    G.register = register;
  })(S2A);

