  // --- S2A.api ---
  (function (S2A) {
    function getApiBase() {
      // sub2api SPA axios baseURL = /api/v1
      return `${location.origin}/api/v1`;
    }

    async function apiRequest(path, opts = {}) {
      const token = S2A.auth.getAuthToken();
      if (!token) throw new Error('未登录：localStorage 中没有 auth_token，请先登录管理后台');

      const url = path.startsWith('http')
        ? path
        : `${getApiBase()}${path.startsWith('/') ? '' : '/'}${path}`;
      const method = (opts.method || 'GET').toUpperCase();
      const headers = {
        Accept: 'application/json',
        Authorization: `Bearer ${token}`,
        ...(opts.headers || {}),
      };
      if (opts.body && !headers['Content-Type']) headers['Content-Type'] = 'application/json';

      // Prefer same-origin fetch
      if (url.startsWith(location.origin) || !url.startsWith('http')) {
        const res = await fetch(url, {
          method,
          headers,
          credentials: 'include',
          body: opts.body || undefined,
        });
        let data = null;
        const ct = (res.headers.get('content-type') || '').toLowerCase();
        if (ct.includes('application/json')) data = await res.json();
        else {
          const text = await res.text();
          try {
            data = JSON.parse(text);
          } catch {
            data = { message: text.slice(0, 300) };
          }
        }
        if (!res.ok) {
          const msg = data?.message || data?.detail || data?.error || res.statusText || `HTTP ${res.status}`;
          const err = new Error(typeof msg === 'string' ? msg : JSON.stringify(msg));
          err.status = res.status;
          err.data = data;
          throw err;
        }
        // sub2api wraps {code, message, data}
        if (data && typeof data === 'object' && 'code' in data) {
          if (data.code === 0 || data.code === 200) return data.data;
          throw new Error(data.message || `业务错误 code=${data.code}`);
        }
        return data;
      }

      // Fallback GM_xmlhttpRequest for cross-origin
      return new Promise((resolve, reject) => {
        if (typeof GM_xmlhttpRequest !== 'function') {
          reject(new Error('跨域请求需要 GM_xmlhttpRequest'));
          return;
        }
        GM_xmlhttpRequest({
          method,
          url,
          headers,
          data: opts.body || undefined,
          responseType: 'json',
          onload(resp) {
            let data = resp.response;
            if (data == null && resp.responseText) {
              try {
                data = JSON.parse(resp.responseText);
              } catch {
                data = { message: resp.responseText.slice(0, 300) };
              }
            }
            if (resp.status < 200 || resp.status >= 300) {
              const err = new Error(data?.message || `HTTP ${resp.status}`);
              err.status = resp.status;
              err.data = data;
              reject(err);
              return;
            }
            if (data && typeof data === 'object' && 'code' in data) {
              if (data.code === 0 || data.code === 200) resolve(data.data);
              else reject(new Error(data.message || `业务错误 code=${data.code}`));
              return;
            }
            resolve(data);
          },
          onerror: () => reject(new Error('网络错误')),
          ontimeout: () => reject(new Error('请求超时')),
        });
      });
    }

    async function deleteAccount(accountId) {
      return apiRequest(`/admin/accounts/${encodeURIComponent(accountId)}`, { method: 'DELETE' });
    }

    S2A.api = { getApiBase, apiRequest, deleteAccount };
  })(S2A);

