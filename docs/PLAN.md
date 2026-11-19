# PromptShield — Final-Round Rebuild Plan (Phase 0)

Status: **draft, waiting for team approval**. No code was changed. The working copy has a baseline commit
(`e7b1f44`, untouched extract of `hackathon.zip`) and the branch `final-rebuild`.

Inputs I read: `BRIEF.md` (rebuild brief), *FINAL GUIDELINES HACKATHON TECHTONIC 3.0* (9 pages),
*FPH_OpenMinded* (full proposal, 16 pages), *SM_Semifinal* (score sheet + judge feedback), and every file in the archive.

---

## 1. Timeline: the main constraint

From the final guidelines:

| Date | What |
|---|---|
| **1–15 Nov 2026** | Development period. Deliverables: working prototype, **source code on GitHub**, **demo video ≤ 5 min**, deployment link if any |
| 1–20 Nov | Pitch deck submission |
| **21 Nov, 08:00 WIB** | Grand Final on Zoom: 10 min presentation + 10 min live demo + 10 min Q&A |

Today is **15 Nov**. The brief has six phases, and the code/video deadline may be today. All six can't be
done properly before then, so the plan below is ordered by **what the live demo on 21 Nov needs**.
→ **Question 1** (section 7).

The guidelines say the demo video will be posted on the TECHTONIC Instagram, so it must use only synthetic data.

The scoring criteria page (p. 7) is an image, and its text could not be extracted. The weights in the brief
(25/20/15/15/10/15) are still **unconfirmed**. Please read them from the PDF and tell me.

---

## 2. Audit: brief's problem list, checked against the code

All 13 problems in the brief are **confirmed**. Evidence:

| # | Problem | Evidence (file:line in baseline) |
|---|---|---|
| 1 | Unreliable masked send | `content-script.js:270-276` uses `execCommand('selectAll'/'delete'/'insertText')` and falls back to `innerHTML=` (ProseMirror ignores it). Nothing reads the text back. `setTimeout(...,250)` before clicking send (`:660`). `currentEditor` is captured at intercept time and can be stale after a React re-render |
| 2 | Fail-open | `handleShieldedSend` catch → `deliverPrompt(currentText)` (`:644-648`). With 0 approved items it also sends the raw text (`:606-609`) |
| 3 | `sendBG` undefined | Called at `:629`, defined nowhere → throws `ReferenceError`. The inner `try` swallows it, so the vault and stats **never run** |
| 4 | Vault unused / in memory / bad tabId | Tokens are built in the content script (`:619-625`). The SW vault is a `Map` that is lost when the worker sleeps. `tabId: window.location.href` (`:633`) vs. numeric `tabId` in `onRemoved` (`service-worker.js:617`), so cleanup never matches |
| 5 | Counters reset per prompt | `const counters = {}` per send (`:619`). Numbering is assigned in **reverse** order (the last item becomes `_1`). `startLocalRestorer` disconnects the previous observer and its mapping (`:681-683`), so turn 1 tokens stop restoring after turn 2 |
| 6 | Not streaming-safe | `checkAndRestore` matches exact `[TYPE_n]` inside one text node only. No hold-back, tolerance or Markdown-escape handling |
| 7 | Advisor/energy not wired | The content script never calls `psComplexity`. `energySavedWh` is never incremented outside the web demo |
| 8 | Length-dominated heuristic | Confirmed by reading `complexity.js`. Energy ranges in `constants.js:30-35` cite "[8] [9]" but the numbers are not traceable to those sources |
| 9 | No names | `offscreen.js` is a placeholder, and nothing creates the offscreen document. The heuristic there is never called |
| 10 | Detector gaps | Probed with Node: `3171 0123 0495 0001` and `3171-0123-0495-0001` → not found. `Order ID 3171012304950001` → flagged as NIK. NPWP `09.254.294.3-407.000` → not found. `No. rek BRI 0123-01-012345-50-1` → not found. `Nama: Rina Sari` → not found |
| 11 | Raw logging, unread settings | `console.log('Checking prompt:', text)` (`:350`) and findings with values (`:358`, `:788`). `PS_DEFAULTS` is written on install, and nothing reads it |
| 12 | Triplicated code | Detectors/constants/complexity exist in `shared/`, inline in `service-worker.js`, and a **reduced** copy inline in `content-script.js` (only 5 API key patterns, no generic-secret rule). The tests cover only `shared/`. The copies have already drifted: the SW copy of `scoreSubtasks` has the regex `[\.\\)]` while `shared/` has `[\.\)]` |
| 13 | README | Absolute `c:\Users\Rafael\...` paths. Claims "AES-GCM vault" and "real-time energy counters" that don't run in the extension |

