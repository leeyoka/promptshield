// PromptShield design tokens: one source for the in-page UI (shadow DOM) and the popup.
// Calm, neutral greys + one deep-teal "shield" accent. See docs/DESIGN.md.

var PS_TOKENS_CSS = `
:host, :root {
  --ps-font: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI Variable", "Segoe UI", system-ui, sans-serif;
  --ps-mono: ui-monospace, "SF Mono", "Cascadia Mono", "Segoe UI Mono", Consolas, monospace;
  --ps-fs-12: 12px; --ps-fs-13: 13px; --ps-fs-15: 15px; --ps-fs-17: 17px; --ps-fs-22: 22px; --ps-fs-28: 28px;
  --ps-sp-1: 4px; --ps-sp-2: 8px; --ps-sp-3: 12px; --ps-sp-4: 16px; --ps-sp-5: 24px; --ps-sp-6: 32px;
  --ps-r-lg: 16px; --ps-r-md: 12px; --ps-r-sm: 8px;
  --ps-ease: cubic-bezier(.2, .8, .2, 1); --ps-dur: 200ms;

  --ps-bg: #ffffff; --ps-bg-2: #f5f6f6; --ps-bg-3: #eceeee;
  --ps-fg: #18181b; --ps-fg-2: #52525b; --ps-fg-3: #6b6b74;
  --ps-line: rgba(0, 0, 0, .08); --ps-line-2: rgba(0, 0, 0, .14);
  --ps-accent: #0f766e; --ps-accent-hover: #115e59; --ps-on-accent: #ffffff; --ps-accent-soft: #e7f3f1;
  --ps-danger: #b42318; --ps-danger-soft: #fdeceb; --ps-warn: #9a5b00; --ps-warn-soft: #fdf3e1; --ps-ok: #067647;
  --ps-mark: rgba(15, 118, 110, .14);
  --ps-shadow: 0 1px 2px rgba(0,0,0,.06), 0 8px 24px rgba(0,0,0,.10), 0 24px 64px rgba(0,0,0,.12);
  --ps-scrim: rgba(17, 17, 20, .32);
}
@media (prefers-color-scheme: dark) {
  :host(:not([data-theme="light"])), :root:not([data-theme="light"]) {
    --ps-bg: #1c1c1f; --ps-bg-2: #252529; --ps-bg-3: #2e2e33;
    --ps-fg: #f4f4f5; --ps-fg-2: #b4b4bb; --ps-fg-3: #93939b;
    --ps-line: rgba(255,255,255,.09); --ps-line-2: rgba(255,255,255,.16);
    --ps-accent: #2dd4bf; --ps-accent-hover: #5eead4; --ps-on-accent: #04201d; --ps-accent-soft: rgba(45,212,191,.12);
    --ps-danger: #ff8a80; --ps-danger-soft: rgba(255,138,128,.12); --ps-warn: #f5c164; --ps-warn-soft: rgba(245,193,100,.12); --ps-ok: #6ee7b7;
    --ps-mark: rgba(45,212,191,.18);
    --ps-shadow: 0 1px 2px rgba(0,0,0,.4), 0 12px 32px rgba(0,0,0,.45);
    --ps-scrim: rgba(0,0,0,.5);
  }
}
:host([data-theme="dark"]), :root[data-theme="dark"] {
  --ps-bg: #1c1c1f; --ps-bg-2: #252529; --ps-bg-3: #2e2e33;
  --ps-fg: #f4f4f5; --ps-fg-2: #b4b4bb; --ps-fg-3: #93939b;
  --ps-line: rgba(255,255,255,.09); --ps-line-2: rgba(255,255,255,.16);
  --ps-accent: #2dd4bf; --ps-accent-hover: #5eead4; --ps-on-accent: #04201d; --ps-accent-soft: rgba(45,212,191,.12);
  --ps-danger: #ff8a80; --ps-danger-soft: rgba(255,138,128,.12); --ps-warn: #f5c164; --ps-warn-soft: rgba(245,193,100,.12); --ps-ok: #6ee7b7;
  --ps-mark: rgba(45,212,191,.18);
  --ps-shadow: 0 1px 2px rgba(0,0,0,.4), 0 12px 32px rgba(0,0,0,.45);
  --ps-scrim: rgba(0,0,0,.5);
}
@media (prefers-reduced-motion: reduce) {
  :host, :root { --ps-dur: 0ms; }
}
`;

// Inline SVG icons (outline, 1.5px stroke). No icon fonts, no network.
var PS_ICONS = {
  shield: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l7 3v5c0 4.5-3 8.3-7 10-4-1.7-7-5.5-7-10V6l7-3z"/></svg>',
  shieldCheck: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l7 3v5c0 4.5-3 8.3-7 10-4-1.7-7-5.5-7-10V6l7-3z"/><path d="M9 12l2 2 4-4"/></svg>',
  leaf: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 19c0-8 5-13 14-14-1 9-6 14-14 14z"/><path d="M5 19l7-7"/></svg>',
  close: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  check: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
  alert: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 8v5M12 16.5v.01"/><circle cx="12" cy="12" r="9"/></svg>',
  info: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8v.01"/></svg>'
};

if (typeof globalThis !== 'undefined') {
  globalThis.PS_TOKENS_CSS = PS_TOKENS_CSS;
  globalThis.PS_ICONS = PS_ICONS;
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { PS_TOKENS_CSS, PS_ICONS };
}
