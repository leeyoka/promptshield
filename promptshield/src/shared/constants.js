// PromptShield shared constants.
// Single source of truth: loaded as a classic script by the content script, the service worker
// (importScripts), the popup and the web demo, and via require() in Node tests.

var PS_TYPES = {
  NIK: 'NIK',
  NPWP: 'NPWP',
  PHONE: 'PHONE',
  EMAIL: 'EMAIL',
  CARD: 'CARD',
  BANK_ACCOUNT: 'BANK_ACCOUNT',
  API_KEY: 'API_KEY',
  NAME: 'NAME',
  PASSPORT: 'PASSPORT'
};

/** Human labels per type (ID / EN). */
var PS_TYPE_LABELS = {
  NIK: { id: 'NIK', en: 'NIK (ID number)' },
  NPWP: { id: 'NPWP', en: 'Tax ID (NPWP)' },
  PHONE: { id: 'Nomor HP', en: 'Phone' },
  EMAIL: { id: 'Email', en: 'Email' },
  CARD: { id: 'Kartu', en: 'Card' },
  BANK_ACCOUNT: { id: 'Rekening', en: 'Bank account' },
  API_KEY: { id: 'Kunci API', en: 'API key / secret' },
  NAME: { id: 'Nama', en: 'Name' },
  PASSPORT: { id: 'No. Paspor', en: 'Passport number' }
};

var PS_ACTIONS = {
  MASK: 'PS_MASK',               // content -> SW: assign tokens for approved values (vault)
  GET_MAP: 'PS_GET_MAP',         // content -> SW: token -> value map for on-screen restore
  STATS: 'PS_STATS',             // popup -> SW: dashboard counters
  RECORD: 'PS_RECORD',           // content -> SW: counts only (items, advice shown/accepted, Wh)
  INCREMENT_STATS: 'PS_INCREMENT_STATS', // legacy alias of RECORD (items only)
  GET_SETTINGS: 'PS_GET_SETTINGS',
  SET_SETTINGS: 'PS_SET_SETTINGS',
  SET_LAST_SENT: 'PS_SET_LAST_SENT', // masked text only (proof panel)
  GET_LAST_SENT: 'PS_GET_LAST_SENT',
  CLEAR_VAULT: 'PS_CLEAR_VAULT',
  VAULT_INFO: 'PS_VAULT_INFO',
  NEXT_FACT: 'PS_NEXT_FACT'      // side panel -> SW: index of the energy fact to show, advanced for next time
};

var PS_TIERS = {
  SMALL: 'Small',
  MEDIUM: 'Medium',
  LARGE: 'Large'
};

/**
 * Energy assumptions. Every number has a unit and a source or an explicit TODO(source).
 * These are ESTIMATES used to show relative savings between model tiers, not measurements.
 */
var ENERGY_ASSUMPTIONS = {
  anchorMedianWh: {
    value: 0.24,
    unit: 'Wh per text prompt (median)',
    source: 'Google, "Measuring the environmental impact of delivering AI at Google scale" (Aug 2025): median Gemini Apps text prompt. Cited as ref [8] in the team proposal.',
    note: 'One provider, one model family, one point in time. Used only as an anchor for the Medium/Large boundary.'
  },
  smallRangeWh: {
    value: [0.02, 0.08],
    unit: 'Wh per prompt',
    source: 'TODO(source) — team assumption from the submitted proposal',
    note: 'Assumes small models use roughly 1/12 to 1/3 of the anchor.'
  },
  mediumRangeWh: {
    value: [0.08, 0.24],
    unit: 'Wh per prompt',
    source: 'TODO(source) — team assumption; upper bound = anchor',
    note: ''
  },
  largeRangeWh: {
    value: [0.24, 1.0],
    unit: 'Wh per prompt',
    source: 'TODO(source) — team assumption; lower bound = anchor',
    note: 'Luccioni et al., "Power Hungry Processing" (ACM FAccT 2024) report energy per query varying by large factors across model sizes; the exact factor here is not taken from that paper.'
  },
  currentModelAssumption: {
    value: 'Large',
    unit: 'tier',
    source: 'Assumption: chat sites default to their largest general model.',
    note: 'If the user already uses a small model, the real saving is lower (possibly zero).'
  }
};

