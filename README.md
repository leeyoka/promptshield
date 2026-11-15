# PromptShield

**A privacy and energy gateway for everyday AI use.** A Chrome extension for ChatGPT that finds personal data
in your prompt *on your device*, replaces it with placeholders before sending, puts the real values back in the
reply on your screen, and suggests a right-sized model with an estimated energy saving. On any other site
(Google Docs, Gmail, Gemini, …) the same engine works from a **side panel**: paste, copy the safe version, paste the AI's reply back to restore it.

Techtonic 3.0 Hackathon (IEEE SB Universitas Indonesia) · Team **Open Minded**: Rafael Raditya Setyono,
Yohana Indah Nathania Br Sihotang, Nayla Pramesti Adhina.

> Client-side **pseudonymization**, not end-to-end encryption and not anonymization: the masked prompt still
> goes to the AI provider. Energy figures are **estimates** from stated assumptions, not measurements.

## What it does
| | |
|---|---|
| **Shield** | Detects NIK (structure-validated, with spaces/dashes), NPWP, +62 phone numbers, email, cards (Luhn), bank account numbers (with a bank cue), API keys/JWT/bearer secrets, and names (rule-based cues). A review sheet shows **Original ↔ What the AI sees**. Low-confidence items (e.g. 16-digit order numbers) start unticked. |
| **Fail closed** | The masked text is written into ChatGPT's message box and **read back**. Only an exact match with an enabled send button is sent. Otherwise nothing is sent, the draft is restored, and "Copy safe text" is offered. Raw text goes only via the explicit "Send unmasked" button. |
| **Restore** | Same value → same placeholder across turns. Values are kept in an AES-GCM-256 vault (non-extractable key, IndexedDB, 24 h TTL), so replies are restored on screen even after a reload. Tolerant of `\[NIK\_1\]`, `[ nik_1 ]` and `NIK_1`. Text nodes only, never links or attributes. |
| **Right-size** | A point-based heuristic (reasoning, code, math, output length, simple-task cues in Indonesian + English) suggests Small / Medium / Large. A banner above the message box shows "≈ x–y Wh, estimate" with a **Why?** panel listing reasons and every assumption with its source. |
| **Side panel (any site)** | Open from the popup or with **Alt+Shift+P**. Paste text → switches → **Copy safe text** (verified). Paste the AI's reply → **Copy restored reply**. Uses the same vault, so placeholders match ChatGPT's. Nothing typed in the panel is stored, and the panel never reads the page. |
| **Proof & dashboard** | "View what was sent" shows the exact masked text. The popup shows counts only (items by type, suggestions accepted, estimated Wh range, 7-day sparkline) plus settings. |

Permissions: **`storage` and `sidePanel` only**. No host permissions, no network requests, no telemetry.

## Install (Load unpacked)
1. `chrome://extensions` → turn on **Developer mode**.
2. **Load unpacked** → select the `promptshield/` folder (the one containing `manifest.json`).
3. Open https://chatgpt.com and type a prompt with synthetic data, for example `NIK saya 3171016408980002`.
4. On any other site: click the PromptShield icon → **Open side panel** (or press **Alt+Shift+P**).

## Develop and test
Requires Node.js 18+ (tested on Node 24). No dependencies to install.
```bash
npm test          # unit + safety tests (node --test)
npm run eval      # writes docs/METRICS.md (detection, streaming restore, advisor agreement, latency)
node eval/check-heldout.js   # validates the independent held-out set
```
To try the in-page UI without ChatGPT, serve the project root with any static server and open
`/ui-preview/chat-mock.html` (a mock chat page, not ChatGPT, that loads the real content script; simulated replies).

## Layout
```
promptshield/                 Chrome MV3 extension
  manifest.json
  src/shared/                 single source of truth (also used by tests, popup and web demo)
    constants.js              types, settings defaults, ENERGY_ASSUMPTIONS (value/unit/source)
    detectors.js              all detectors + overlap resolution
    complexity.js             right-size advisor
    restorer.js               tolerant + streaming token restore
    masker.js                 build masked text, local fallback tokens (shared by content script + side panel)
    i18n.js, ui-tokens.js     ID/EN microcopy, design tokens and icons
  src/content/content-script.js   ChatGPT adapter, fail-closed send flow, review sheet, banner, restore
  src/background/             service-worker.js (router, counters), vault.js (encrypted IndexedDB vault)
  src/popup/                  dashboard, proof panel, settings, sandbox, open side panel
  src/sidepanel/              side panel for any site (mask → copy, restore reply → copy)
tests/                        node --test unit and safety tests
eval/                         seeded generator, eval scripts, advisor dev set, held-out folder (independent)
ui-preview/chat-mock.html     mock chat page for UI and flow review
web/                          interactive web demo (simulated AI replies)
docs/                         PLAN, METRICS, THREAT_MODEL, LIMITATIONS, ENERGY_ASSUMPTIONS, DESIGN, DEMO_SCRIPT, MANUAL_TESTS, COMPETITORS
```

## Evidence
See [`docs/METRICS.md`](docs/METRICS.md) (generated). Read its header: the synthetic detection set comes from our
own generator and is not an independent accuracy claim. Independent results come from `eval/dataset/heldout/`.

## Limits
See [`docs/LIMITATIONS.md`](docs/LIMITATIONS.md). In short: automatic interception on ChatGPT web only (other sites via the paste-based side panel), text only, rule-based names (no NER yet),
energy numbers partly `TODO(source)`, real-site behaviour checked manually.

## Legal context
Indonesia's UU PDP (Law No. 27 of 2022) puts obligations on anyone processing other people's personal data.
OWASP Top 10 for LLM Applications (2025) lists Sensitive Information Disclosure as LLM02. PromptShield helps
reduce what is shared; it does not by itself make a user or organisation compliant.
