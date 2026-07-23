(function () {
  'use strict';

  /** @type {any} */
  const S2A = (window.__S2A__ = window.__S2A__ || {});
  S2A.version = '2.1.2';
  S2A.NS = 's2a';
  S2A.util = S2A.util || {};
  S2A.storage = S2A.storage || {};
  S2A.auth = S2A.auth || {};
  S2A.api = S2A.api || {};
  S2A.domAccounts = S2A.domAccounts || {};
  S2A.shell = S2A.shell || {};
  S2A.registry = S2A.registry || {};
  S2A.tools = S2A.tools || {};
  // registerTool / openTool etc. filled by registry.js
  // Modules below close over this IIFE scope and attach to S2A.

