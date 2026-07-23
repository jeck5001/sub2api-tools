  // --- Delete error accounts tool registration ---
  (function (S2A) {
    const T = (S2A.tools['delete-error-accounts'] = S2A.tools['delete-error-accounts'] || {});
    let session = null;

    function register() {
      S2A.registerTool({
        id: 'delete-error-accounts',
        name: '批量删除错误账号',
        description: '扫描状态=错误 的账号并批量删除（需确认）',
        order: 20,
        match: (ctx) => /\/admin\/accounts\b/.test(ctx.pathname),
        barActions: () => [
          {
            id: 'open-error',
            label: '删除本页错误',
            onClick: () => {
              S2A.openTool('delete-error-accounts');
              setTimeout(() => {
                if (!T._activeSession) return;
                const items = S2A.domAccounts.collectByStatusFromDom({
                  onlyGrok: false,
                  statuses: ['error'],
                });
                T._activeSession.fillIds(items);
                T._activeSession.log(
                  `本页错误账号：${items.length} 个` +
                    (items.length ? ` → ${items.map((x) => x.id).join(',')}` : '')
                );
                if (!items.length) alert('当前页未找到状态为「错误」的账号');
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
          session = T.mount(hostEl);
          return () => {
            if (session) {
              try {
                session.dispose();
              } catch (_) {}
              session = null;
            }
            T._activeSession = null;
          };
        },
        onClose() {
          if (T._activeSession && typeof T._activeSession.abort === 'function') {
            T._activeSession.abort();
          }
          if (session) {
            try {
              session.dispose();
            } catch (_) {}
            session = null;
          }
          T._activeSession = null;
        },
        onRouteChange() {},
      });
    }

    T.register = register;
  })(S2A);
