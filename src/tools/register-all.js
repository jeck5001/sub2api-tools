// --- Register all tools (add one line per tool) ---
(function (S2A) {
  if (S2A.tools['grok-quota'] && typeof S2A.tools['grok-quota'].register === 'function') {
    S2A.tools['grok-quota'].register();
  }
  if (S2A.tools['grok-degrade'] && typeof S2A.tools['grok-degrade'].register === 'function') {
    S2A.tools['grok-degrade'].register();
  }
  if (
    S2A.tools['delete-error-accounts'] &&
    typeof S2A.tools['delete-error-accounts'].register === 'function'
  ) {
    S2A.tools['delete-error-accounts'].register();
  }
  if (S2A.tools['disable-accounts'] && typeof S2A.tools['disable-accounts'].register === 'function') {
    S2A.tools['disable-accounts'].register();
  }
  // Add more tools here:
  // if (S2A.tools['foo'] && typeof S2A.tools['foo'].register === 'function') S2A.tools['foo'].register();
})(S2A);
