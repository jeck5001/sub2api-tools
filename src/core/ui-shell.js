  // --- S2A.shell ---
  (function (S2A) {
    const { $, $$, esc } = S2A.util;
    const SHELL_ID = 's2a-shell-panel';
    const FAB_ID = 's2a-shell-fab';
    const STYLE_ID = 's2a-shell-style';
    const HOST_ID = 's2a-shell-host';
    const LIST_ID = 's2a-shell-list';

    let lastPath = location.pathname;
    let mo = null;
    let intervalId = null;

    function injectStyles() {
      if (document.getElementById(STYLE_ID)) return;
      const css = `
#${FAB_ID} {
  position: fixed; right: 16px; bottom: 16px; z-index: 2147483645;
  border: 0; border-radius: 999px; padding: 10px 14px; cursor: pointer;
  background: #0891b2; color: #fff; font-weight: 700; font-size: 12px;
  box-shadow: 0 8px 24px rgba(8,145,178,.45);
}
#${SHELL_ID} {
  position: fixed;
  right: 16px;
  bottom: 16px;
  z-index: 2147483646;
  width: 520px;
  max-width: calc(100vw - 24px);
  max-height: calc(100vh - 32px);
  display: flex;
  flex-direction: column;
  background: #0f172a;
  color: #e2e8f0;
  border: 1px solid #334155;
  border-radius: 12px;
  box-shadow: 0 12px 40px rgba(0,0,0,.45);
  font: 12px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  overflow: hidden;
}
#${SHELL_ID}.s2a-collapsed { width: 240px; max-height: none; }
#${SHELL_ID}.s2a-collapsed .s2a-body { display: none; }
#${SHELL_ID} .s2a-hd {
  display: flex; align-items: center; justify-content: space-between;
  gap: 8px; padding: 10px 12px; background: #1e293b; cursor: move; user-select: none;
}
#${SHELL_ID} .s2a-hd h3 { margin: 0; font-size: 13px; font-weight: 700; color: #f8fafc; }
#${SHELL_ID} .s2a-hd .s2a-sub { color: #94a3b8; font-size: 11px; }
#${SHELL_ID} .s2a-hd-actions { display: flex; gap: 6px; }
#${SHELL_ID} .s2a-hd-actions button {
  border: 0; background: #334155; color: #e2e8f0; border-radius: 6px;
  padding: 4px 8px; cursor: pointer; font-size: 11px;
}
#${SHELL_ID} .s2a-hd-actions button:hover { background: #475569; }
#${SHELL_ID} .s2a-body { padding: 10px 12px 12px; overflow: auto; min-height: 0; flex: 1; }
#${SHELL_ID} .s2a-tool-item {
  display: block; width: 100%; text-align: left;
  border: 1px solid #1f2937; background: #111827; color: #e2e8f0;
  border-radius: 8px; padding: 10px 12px; margin-bottom: 8px; cursor: pointer;
}
#${SHELL_ID} .s2a-tool-item:hover { border-color: #0891b2; background: #0f172a; }
#${SHELL_ID} .s2a-tool-item b { display: block; font-size: 13px; margin-bottom: 4px; }
#${SHELL_ID} .s2a-tool-item span { color: #94a3b8; font-size: 11px; }
#${SHELL_ID} .s2a-row { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 8px; align-items: center; }
#${SHELL_ID} label.s2a-lbl { display: inline-flex; align-items: center; gap: 4px; color: #cbd5e1; }
#${SHELL_ID} input[type="number"],
#${SHELL_ID} input[type="text"],
#${SHELL_ID} textarea {
  background: #111827; color: #e5e7eb; border: 1px solid #374151;
  border-radius: 6px; padding: 5px 8px; font-size: 12px;
}
#${SHELL_ID} input[type="number"] { width: 70px; }
#${SHELL_ID} input[type="text"] { width: 160px; }
#${SHELL_ID} textarea {
  width: 100%; min-height: 54px; resize: vertical; font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
}
#${SHELL_ID} .s2a-btn {
  border: 0; border-radius: 7px; padding: 6px 10px; cursor: pointer;
  font-size: 12px; font-weight: 600; color: #fff;
}
#${SHELL_ID} .s2a-btn:disabled { opacity: .55; cursor: not-allowed; }
#${SHELL_ID} .s2a-btn-primary { background: #0891b2; }
#${SHELL_ID} .s2a-btn-primary:hover:not(:disabled) { background: #0e7490; }
#${SHELL_ID} .s2a-btn-secondary { background: #475569; }
#${SHELL_ID} .s2a-btn-danger { background: #b91c1c; }
#${SHELL_ID} .s2a-btn-ok { background: #15803d; }
#${SHELL_ID} .s2a-stats {
  display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; margin: 8px 0;
}
#${SHELL_ID} .s2a-stat {
  background: #111827; border: 1px solid #1f2937; border-radius: 8px; padding: 6px 8px;
}
#${SHELL_ID} .s2a-stat b { display: block; font-size: 16px; color: #f8fafc; }
#${SHELL_ID} .s2a-stat span { color: #94a3b8; font-size: 11px; }
#${SHELL_ID} .s2a-progress {
  height: 6px; background: #1f2937; border-radius: 999px; overflow: hidden; margin: 6px 0 10px;
}
#${SHELL_ID} .s2a-progress > i {
  display: block; height: 100%; width: 0; background: linear-gradient(90deg, #06b6d4, #22c55e);
  transition: width .2s ease;
}
#${SHELL_ID} .s2a-table-wrap {
  max-height: 280px; overflow: auto; border: 1px solid #1f2937; border-radius: 8px;
}
#${SHELL_ID} table { width: 100%; border-collapse: collapse; font-size: 11px; }
#${SHELL_ID} th, #${SHELL_ID} td {
  padding: 6px 8px; border-bottom: 1px solid #1f2937; text-align: left; vertical-align: top;
}
#${SHELL_ID} th {
  position: sticky; top: 0; background: #1e293b; color: #cbd5e1; z-index: 1;
}
#${SHELL_ID} tr.ok td { background: rgba(22, 163, 74, .08); }
#${SHELL_ID} tr.err td { background: rgba(220, 38, 38, .1); }
#${SHELL_ID} tr.run td { background: rgba(8, 145, 178, .1); }
#${SHELL_ID} .s2a-muted { color: #94a3b8; }
#${SHELL_ID} .s2a-tag {
  display: inline-block; padding: 1px 6px; border-radius: 999px; font-size: 10px; font-weight: 700;
}
#${SHELL_ID} .s2a-tag.ok { background: #14532d; color: #bbf7d0; }
#${SHELL_ID} .s2a-tag.warn { background: #713f12; color: #fde68a; }
#${SHELL_ID} .s2a-tag.bad { background: #7f1d1d; color: #fecaca; }
#${SHELL_ID} .s2a-tag.run { background: #164e63; color: #a5f3fc; }
#${SHELL_ID} .s2a-log {
  margin-top: 8px; max-height: 90px; overflow: auto; background: #020617;
  border: 1px solid #1f2937; border-radius: 8px; padding: 6px 8px;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace; color: #94a3b8; white-space: pre-wrap;
}
.s2a-bar-btn { margin-left: 6px; }
`;
      if (typeof GM_addStyle === 'function') GM_addStyle(css);
      else {
        const st = document.createElement('style');
        st.id = STYLE_ID;
        st.textContent = css;
        document.head.appendChild(st);
      }
    }

    function makeDraggable(panel, handle) {
      if (!handle) return;
      let sx = 0,
        sy = 0,
        ox = 0,
        oy = 0,
        dragging = false;
      handle.addEventListener('mousedown', (e) => {
        if (e.target.closest('button')) return;
        dragging = true;
        sx = e.clientX;
        sy = e.clientY;
        const rect = panel.getBoundingClientRect();
        ox = rect.left;
        oy = rect.top;
        panel.style.right = 'auto';
        panel.style.bottom = 'auto';
        panel.style.left = ox + 'px';
        panel.style.top = oy + 'px';
        e.preventDefault();
      });
      window.addEventListener('mousemove', (e) => {
        if (!dragging) return;
        panel.style.left = ox + (e.clientX - sx) + 'px';
        panel.style.top = oy + (e.clientY - sy) + 'px';
      });
      window.addEventListener('mouseup', () => {
        dragging = false;
      });
    }

    function ensureFab() {
      if (document.getElementById(FAB_ID) || document.getElementById(SHELL_ID)) return;
      const btn = document.createElement('button');
      btn.id = FAB_ID;
      btn.type = 'button';
      btn.textContent = 'Sub2API 工具';
      btn.onclick = () => openShell();
      document.body.appendChild(btn);
    }

    function removeFab() {
      const fab = document.getElementById(FAB_ID);
      if (fab) fab.remove();
    }

    function setHeader(title, sub, showBack) {
      const panel = document.getElementById(SHELL_ID);
      if (!panel) return;
      const h3 = panel.querySelector('.s2a-hd h3');
      const subEl = panel.querySelector('.s2a-hd .s2a-sub');
      if (h3) h3.textContent = title || 'Sub2API 工具';
      if (subEl) subEl.textContent = sub || `v${S2A.version || ''}`;
      const backBtn = panel.querySelector('[data-act="back"]');
      if (backBtn) backBtn.style.display = showBack ? '' : 'none';
    }

    function renderLauncherList() {
      const list = document.getElementById(LIST_ID);
      if (!list) return;
      const tools = S2A.listTools();
      if (!tools.length) {
        list.innerHTML = '<div class="s2a-muted">暂无已注册工具</div>';
        return;
      }
      list.innerHTML = tools
        .map(
          (t) => `
        <button type="button" class="s2a-tool-item" data-tool-id="${esc(t.id)}">
          <b>${esc(t.name)}</b>
          <span>${esc(t.description || '')}</span>
        </button>`
        )
        .join('');
      list.querySelectorAll('[data-tool-id]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const id = btn.getAttribute('data-tool-id');
          S2A.openTool(id);
        });
      });
    }

    function showLauncher() {
      const host = document.getElementById(HOST_ID);
      const list = document.getElementById(LIST_ID);
      if (host) {
        host.innerHTML = '';
        host.style.display = 'none';
      }
      if (list) list.style.display = '';
      setHeader('Sub2API 工具', `v${S2A.version || ''} · 选择工具`, false);
      renderLauncherList();
    }

    /**
     * @param {{ id: string, name: string, description?: string }} def
     * @returns {HTMLElement}
     */
    function mountTool(def) {
      ensureShell();
      const host = document.getElementById(HOST_ID);
      const list = document.getElementById(LIST_ID);
      if (list) list.style.display = 'none';
      if (host) {
        host.innerHTML = '';
        host.style.display = '';
        host.id = HOST_ID;
        host.setAttribute('data-tool', def.id);
        // tool-scoped class for CSS
        host.className = `s2a-tool-host s2a-tool-${def.id}`;
      }
      setHeader(def.name, def.description || def.id, true);
      const panel = document.getElementById(SHELL_ID);
      if (panel) {
        panel.style.display = 'flex';
        panel.classList.remove('s2a-collapsed');
      }
      removeFab();
      return host;
    }

    function ensureShell() {
      injectStyles();
      if (document.getElementById(SHELL_ID)) return document.getElementById(SHELL_ID);

      const panel = document.createElement('div');
      panel.id = SHELL_ID;
      panel.innerHTML = `
      <div class="s2a-hd" data-drag="1">
        <div>
          <h3>Sub2API 工具</h3>
          <div class="s2a-sub">v${esc(S2A.version || '')}</div>
        </div>
        <div class="s2a-hd-actions">
          <button type="button" data-act="back" title="返回列表" style="display:none">←</button>
          <button type="button" data-act="collapse" title="折叠">–</button>
          <button type="button" data-act="close" title="关闭">×</button>
        </div>
      </div>
      <div class="s2a-body">
        <div id="${LIST_ID}"></div>
        <div id="${HOST_ID}" style="display:none"></div>
      </div>
    `;
      document.body.appendChild(panel);
      makeDraggable(panel, panel.querySelector('[data-drag]'));

      panel.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-act]');
        if (!btn || !panel.contains(btn)) return;
        const act = btn.getAttribute('data-act');
        if (act === 'close') {
          closeShell();
          return;
        }
        if (act === 'collapse') {
          panel.classList.toggle('s2a-collapsed');
          return;
        }
        if (act === 'back') {
          if (S2A.getActiveToolId()) S2A.closeActiveTool();
          else showLauncher();
        }
      });

      showLauncher();
      return panel;
    }

    function openShell() {
      removeFab();
      const panel = ensureShell();
      panel.style.display = 'flex';
      panel.classList.remove('s2a-collapsed');
      if (!S2A.getActiveToolId()) showLauncher();
    }

    function closeShell() {
      if (typeof S2A.closeActiveTool === 'function' && S2A.getActiveToolId()) {
        try {
          S2A.closeActiveTool({ showLauncher: false });
        } catch (_) {}
      }
      const panel = document.getElementById(SHELL_ID);
      if (panel) panel.remove();
      ensureFab();
    }

    function toggleShell() {
      if (document.getElementById(SHELL_ID)) closeShell();
      else openShell();
    }

    /**
     * Inject toolbar buttons near native accounts toolbar.
     * @param {string} id
     * @param {string} label
     * @param {() => void} onClick
     * @param {string} [classHint]
     */
    function injectBarButton(id, label, onClick, classHint) {
      if (document.getElementById(id)) return true;
      const anchors = $$('button').filter((b) => {
        const t = (b.textContent || '').trim();
        return /添加账号|更多操作|自动刷新|批量删除|批量编辑/.test(t);
      });
      const host = anchors[0]?.parentElement;
      if (!host) return false;
      const btn = document.createElement('button');
      btn.id = id;
      btn.type = 'button';
      btn.className = (classHint || anchors[0].className || '') + ' s2a-bar-btn';
      btn.textContent = label;
      btn.style.marginLeft = '6px';
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        onClick();
      });
      host.appendChild(btn);
      return true;
    }

    function injectToolBarActions() {
      const ctx = S2A.registry.makeCtx();
      for (const def of S2A.listTools()) {
        if (def.match && !def.match(ctx)) continue;
        if (!def.barActions) continue;
        let actions = [];
        try {
          actions = def.barActions(ctx) || [];
        } catch (_) {
          continue;
        }
        for (const act of actions) {
          if (!act || !act.id || !act.label) continue;
          const btnId = `s2a-bar-${def.id}-${act.id}`;
          injectBarButton(btnId, act.label, () => {
            try {
              act.onClick(S2A.registry.makeCtx());
            } catch (e) {
              console.error(e);
            }
          });
        }
      }
    }

    function onRouteMaybeChanged() {
      if (location.pathname !== lastPath) {
        lastPath = location.pathname;
        S2A.registry.dispatchRouteChange();
      }
      injectToolBarActions();
    }

    function init() {
      injectStyles();
      ensureFab();
      injectToolBarActions();

      if (mo) mo.disconnect();
      mo = new MutationObserver(() => {
        ensureFab();
        onRouteMaybeChanged();
      });
      mo.observe(document.documentElement, { childList: true, subtree: true });

      if (intervalId) clearInterval(intervalId);
      intervalId = setInterval(() => {
        onRouteMaybeChanged();
        if (!document.getElementById(SHELL_ID)) ensureFab();
      }, 2000);

      window.addEventListener('keydown', (e) => {
        if (e.altKey && (e.key === 'q' || e.key === 'Q')) {
          e.preventDefault();
          toggleShell();
        }
      });
    }

    S2A.shell = {
      init,
      injectStyles,
      ensureFab,
      openShell,
      closeShell,
      toggleShell,
      showLauncher,
      mountTool,
      injectBarButton,
      injectToolBarActions,
      SHELL_ID,
      FAB_ID,
      HOST_ID,
    };
  })(S2A);