### Additional problems found (not in the brief)

- **A. The demo sample card is invalid.** `4111 2222 3333 4444` (popup sandbox sample) fails Luhn, so the "Rina" sandbox demo shows 4 findings, not 5. The sample also names a real bank (Bank Mandiri). Replace it with a Luhn-valid test number and a neutral or BRI-style synthetic scenario.
- **B. The proposal's metrics have no script in the archive.** 99.6% recall / 99.3% precision, 400/400 restores and 0.03 ms latency appear in the proposal and in the judges' feedback, but no generator or eval script was shipped (the proposal mentions seed `20261015`). We must regenerate them with `eval/` or stop citing them.
- **C. Tests can't fail CI.** `tests/suite.js` never sets `process.exitCode`, so `node tests/suite.js` exits 0 even when asserts fail.
- **D. Bypass window after any programmatic send.** `isShielding = true` for ~1.25 s (`:652-673`). During that window **any** real user Enter or click skips detection.
- **E. Synthetic Enter fallback.** `deliverPrompt` dispatches an `isTrusted:false` `KeyboardEvent` when the button is disabled. ChatGPT may ignore it, which leaves masked text in the composer with no feedback.
- **F. Offset drift.** The intercept text is `.trim()`-ed `innerText` from `livePromptText` (it can be stale). The masked text is then built from those offsets, which is a mismatch risk with what is really in the editor.
- **G. Restorer scope.** It observes all of `<main>`, including the user's own bubbles and the composer, writes `node.textContent` that React may re-render (flicker or loss), and disconnects itself after 5 minutes.
- **H. False UI claim.** The toast "Protected N items with AES-GCM Vault" (`:640`) shows even though the vault call failed.
- **I. Injected UI outside Shadow DOM.** The floating 🛡️ button and the toasts go straight into the host DOM, are re-injected every 2 s, and use emoji as icons. The modal shows **full raw values** and confidences, has no focus trap, and its `keydown` Escape listener leaks.
- **J. Unused permission and CSP.** `offscreen` is declared but never used. `'wasm-unsafe-eval'` is only needed if NER ships.
- **K. `web/` loads `../promptshield/src/shared/*.js`** via relative paths, so the demo breaks if `web/` is deployed alone.

### Where the rebuild differs from the submitted proposal (to explain to judges)

| Proposal said | Rebuild does | Why (reasonable adjustment, same core concept) |
|---|---|---|
| TypeScript, Vitest, Playwright | Plain JS + JSDoc, `node --test`, esbuild | Brief rule 7: less tooling risk in the time left. Types are documented with JSDoc |
| Vault cleared on tab close; "after reload, placeholders stay visible" (known limit) | Encrypted vault persisted with a TTL (default 24 h) and "clear now" | Fixes the limit the proposal itself listed. Still local-only, AES-GCM, non-extractable key |
| Detection runs in the service worker (DETECT message) | Detection runs in the content script from the **same bundled module** | No round-trip for a pure function. A single source of truth is kept by bundling. The message contract keeps MASK/LOOKUP/STATS/ADVISE-record |
| NER via offscreen ONNX model, one-time download | Rule-based names first; NER is optional, bundled locally, off by default | Brief rule 3 (no network) and the time left. See Question 2 |

---

## 3. Target architecture (summary)

As in brief §6: `src/core` (pure, Node-tested) → bundled by esbuild into `dist/` for the content script, SW and popup.
`adapters/chatgpt.js` is the only file with ChatGPT selectors. `content/orchestrator.js` runs the fail-closed state machine.
The vault lives in the SW (IndexedDB plus a non-extractable AES-GCM key). Tests import `src/core` directly, which is the same code esbuild ships.

---

## 4. File-by-file change list, by phase

Ordering principle: **Shield reliability → restore → advisor wiring → evidence → polish.** The UI is rebuilt in Phase 1
because the modal is rewritten there anyway. The full design pass and `ui-preview/` come in Phase 3.

