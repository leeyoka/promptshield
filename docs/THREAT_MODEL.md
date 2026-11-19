# Threat model

PromptShield does **client-side pseudonymization**: approved sensitive values are replaced with tokens
(`[NIK_1]`) in the browser before a prompt is sent to the chat site, and restored on screen in the reply.
It is not end-to-end encryption and not anonymization. The masked prompt still goes to the AI provider.

## Assets
| Asset | Where it lives | Protection |
|---|---|---|
| Real values that were masked | Service-worker IndexedDB (`promptshield-vault`) | AES-GCM-256, fresh IV per value, **non-extractable** key in IndexedDB. HMAC index (no plaintext lookup). TTL (default 24 h). "Clear vault now" in the popup also rotates keys |
| Token → value map for on-screen restore | Content-script memory of the open chat tab | Lives only while the tab is open. Written only into text nodes, never into attributes or links |
| Last masked prompt (proof panel) | `chrome.storage.session` (memory, not disk) | Contains placeholders only |
| Counters | `chrome.storage.local` | Counts per type, advice shown/accepted, Wh estimate ranges. Never text |
| Settings | `chrome.storage.local` | No personal data |

## What leaves the browser
- **Only** the text the user sends to the chat site. With "Mask & send" that is the masked text, verified by
  reading the message box back before the send is released.
- The extension itself makes **no network requests** (no fetch/XHR/WebSocket/beacon; enforced by `tests/safety.test.js`).
- If the user clicks **"Send unmasked"**, the original text is sent. That is an explicit choice.

## Adversaries and what we do
| Adversary / failure | Risk | Mitigation | Residual |
|---|---|---|---|
| AI provider logs or trains on prompts | Personal data retained by a third party | Values replaced before sending | Context around tokens still leaks (e.g. "my NIK is [NIK_1], I live in…"). Undetected values leak |
| Masking fails silently on the site's editor | Raw text sent | **Fail closed**: write → read back → compare → only then click send. Any mismatch restores the draft, sends nothing, offers "Copy safe text" | A future site change can make masking impossible (the user then sees the error) |
| Malicious reply content (e.g. a link with a token in the URL) | Restored value exfiltrated via a link | Restore only in visible text nodes, never in `href`/`src`/attributes | The value is visible on screen to anyone looking at it |
| Other extensions / malware on the device | Read page DOM or extension storage | Out of scope: same trust boundary as the browser profile | — |
| Stolen laptop or profile copy | Read vault | Values are encrypted. The key is non-extractable but stored in the same profile | Key and ciphertext share a profile, so this deters casual access only, not a full profile compromise |
| Logs | Values in console | No `console.log` of text or values. A DEBUG flag (off) logs only types, counts, timings | — |

## Permissions
- `storage` and `sidePanel` only. **No `host_permissions`**, no `tabs`, `history`, `cookies`, `webRequest`, `scripting`, `offscreen`.
- The side panel can't read any page. It only sees text the user pastes into it, and that text is never stored.
- The content script runs only on `https://chatgpt.com/*` and `https://chat.openai.com/*`.
- CSP: `script-src 'self'; object-src 'self'` (no remote code, no WASM).

## Not covered
File uploads, images, voice, other AI sites (Gemini is roadmap), names written without cues, and values the
user unticks. See `LIMITATIONS.md`.
