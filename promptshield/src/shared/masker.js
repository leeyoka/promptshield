// PromptShield masker core: pure functions shared by the ChatGPT content script and the side panel.
// No DOM, no chrome APIs. Tokens normally come from the encrypted vault (service worker);
// createLocalTokenizer() is the fallback when the vault is unavailable.

var psMasker = (function () {
  /**
   * Replace approved findings with their tokens, left to right. Overlapping findings are skipped.
   * Throws if a finding no longer matches the text (stale offsets) or a token is missing:
   * callers must treat a throw as "do not send / do not copy".
   * @param {string} text
   * @param {Array<{id:number,start:number,end:number,value:string,approved:boolean}>} items
   * @param {Object<number,string>|string[]} tokens token per item id
   * @returns {string}
   */
  function build(text, items, tokens) {
    const asc = items.filter((i) => i.approved).sort((a, b) => a.start - b.start);
    let out = '';
    let cursor = 0;
    for (const f of asc) {
      if (f.start < cursor) continue;
      if (text.slice(f.start, f.end) !== f.value) throw new Error('finding offset mismatch');
      const token = tokens[f.id];
      if (typeof token !== 'string' || !token) throw new Error('missing token');
      out += text.slice(cursor, f.start) + token;
      cursor = f.end;
    }
    return out + text.slice(cursor);
  }

  /** Show only the edges of a value, e.g. 3171••••••••0002 (for lists; never for sending). */
  function partialValue(v) {
    const s = String(v || '');
    if (s.length <= 6) return '•'.repeat(s.length);
    const keep = s.length >= 12 ? 4 : 2;
    return s.slice(0, keep) + '•'.repeat(Math.min(12, Math.max(3, s.length - keep * 2))) + s.slice(-keep);
  }

  /**
   * Canonical form used to decide "same value": the same NIK written as 3273055102990004,
   * 3273 0551 0299 0004 or 3273-0551-0299-0004 gets the same token. +62 and 0 phone prefixes match.
   * Emails and names are compared case-insensitively. Only used as a key; the value shown on restore
   * is the one stored first.
   */
  function canonical(type, value) {
    const v = String(value == null ? '' : value);
    switch (type) {
      case 'NIK': case 'NPWP': case 'CARD': case 'BANK_ACCOUNT':
        return v.replace(/\D/g, '');
      case 'PHONE': {
        let d = v.replace(/\D/g, '');
        if (d.startsWith('62')) d = '0' + d.slice(2);
        return d;
      }
      case 'EMAIL': return v.trim().toLowerCase();
      case 'NAME': return v.trim().replace(/\s+/g, ' ').toLowerCase();
      default: return v;
    }
  }

  /** Fallback tokenizer: same (type, canonical value) => same token, counters continue. In-memory only. */
  function createLocalTokenizer() {
    const byKey = new Map();
    const counters = {};
    return function token(type, value) {
      const key = type + '\u0000' + canonical(type, value);
      let t = byKey.get(key);
      if (!t) {
        counters[type] = (counters[type] || 0) + 1;
        t = `[${type}_${counters[type]}]`;
        byKey.set(key, t);
      }
      return t;
    };
  }

  /** Escape HTML and wrap tokens in <mark class="tok"> for previews. */
  function highlightTokensHtml(text) {
    const esc = String(text == null ? '' : text)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    return esc.replace(/\[([A-Z]+(?:_[A-Z]+)*_\d+)\]/g, '<mark class="tok">[$1]</mark>');
  }

  return { build, partialValue, canonical, createLocalTokenizer, highlightTokensHtml };
})();

if (typeof globalThis !== 'undefined') globalThis.psMasker = psMasker;
if (typeof module !== 'undefined' && module.exports) module.exports = { psMasker };
