  // --- S2A.auth ---
  (function (S2A) {
    function getAuthToken() {
      return (
        localStorage.getItem('auth_token') ||
        sessionStorage.getItem('auth_token') ||
        ''
      ).trim();
    }

    function assertLoggedIn() {
      const token = getAuthToken();
      if (!token) {
        throw new Error('未登录：localStorage 中没有 auth_token，请先登录管理后台');
      }
      return token;
    }

    S2A.auth = { getAuthToken, assertLoggedIn };
  })(S2A);