### Phase 1: foundation + reliable send (highest priority)
- **Add** `package.json` (scripts: `build`, `test`, `eval`; devDep `esbuild` only), `build/build.mjs`, `.gitignore`, `CHANGELOG.md`, `CLAUDE.md` (hard rules).
- **Add** `src/core/constants.js`, `src/core/detectors/{nik,phone,email,card,apikey,index}.js`, extracted unchanged from `shared/detectors.js` (with the full API key set). Behaviour stays the same in this step.
- **Add** `src/core/masker.js` (minimal for now: forward numbering, conversation-scoped, same value → same token).
- **Add** `src/adapters/adapter-contract.md` and `src/adapters/chatgpt.js`: ordered selector fallbacks, `setText` strategy chain (simulated paste → `beforeinput`/`insertText` → `execCommand`), `readBack` with normalisation, `isSendEnabled`, `onUserSend` (capture phase, IME-aware), `getConversationId`. A self-check logs which selector matched (DEBUG only).
- **Add** `src/content/orchestrator.js`: intercept → detect → preview → mask → write → verify (MutationObserver/poll ≤ 1.5 s) → send only if verified and enabled. Otherwise restore the draft and show the "nothing was sent" toast with **Copy safe text**. Uses a per-send re-entrancy token instead of a time window (fixes D).
- **Add** `src/content/ui/` (shadow-DOM modal, toast, status indicator) and `src/shared/messaging.js` (`sendBG` with timeout and typed errors).
- **Add** `src/shared/log.js`: a `DEBUG` flag that logs types, counts, offsets and timings only.
- **Rewrite** `background/service-worker.js` as a router only (no inlined copies).
- **Delete** `content-script.js`, the inline copies, `shared/*.js` (moved to core), `content-style.css` (replaced by shadow styles), and `offscreen/` plus the `offscreen` permission (re-added only if NER ships).
- **Rewrite** `manifest.json` → points at `dist/` bundles. Hosts: `chatgpt.com`, `chat.openai.com`.
- **Migrate** `tests/suite.js` → `tests/*.test.js` (`node --test`), with the same 23 asserts plus orchestrator logic tests against a fake adapter (fail-closed paths, including failure injection).
- **Fix** popup and web sample data (A).
- **Add** `docs/MANUAL_TESTS.md` (≥ 10 scenarios from the brief, each with the expected DEBUG log lines).

### Phase 2: masker / vault / restorer
- `src/core/masker.js`: full version (configurable format, counters persisted per conversation).
- `src/background/vault.js`: IndexedDB, AES-GCM-256, non-extractable key persisted in IDB, TTL, clear, and pending-id → rebind when `/c/<id>` appears. Keyed by `sender.tab.id` + conversation id.
- `src/core/restorer-core.js`: pure, tolerant (case, spaces, `\[NIK\_1\]`, missing brackets), hold-back for partial tokens, idempotent.
- `src/content/restorer-dom.js`: observes **assistant message roots only** (from the adapter), text nodes only (never attributes), dotted underline with the "Restored locally" tooltip.
- `eval/run-restore-eval.js` (≥ 200 random-chunked streams, prints the rate). Tests: same value → same token across turns, restore after the SW restarts (simulated).

