/**
 * early-guard.js
 * Injected at document_start to register the PromptShield sentinel
 * before any page script runs.
 */

(function () {
  'use strict';

  Object.defineProperty(window, '__promptShieldActive', {
    value: true,
    writable: false,
    configurable: false,
    enumerable: false,
  });

  window.__promptShieldVersion = '1.0.0';
})();
