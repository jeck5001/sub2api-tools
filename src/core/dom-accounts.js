  // --- S2A.domAccounts ---
  (function (S2A) {
    const { $, $$ } = S2A.util;

    function rowLooksGrok(row) {
      if (!row) return true;
      const text = (row.textContent || '').toLowerCase();
      return text.includes('grok');
    }

    function extractIdFromRow(row) {
      if (!row) return '';
      const dataRowId = row.getAttribute?.('data-row-id');
      if (dataRowId && /^\d+$/.test(dataRowId)) return dataRowId;

      const host = row.closest?.('[data-row-id]') || row;
      const hostId = host?.getAttribute?.('data-row-id');
      if (hostId && /^\d+$/.test(hostId)) return hostId;

      const candidates = $$('span, td, div', row).map((el) => (el.textContent || '').trim());
      for (const t of candidates) {
        const m = t.match(/^#(\d+)$/);
        if (m) return m[1];
      }
      for (const attr of ['data-id', 'data-account-id', 'data-row-key']) {
        const v = row.getAttribute?.(attr);
        if (v && /^\d+$/.test(v)) return v;
      }
      const m2 = (row.textContent || '').match(/#(\d{1,12})\b/);
      return m2 ? m2[1] : '';
    }

    /**
     * Detect forbidden / validation / violation badge in usage window column.
     */
    function detectForbiddenInRow(row) {
      if (!row) return null;
      const badges = $$('span, div, button', row).filter((el) => {
        const t = (el.textContent || '').trim().toLowerCase();
        if (!t || t.length > 40) return false;
        return (
          t === 'forbidden' ||
          t === 'validation' ||
          t === 'violation' ||
          t.includes('forbidden') ||
          t === '禁止' ||
          t === '违规' ||
          t === '需验证' ||
          /forbidden|validation|violation/.test(t)
        );
      });

      for (const el of badges) {
        const t = (el.textContent || '').trim().toLowerCase();
        const cls = String(el.className || '');
        const looksBadge =
          cls.includes('bg-red') ||
          cls.includes('bg-yellow') ||
          cls.includes('rounded') ||
          (el.textContent || '').trim().length <= 20;
        if (!looksBadge && t.length > 20) continue;

        if (/\bvalidation\b|需验证/.test(t)) return { type: 'validation', text: (el.textContent || '').trim() };
        if (/\bviolation\b|违规/.test(t)) return { type: 'violation', text: (el.textContent || '').trim() };
        if (/\bforbidden\b|禁止/.test(t) || t === 'forbidden') {
          return { type: 'forbidden', text: (el.textContent || '').trim() };
        }
      }

      const rowText = (row.textContent || '').toLowerCase();
      if (/\bforbidden\b/.test(rowText)) return { type: 'forbidden', text: 'forbidden' };
      return null;
    }

    function extractNameFromRow(row) {
      if (!row) return '';
      const texts = $$('span, div', row)
        .map((el) => (el.textContent || '').trim())
        .filter((t) => t && !/^#\d+$/.test(t) && t.length < 80);
      const email = texts.find((t) => t.includes('@'));
      if (email) return email;
      return texts.find((t) => !/grok|oauth|api|启用|禁用|正常|错误/i.test(t)) || '';
    }

    function shouldSkipNonGrok(row, onlyGrok) {
      if (!onlyGrok || !row) return false;
      const txt = (row.textContent || '').toLowerCase();
      if (/(openai|anthropic|gemini|antigravity|claude)/.test(txt) && !txt.includes('grok')) return true;
      return false;
    }

    /**
     * Detect account status badge in the「状态」column.
     * UI shows pink/red pill: "错误" (also error / Error / failed).
     * @returns {{ type: string, text: string }|null}
     */
    function detectAccountStatusInRow(row) {
      if (!row) return null;

      const badgeMatchers = [
        { type: 'error', re: /^(错误|error|failed|fail)$/i },
        { type: 'error', re: /错误|error|failed/i },
        { type: 'normal', re: /^(正常|normal|ok|active|healthy|enabled)$/i },
        { type: 'disabled', re: /^(禁用|disabled|inactive)$/i },
        { type: 'warning', re: /^(警告|warning|warn)$/i },
      ];

      const nodes = $$('span, div, button, td', row).filter((el) => {
        const t = (el.textContent || '').trim();
        if (!t || t.length > 24) return false;
        // Prefer badge-like short labels
        return /错误|正常|禁用|警告|error|normal|disabled|warning|ok|active|failed/i.test(t);
      });

      for (const el of nodes) {
        const text = (el.textContent || '').trim();
        const t = text.toLowerCase();
        const cls = String(el.className || '');
        const looksBadge =
          cls.includes('bg-red') ||
          cls.includes('bg-green') ||
          cls.includes('bg-yellow') ||
          cls.includes('bg-gray') ||
          cls.includes('rounded') ||
          text.length <= 12;
        if (!looksBadge && text.length > 12) continue;

        for (const m of badgeMatchers) {
          if (m.re.test(text) || m.re.test(t)) {
            // Prefer exact short match for 错误 pill
            if (m.type === 'error' && /^(错误|error|failed|fail)$/i.test(text)) {
              return { type: 'error', text };
            }
            if (m.type !== 'error') return { type: m.type, text };
          }
        }
      }

      // Exact short badge second pass for error (avoid matching "错误信息" in long cells)
      for (const el of nodes) {
        const text = (el.textContent || '').trim();
        if (/^(错误|error|failed|fail)$/i.test(text)) return { type: 'error', text };
      }

      return null;
    }

    function normalizeStatusType(raw) {
      const s = String(raw ?? '').trim().toLowerCase();
      if (!s) return '';
      if (/(错误|error|failed|fail)/.test(s)) return 'error';
      if (/(禁用|disabled|inactive)/.test(s)) return 'disabled';
      if (/(警告|warning|warn)/.test(s)) return 'warning';
      if (/(正常|normal|ok|active|healthy|enabled)/.test(s)) return 'normal';
      return s;
    }

    /**
     * Collect accounts whose status badge matches.
     * @param {{ onlyGrok?: boolean, statuses?: string[], panelRoot?: Element|null }} [opts]
     *   statuses: status types, default ['error']
     */
    function collectByStatusFromDom(opts = {}) {
      const onlyGrok = opts.onlyGrok === true; // default: all platforms for delete tool
      const want = new Set(
        (opts.statuses || ['error']).map((x) => normalizeStatusType(x)).filter(Boolean)
      );
      if (!want.size) want.add('error');

      let rows = $$('tr[data-row-id], [role="row"][data-row-id]');
      if (!rows.length) {
        rows = $$('tr, [role="row"]').filter((r) => r.querySelector('input[type="checkbox"]'));
      }

      const items = [];
      const seen = new Set();
      for (const row of rows) {
        if (opts.panelRoot && opts.panelRoot.contains(row)) continue;
        if (row.closest('#s2a-shell-panel')) continue;

        const hit = detectAccountStatusInRow(row);
        if (!hit || !want.has(hit.type)) continue;

        const id = extractIdFromRow(row);
        if (!id || seen.has(id)) continue;
        if (shouldSkipNonGrok(row, onlyGrok)) continue;

        seen.add(id);
        items.push({
          id,
          name: extractNameFromRow(row),
          platform: rowLooksGrok(row) ? 'grok' : '',
          statusType: hit.type,
          statusText: hit.text,
        });
      }
      return items;
    }

    /**
     * @param {{ onlyGrok?: boolean, panelRoot?: Element|null }} [opts]
     */
    function collectSelectedFromDom(opts = {}) {
      const onlyGrok = opts.onlyGrok !== false;
      const panelRoot = opts.panelRoot || null;
      const boxes = $$('input[type="checkbox"]');
      const items = [];
      const seen = new Set();

      for (const box of boxes) {
        if (!box.checked) continue;
        if (panelRoot && panelRoot.contains(box)) continue;
        if (box.closest('#s2a-shell-panel') || box.closest('[id^="s2a-tool-"]')) continue;
        if (box.id && /bulk-edit|enabled|remember/i.test(box.id)) continue;

        const row =
          box.closest('tr[data-row-id]') ||
          box.closest('[data-row-id]') ||
          box.closest('tr') ||
          box.closest('[role="row"]') ||
          box.parentElement?.parentElement;

        const id = extractIdFromRow(row);
        if (!id) continue;
        if (seen.has(id)) continue;
        if (shouldSkipNonGrok(row, onlyGrok)) continue;

        seen.add(id);
        const forbidden = detectForbiddenInRow(row);
        items.push({
          id,
          name: extractNameFromRow(row),
          platform: rowLooksGrok(row) ? 'grok' : '',
          forbiddenType: forbidden?.type || '',
          forbiddenText: forbidden?.text || '',
        });
      }
      return items;
    }

    /**
     * @param {{ onlyGrok?: boolean }} [opts]
     */
    function collectPageAccountsFromDom(opts = {}) {
      const onlyGrok = opts.onlyGrok !== false;
      const items = [];
      const seen = new Set();

      const rows = $$('tr[data-row-id], [role="row"][data-row-id]');
      if (rows.length) {
        for (const row of rows) {
          const id = extractIdFromRow(row);
          if (!id || seen.has(id)) continue;
          if (shouldSkipNonGrok(row, onlyGrok)) continue;
          seen.add(id);
          items.push({ id, name: extractNameFromRow(row), platform: rowLooksGrok(row) ? 'grok' : '' });
        }
        return items;
      }

      const idSpans = $$('span').filter((el) => /^#\d+$/.test((el.textContent || '').trim()));
      for (const span of idSpans) {
        const id = (span.textContent || '').trim().replace(/^#/, '');
        if (!id || seen.has(id)) continue;
        const row =
          span.closest('tr') ||
          span.closest('[role="row"]') ||
          span.parentElement?.parentElement?.parentElement;
        if (shouldSkipNonGrok(row, onlyGrok)) continue;
        const hasCheck = row && row.querySelector('input[type="checkbox"]');
        if (!hasCheck) continue;
        seen.add(id);
        items.push({ id, name: extractNameFromRow(row), platform: row && rowLooksGrok(row) ? 'grok' : '' });
      }
      return items;
    }

    /**
     * @param {{ onlyGrok?: boolean, includeValidation?: boolean, includeViolation?: boolean }} [opts]
     */
    function collectForbiddenFromDom(opts = {}) {
      const onlyGrok = opts.onlyGrok !== false;
      const includeValidation = opts.includeValidation !== false;
      const includeViolation = opts.includeViolation !== false;
      const allowed = new Set(['forbidden']);
      if (includeValidation) allowed.add('validation');
      if (includeViolation) allowed.add('violation');

      let rows = $$('tr[data-row-id], [role="row"][data-row-id]');
      if (!rows.length) {
        rows = $$('tr, [role="row"]').filter((r) => r.querySelector('input[type="checkbox"]'));
      }

      const items = [];
      const seen = new Set();
      for (const row of rows) {
        const hit = detectForbiddenInRow(row);
        if (!hit || !allowed.has(hit.type)) continue;

        const id = extractIdFromRow(row);
        if (!id || seen.has(id)) continue;
        if (shouldSkipNonGrok(row, onlyGrok)) continue;

        seen.add(id);
        items.push({
          id,
          name: extractNameFromRow(row),
          platform: rowLooksGrok(row) ? 'grok' : '',
          forbiddenType: hit.type,
          forbiddenText: hit.text,
        });
      }
      return items;
    }

    /**
     * @param {{
     *   onlyGrok?: boolean,
     *   timezone?: string,
     *   platform?: string,
     *   status?: string,
     *   statuses?: string[],
     *   extraParams?: Record<string, string>,
     * }} [opts]
     * statuses: client-side filter after fetch (error/normal/disabled/…).
     * status: passed as query param if set (server-side filter attempt).
     */
    async function fetchAllAccountIdsFromApi(opts = {}) {
      // Default onlyGrok=true for backward compat with grok-quota tool
      const onlyGrok = opts.onlyGrok !== false;
      const timezone =
        (opts.timezone || '').trim() ||
        (() => {
          try {
            return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Shanghai';
          } catch (_) {
            return 'Asia/Shanghai';
          }
        })();

      const statusFilter = (opts.statuses || [])
        .map((x) => normalizeStatusType(x))
        .filter(Boolean);
      const wantStatus = statusFilter.length ? new Set(statusFilter) : null;

      const pageSize = 100;
      let page = 1;
      let total = Infinity;
      const items = [];
      const seen = new Set();

      while (true) {
        const params = new URLSearchParams({
          page: String(page),
          page_size: String(pageSize),
          timezone,
        });
        if (onlyGrok) params.set('platform', 'grok');
        else if (opts.platform) params.set('platform', String(opts.platform));
        if (opts.status) params.set('status', String(opts.status));
        if (opts.extraParams && typeof opts.extraParams === 'object') {
          for (const [k, v] of Object.entries(opts.extraParams)) {
            if (v != null && v !== '') params.set(k, String(v));
          }
        }

        const data = await S2A.api.apiRequest(`/admin/accounts?${params.toString()}`);
        const rows = data?.items || data?.list || data?.accounts || data?.data || (Array.isArray(data) ? data : []);
        if (!wantStatus) {
          total = Number(data?.total ?? data?.count ?? rows.length) || rows.length;
        }

        for (const row of rows) {
          const id = String(row.id ?? row.account_id ?? '').trim();
          if (!id || seen.has(id)) continue;
          if (onlyGrok && row.platform && String(row.platform).toLowerCase() !== 'grok') continue;

          const statusRaw =
            row.status_label ??
            row.status_text ??
            row.status ??
            row.state ??
            row.account_status ??
            row.error_status ??
            '';
          const statusType = normalizeStatusType(statusRaw);

          if (wantStatus && !wantStatus.has(statusType)) continue;

          seen.add(id);
          items.push({
            id,
            name: row.name || row.email || '',
            platform: row.platform || '',
            type: row.type || '',
            statusType: statusType || '',
            statusText: statusRaw ? String(statusRaw) : statusType || '',
          });
        }

        if (!rows.length || rows.length < pageSize) break;
        if (!wantStatus && items.length >= total) break;
        page += 1;
        if (page > 500) break;
        await S2A.util.sleep(80);
      }
      return items;
    }

    S2A.domAccounts = {
      rowLooksGrok,
      extractIdFromRow,
      extractNameFromRow,
      detectForbiddenInRow,
      detectAccountStatusInRow,
      normalizeStatusType,
      collectSelectedFromDom,
      collectPageAccountsFromDom,
      collectForbiddenFromDom,
      collectByStatusFromDom,
      fetchAllAccountIdsFromApi,
    };
  })(S2A);