// Derived per-tier ranges (kept for the popup sandbox and web demo).
var PS_ENERGY = {
  Small: { min: ENERGY_ASSUMPTIONS.smallRangeWh.value[0], max: ENERGY_ASSUMPTIONS.smallRangeWh.value[1], label: '0.02–0.08 Wh' },
  Medium: { min: ENERGY_ASSUMPTIONS.mediumRangeWh.value[0], max: ENERGY_ASSUMPTIONS.mediumRangeWh.value[1], label: '0.08–0.24 Wh' },
  Large: { min: ENERGY_ASSUMPTIONS.largeRangeWh.value[0], max: ENERGY_ASSUMPTIONS.largeRangeWh.value[1], label: '0.24–1.00 Wh' }
};

// Default settings (read by the content script and popup).
var PS_DEFAULTS = {
  enabledTypes: {
    NIK: true, NPWP: true, PHONE: true, EMAIL: true, CARD: true, BANK_ACCOUNT: true, API_KEY: true, NAME: true,
    PASSPORT: true
  },
  confidenceThreshold: 0.7,   // findings below this are listed unticked and never open the sheet alone
  rightSize: true,            // show right-size advice
  lang: 'auto',               // 'auto' | 'id' | 'en'
  vaultTtlHours: 24,
  debug: false,               // debug logs (types, counts, timings only)
  allowedHosts: ['chatgpt.com', 'chat.openai.com', 'gemini.google.com']
};

// Kept for the web demo highlight colours.
var PS_COLORS = {
  NIK: { bg: '#fde8e8', border: '#c81e1e', text: '#9b1c1c' },
  NPWP: { bg: '#fde8e8', border: '#c81e1e', text: '#9b1c1c' },
  PHONE: { bg: '#fdf6b2', border: '#9f580a', text: '#723b13' },
  EMAIL: { bg: '#def7ec', border: '#057a55', text: '#03543f' },
  CARD: { bg: '#fde8e8', border: '#c81e1e', text: '#9b1c1c' },
  BANK_ACCOUNT: { bg: '#fde8e8', border: '#c81e1e', text: '#9b1c1c' },
  API_KEY: { bg: '#edebfe', border: '#5521b5', text: '#4a1d96' },
  NAME: { bg: '#e1effe', border: '#1a56db', text: '#1e429f' },
  PASSPORT: { bg: '#fde8e8', border: '#c81e1e', text: '#9b1c1c' }
};

/** Indonesian document type labels for the image scanner feature. */
var PS_DOC_TYPES = {
  KTP: { id: 'KTP (Kartu Tanda Penduduk)', en: 'National ID Card (KTP)' },
  PASSPORT: { id: 'Paspor', en: 'Passport' },
  KK: { id: 'Kartu Keluarga', en: 'Family Card (KK)' },
  SIM: { id: 'SIM (Surat Izin Mengemudi)', en: 'Driving License' },
  BPJS: { id: 'Kartu BPJS', en: 'BPJS Insurance Card' },
  BUKU_REKENING: { id: 'Buku Rekening', en: 'Bank Passbook' },
  NPWP_CARD: { id: 'Kartu NPWP', en: 'Tax ID Card (NPWP)' },
  STR: { id: 'STR (Surat Tanda Registrasi)', en: 'Professional Registration Certificate' },
  OTHER_SENSITIVE: { id: 'Dokumen Sensitif Lainnya', en: 'Other Sensitive Document' }
};

if (typeof globalThis !== 'undefined') {
  globalThis.PS_TYPES = PS_TYPES;
  globalThis.PS_TYPE_LABELS = PS_TYPE_LABELS;
  globalThis.PS_ACTIONS = PS_ACTIONS;
  globalThis.PS_TIERS = PS_TIERS;
  globalThis.ENERGY_ASSUMPTIONS = ENERGY_ASSUMPTIONS;
  globalThis.PS_ENERGY = PS_ENERGY;
  globalThis.PS_DEFAULTS = PS_DEFAULTS;
  globalThis.PS_COLORS = PS_COLORS;
  globalThis.PS_DOC_TYPES = PS_DOC_TYPES;
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { PS_TYPES, PS_TYPE_LABELS, PS_ACTIONS, PS_TIERS, ENERGY_ASSUMPTIONS, PS_ENERGY, PS_DEFAULTS, PS_COLORS, PS_DOC_TYPES };
}