### Phase 3: detectors + advisor + dashboard + design system
- Detectors: NIK with spaces/dashes, context suppression (order/invoice/resi/ID transaksi), `npwp.js`, `rekening.js`, `names.js` (rules), and deterministic overlap resolution. One test file per detector.
- `src/core/advisor.js`: new features, top reasons, and `ENERGY_ASSUMPTIONS {value, unit, source, note}`. **Unsourced values become `TODO(source)`.** Range output only.
- Wiring: right-size banner near the composer, stats (counts by type, advice shown/accepted, Wh estimate), proof panel.
- Popup: dashboard + settings that the content script actually reads (per-type toggles, threshold, token format, TTL/clear, debug).
- `tokens.css`, `docs/DESIGN.md`, `ui-preview/` with fixtures, and screenshots if headless Chrome is available (I'll check `chrome --headless` at that point).

### Phase 4: evidence
- `eval/dataset/` schema, seeded generator, `eval/dataset/heldout/` (filled by a teammate who hasn't seen the rules), and `run-detection-eval.js`, `run-latency-bench.js`, `run-advisor-eval.js` → `docs/METRICS.md`. Held-out results are reported separately.

### Phase 5: Gemini (time-boxed) + docs
- `adapters/gemini.js` behind a flag, plus `THREAT_MODEL.md`, `LIMITATIONS.md`, `COMPETITORS.md` (`TODO(verify)` cells), `DEMO_SCRIPT.md`, and README cleanup + LICENSE (README/proposal say MIT).

### Phase 6: packaging + landing
- FINAL zip, versioned manifest, accessibility pass, and `web/` rebuilt on the same core bundle (simulated replies labelled).

**Every phase ends with** tests → commit → `deliveries/promptshield-phase<N>-<YYYYMMDD-HHMM>.zip` → extract to temp → `npm test` there → report.

---

## 5. Risks

| Risk | L/I | Mitigation |
|---|---|---|
| ChatGPT's ProseMirror rejects every programmatic write | M/H | Strategy chain + read-back; if all fail, fail closed with **Copy safe text** (still safe and demo-able). Needs your real-browser logs |
| ChatGPT changes selectors before 21 Nov | M/H | All selectors live in the adapter with ordered fallbacks; the DEBUG self-check names the matched selector so it can be patched fast |
| ChatGPT Markdown mangles `[NIK_1]` (e.g. `\_`, link syntax) | M/M | Tolerant restorer + swappable format (`{{NIK_1}}`, `⟦NIK_1⟧`); verify on the real site in Phase 2 |
| `npm install esbuild` blocked (network/proxy) | L/H | Fallback: a tiny hand-written concat bundler script (no deps). I'll report it if this happens |
| Not enough time for all phases | **H/H** | Priority order above. Each phase zip is a usable, demo-able state |
| No independent dataset before the final | M/M | Harness ready in Phase 4; until a teammate fills `heldout/`, docs say "synthetic only, same authors" |
| Energy numbers lack sources | H/M | `TODO(source)` + "estimate" labels. You supply 2–3 sources (e.g. the Google 0.24 Wh median the proposal cites) |

---

## 6. Test plan

- **Unit (`node --test`)**: every detector (positive/negative/edge/false-positive guard), masker (stable tokens, multi-turn), restorer-core (split tokens, tolerant forms, idempotency), advisor (reasons, tiers), and orchestrator state machine with a fake adapter (each failure path sends **nothing**).
- **Eval scripts**: restore rate (random chunking), detection P/R/F1 per type (synthetic vs. held-out separately), latency p50/p95, advisor agreement. These print markdown, nothing is hard-coded.
- **Static checks in `npm test`**: grep-based guards so that no `console.log` of text/values, no `fetch`/`XMLHttpRequest`/`sendBeacon` appear in `src/`, and the manifest permissions match an allow-list.
- **Manual (you, in real Chrome)**: `docs/MANUAL_TESTS.md` after each phase, with the exact DEBUG lines to paste back. I won't claim a browser fix works until you confirm.

---

## 7. Decisions I need from you

1. **Deadline and scope.** Is the GitHub source + demo video due **today (15 Nov)**, or can code keep changing until the 21 Nov final?
   *Recommendation:* if it's due today, I do a Phase 1 "safe minimum" right now (fail-closed send + no raw logs + fixed samples) so the submitted repo isn't fail-open, then continue for the live demo.
2. **Names / NER.** The judges explicitly mentioned NER.
   *Recommendation:* rule-based names in Phase 3 (honest, fast). NER only as a stretch: bundle `ner-pii-indonesian-mini` (~11.7 MB, MIT per the proposal) **inside the extension** (no download, so rule 3 holds), off by default, with measured latency. Otherwise docs say "names are rule-based".
3. **Vault lifetime.** Persist with a 24 h TTL (survives reload, which the brief requires) instead of the proposal's "clear on tab close". OK?
4. **Accent colour.** Deep teal/emerald, as the brief suggests? (Two options will be in `DESIGN.md`.)
5. **Scoring weights.** Please read p. 7 of the final guidelines (it's an image) and confirm the weights.
6. **Git and GitHub.** I'll commit locally as your configured git user with no AI attribution trailers (per the brief). I will **not** push. You upload the zip or repo to GitHub yourselves. OK?

Reply with "approved" (plus answers) and I'll start Phase 1.
