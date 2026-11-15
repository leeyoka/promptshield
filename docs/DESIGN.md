# Design

**Intent:** calm, trustworthy, quiet. PromptShield is a guest on someone else's page. It appears only when it
has something to say and gets out of the way otherwise.

## Principles
1. **Quiet by default.** Nothing appears for clean prompts. A 32 px status icon sits in the bottom-right corner (idle / protected / not sent).
2. **Hierarchy through type and space**, not boxes. One accent colour. Neutral greys. Semantic colours only for status.
3. **One set of tokens** (`src/shared/ui-tokens.js`) is used by the in-page UI (Shadow DOM) and the popup.
4. **Honest labels.** Energy is always "estimate". Simulated AI replies are labelled. Values in lists are partly hidden (`3171••••••••0002`).
5. **Never block the user's choice.** The model suggestion never blocks sending. "Send unmasked" is always available but de-emphasised.

## Tokens
| Group | Values |
|---|---|
| Type scale | 12 / 13 / 15 / 17 / 22 / 28 px. Weights 500/600. Tabular numerals for all numbers |
| Fonts | System UI stack. System monospace for tokens and values. No web fonts, no icon fonts |
| Spacing | 4 / 8 / 12 / 16 / 24 / 32 px |
| Radii | 16 (sheet) / 12 (groups, toasts) / 8 (buttons) |
| Lines | 1 px hairlines at ~8% (light) / ~9% (dark) |
| Motion | 200 ms `cubic-bezier(.2,.8,.2,1)`, fade + 8 px rise. No bounce. Off under `prefers-reduced-motion` |
| Materials | Blur only on the modal scrim and the suggestion banner |

## Accent
| Option | Light / Dark | Notes |
|---|---|---|
| **Deep teal (chosen)** | `#0f766e` / `#2dd4bf` | Reads as "protected/safe" without the alarm of red or the default-UI feel of blue. It has no strong brand association with the chat sites or banks we work next to. White on `#0f766e` ≈ 5.4:1 (passes AA) |
| Emerald | `#047857` / `#34d399` | Close alternative. It sits closer to "success green" and would compete with success states |

Status colours: danger `#b42318` / `#ff8a80`, warn `#9a5b00` / `#f5c164`. They are always paired with an icon and a text label, never colour alone.

## Components
- **Review sheet** (hero moment): centred, max 560 px, scrim, focus trap, Esc = cancel, Enter = mask & send.
  It highlights detections inline in the prompt. A segmented control switches **Original ↔ What the AI sees**.
  Each row has a type label, a partly hidden value and a switch. Low-confidence items show "possible" and start unticked.
  The model suggestion row has an "estimate" chip and a "Why?" disclosure listing reasons and assumptions with sources.
- **Suggestion banner**: slim, above the message box, appears 0.7 s after typing stops. It has an estimate chip,
  "Why?", "OK, use a smaller model" and dismiss.
- **Toasts**: bottom centre. Success has a "View what was sent" action. Failure has a "Copy safe text" action and a red outline.
- **Proof sheet**: the exact masked text in monospace with highlighted placeholders, plus one line saying nothing else left the browser.
- **Restored values**: plain text in the reply. The parent element gets a "Restored locally" tooltip. No colour flashes.
- **Side panel**: two numbered cards. (1) "Mask before sharing": textarea, switches, Original ↔ Safe version, full-width
  **Copy safe text**, status line, suggestion card. (2) "Restore the AI's reply": textarea, restored text with dotted
  marks, **Copy restored reply**. A footer says nothing in the panel is stored. Works from 280 px wide.
- **Popup (360 px)**: grouped list like a settings app. Large tabular number for protected items, a 7-day inline-SVG
  sparkline, per-type list, proof panel, Try tab (same shared code), Settings (per-type switches, suggestions on/off,
  confidence threshold, language, vault TTL and "clear now").

## Accessibility
Dialog roles with `aria-modal`, labelled headings, `role="switch"` toggles, `aria-live` for counts and toasts,
visible 2 px focus rings, keyboard-only flow (Tab cycles inside the sheet), 44 px rows in lists, and AA contrast for text and the primary button.

## Review pages
`ui-preview/chat-mock.html` is a mock chat page (not ChatGPT) that loads the real content script. Modes: normal,
"ignores paste" (forces the fallback write) and "rejects all writes" (shows fail closed). It has a dark toggle.
Serve the project root with any static server and open `/ui-preview/chat-mock.html`.

## Not done yet
Screenshots in `docs/screens/`, a full Indonesian/English pass on the web landing page, and a redesign of `web/`
to these tokens (the landing page still uses its older style).
