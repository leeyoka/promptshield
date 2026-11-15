// PromptShield restorer core: pure text transforms, no DOM.
// Puts real values back in place of tokens like [NIK_1], tolerating common model/Markdown rewrites:
//   [NIK_1]  [ nik_1 ]  \[NIK\_1\]  [NIK\_1]  [BANK_ACCOUNT_2]  and bare NIK_1 (only for known tokens).
// Unknown tokens are left untouched. Restoring is idempotent.

var psRestorer = (function () {
  // Bracketed form, optional Markdown escapes and inner spaces.
  const BRACKETED = /\\?\[\s*([A-Za-z]+(?:\\?_[A-Za-z]+)*)\\?_(\d{1,4})\s*\\?\]/g;
  // Bare form (model dropped the brackets): TYPE_N as a whole word.
  const BARE = /(?<![\w\[])([A-Z]+(?:_[A-Z]+)*)_(\d{1,4})(?![\w\]])/g;
  // A possible unfinished token at the end of a stream chunk, e.g. "[NI", "\[NIK\_", "[NIK_1".
  // Also holds a lone trailing backslash and a bare "NIK_" / "NIK_1" that may continue.
  const PARTIAL_TAIL = /(?:\\?\[[A-Za-z_\\\s\d]{0,24}|\\|(?<![\w])[A-Z]+(?:_[A-Z]+)*_?\d{0,4})$/;

  function canonical(type, n) {
    return `[${type.replace(/\\/g, '').toUpperCase()}_${n}]`;
  }

  /**
   * @param {string} text
   * @param {Map<string,string>|Object<string,string>} map token -> original value
   * @returns {{text:string, count:number}}
   */
  function restore(text, map) {
    const get = map instanceof Map ? (k) => map.get(k) : (k) => (Object.prototype.hasOwnProperty.call(map, k) ? map[k] : undefined);
    let count = 0;
    let out = String(text).replace(BRACKETED, (whole, type, n) => {
      const v = get(canonical(type, n));
      if (v === undefined) return whole;
      count++;
      return v;
    });
    out = out.replace(BARE, (whole, type, n) => {
      const v = get(canonical(type, n));
      if (v === undefined) return whole;
      count++;
      return v;
    });
    return { text: out, count };
  }

  /**
   * Streaming restorer: feed chunks, get restored text that is safe to show now.
   * A trailing partial token is held back until the next chunk (or end()).
   */
  function createStream(map) {
    let buffer = '';
    return {
      push(chunk) {
        buffer += chunk;
        const m = buffer.match(PARTIAL_TAIL);
        const cut = m ? m.index : buffer.length;
        const ready = buffer.slice(0, cut);
        buffer = buffer.slice(cut);
        return restore(ready, map).text;
      },
      end() {
        const rest = restore(buffer, map).text;
        buffer = '';
        return rest;
      }
    };
  }

  /** True if text contains anything that looks like one of our tokens. */
  function looksLikeToken(text) {
    BRACKETED.lastIndex = 0;
    BARE.lastIndex = 0;
    return BRACKETED.test(text) || BARE.test(text);
  }

  return { restore, createStream, looksLikeToken, canonical };
})();

if (typeof globalThis !== 'undefined') {
  globalThis.psRestorer = psRestorer;
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { psRestorer };
}
