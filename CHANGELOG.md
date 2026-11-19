# Changelog

## 1.4.0 (20 Nov 2026)
**Automatic upload scanning everywhere (incl. WhatsApp Web), and PDF scanning with text extraction + OCR.**
- **No more "Open panel & scan" click.** Photo OCR used to run only in the side panel, so with the panel closed
  (typical on WhatsApp Web) an upload stopped at a prompt that had to be clicked. Scans now run in a hidden
  offscreen document (`src/offscreen/`, `offscreen` permission) that ships Tesseract, PDF.js and the detectors. On
  ChatGPT, Gemini and WhatsApp Web a chosen, pasted or dropped photo/PDF is held back and scanned automatically,
  then released, reviewed per finding, or blocked. One flow for every site; the side-panel relay was removed.
- **PDFs: text extraction AND OCR.** Every page's text layer is read with PDF.js (`getTextContent`), and each page
  (first 20) is rendered to a canvas and read with Tesseract, so scanned PDFs (e.g. a photographed KTP saved as PDF)
  are caught too. Findings from both passes are merged and de-duplicated by type + canonical value, each tagged
  with where it was found. The safe `.txt` uses the embedded text, or the OCR text on scanned pages, and masks
  every occurrence of each item left ON.
- The side panel scanner accepts PDFs too (same combined scan, safe `.txt` download).
- OCR engine moved to `src/shared/ocr-engine.js` and the PDF scanner to `src/shared/pdf-scan.js` (shared by the
  offscreen document and the side panel). Rendered PDF pages get a clean, unprocessed OCR pass first (the photo
  contrast stretch can wash out text on a mostly-white page). Tests: `tests/pdf-scan.test.js`.

## 1.3.0 (19 Nov 2026)
**Per-finding upload review, PDF screening, and WhatsApp Web.**
- **Per-finding switches in the upload popup.** After a photo is scanned, every detected item is listed with its own
  teal switch (ON = mask, OFF = allow; all ON by default) and a live preview. **Kirim versi aman** pixelates only the
  word boxes (from Tesseract) of the items left ON, not the whole photo. Items whose position could not be found are
  marked, and if one of them stays ON the whole photo is pixelated. With everything OFF the safe button is disabled
  and a note explains why. **Batal** and **Kirim tanpa proteksi (berisiko)** are unchanged.
- **PDF uploads are screened** (file picker, paste, drag & drop). The service worker extracts the text with the bundled
  PDF.js (`lib/pdfjs/`, no network) and runs the shared detectors (`SCAN_PDF_FOR_PII`). A PDF with no confident
  finding uploads silently. Otherwise the same per-finding popup appears; the safe version is the PDF text with each
  item left ON replaced by `[TYPE_MASKED]`, uploaded as a `.txt` file in place of the PDF. Unreadable PDFs fail closed.
- **WhatsApp Web** (`web.whatsapp.com`) gets the photo and PDF upload guard. File inputs are re-hooked after every
  click and by a MutationObserver (WhatsApp re-creates them). If WhatsApp removed its input while the scan ran, the
  chosen files are handed over by pasting them into the message box instead.
- New shared helper `src/shared/image-redact.js` (box location incl. rotated OCR passes, region pixelation), tests in
  `tests/upload-guard.test.js`.

## 1.2.2 (15 Nov 2026)
**Fix (critical): after ChatGPT answered with an editable "Writing" block, PromptShield could read that block instead
of the message box**, so a follow-up sent by clicking the send button went out unmasked, the shield scan said
"No sensitive data found", and the model-suggestion banner stopped appearing (real-ChatGPT test "3b" and "6").
- The message box is now chosen safely: editors inside replies are ignored, the focused box wins, otherwise the bottom-most one.
  The early guard uses the same rule. Reproduced on the mock page (`?writing=1`, editor with the same id as the message box) and verified fixed, with and without ChatGPT's message markers.
- Editable blocks inside replies are **never modified** (edits there may be saved back to the site). They keep placeholders. The chip says so and has
  **Copy reply with real values**, which copies the latest reply with every placeholder restored, locally.
- The shield icon moved to the top right (it sat on top of ChatGPT's send button). The chip sits next to it.

## 1.2.1 (15 Nov 2026)
**Fix (critical): a follow-up message in the same ChatGPT chat could be sent unmasked** (real-ChatGPT test, "Tes 3").
- The send guard now runs at **`document_start`**, before ChatGPT's own scripts, so its capture listeners are first in line
  for Enter, pointer/mouse down, click and submit (`src/content/early-guard.js`). The main script plugs in its handlers when ready;
  until then any send with confident sensitive data is blocked.
- Send attempts are also blocked on **pointerdown/mousedown** (for sites that send before the click event).
- Send-button recognition no longer requires a `<form>` and also matches `*-send-button`, `aria-label` Send/Kirim, and submit buttons next to the message box.
- Enter is caught when focus is anywhere inside the message box (not only when the event target is).
- Mock page `ui-preview/chat-mock.html` gained `?site=eager` (site handles send in its own capture listeners) and `?site=pointer` (site sends on pointerdown). Both now block correctly with a real Enter/click.

**Other**
- Same value, any format → same placeholder: `3273055102990004`, `3273 0551 0299 0004` and `3273-0551-0299-0004` all become `[NIK_1]`
  (also +62/0 phones, email/name case). Canonical form is only used as the vault key (HMAC); the value restored is the first one stored.
- The "AI version" chip sits below the review sheet, and AI view switches off automatically after a new masked send.
- 43 tests.

## 1.2.0: side panel for any site (15 Nov 2026)
- New **side panel** (Chrome side panel API), usable next to any site (Google Docs, Gmail, Gemini, WhatsApp Web, …):
  1. paste text → local detection with switches → **Original ↔ Safe version** → **Copy safe text** (verified: refuses if an approved value would survive);
  2. paste the AI's reply → placeholders restored locally (same encrypted vault as ChatGPT) → **Copy restored reply**;
  plus the right-size suggestion with **Why?**. Panel text is never stored. The panel never reads the page.
- Open it from the popup ("Open side panel") or with **Alt+Shift+P**. Added permission: `sidePanel` only (still no host permissions).
- New shared module `src/shared/masker.js` used by both the ChatGPT content script and the side panel (no duplicated masking code). 41 tests.

## 1.1.3 (15 Nov 2026)
- Restored values in AI replies get a dotted teal underline (CSS Custom Highlight API; no elements inserted into ChatGPT's DOM).
- New chip at the top right: "Real values are shown only on your screen. The AI only saw placeholders." with **Show AI version**, which switches the reply to exactly what the AI wrote (placeholders) and back. (Real-ChatGPT test: the restored reply looked as if the AI had seen the data.)

## 1.1.2 (15 Nov 2026)
- Debug logs are now a switch in the popup (Settings → Debug logs). No file editing is needed; the extension works as soon as it is loaded.
- The popup header shows the installed version.
- Restore no longer touches the user's own bubbles even if ChatGPT's user marker differs: text that is part of a prompt we sent (placeholders only, kept in sessionStorage) is left as sent.

## 1.1.1 (15 Nov 2026)
- The user's own message bubbles are no longer restored on screen. They keep showing the placeholders that were actually sent, so it's visible that masking worked. Only the AI's replies are restored. (First real-ChatGPT test: masking worked, but restoring the user's bubble made it look as if the raw NIK had been sent.)

## 1.1.0: full rebuild of the core features (15 Nov 2026)

**Shield**
- Detectors in one shared file used everywhere (content script, popup, web demo, tests). Copies in the service worker and content script removed.
- New: NIK with spaces/dashes, NPWP (classic format and 15/16 digits with a cue), bank accounts (with a bank/rekening cue), JWT and bearer tokens, and rule-based names (`Nama:`, `a.n.`, `Bapak/Ibu`, `Yth.`, `saya <Nama>`, signatures).
- Context-aware confidence: the nearest cue on the same line wins. Order/resi/invoice numbers drop below the threshold and are listed as "possible" (unticked). Deterministic overlap resolution.
- New review sheet (Shadow DOM): inline highlights, **Original ↔ What the AI sees**, switches, partly hidden values, focus trap, Esc/Enter, ID/EN.
- The fail-closed send flow is kept and hardened (write → read back → enabled button → final check → send).

**Restore**
- Encrypted persistent vault in the service worker: AES-GCM-256, non-extractable keys in IndexedDB, HMAC index, 24 h TTL, "clear now". The same value gets the same token across turns and survives page reloads.
- Tolerant restorer (`[NIK_1]`, `\[NIK\_1\]`, `[ nik_1 ]`, bare `NIK_1`) with streaming hold-back. Restore happens in text nodes only.

**Right-size + energy**
- New point-based advisor with reasons (reasoning, code, math, output length, content task, simple-task cues). It is shown in the review sheet and in a banner above the message box with **Why?** (reasons and every assumption with its source).
- `ENERGY_ASSUMPTIONS` lists each value with unit and source. Unsourced values are marked `TODO(source)`. Accepting a suggestion records an estimated Wh range.

**Popup**
- Redesigned: protected count, 7-day sparkline, suggestions accepted, estimated Wh range, per-type counts, proof panel (last masked text), Try tab, settings that the content script actually reads (types, suggestions, threshold, language, vault TTL, clear).

**Evidence and docs**
- `npm test` (33 node tests incl. safety guards: no network, no logs, storage-only permission, fail-closed paths). `npm run eval` writes `docs/METRICS.md`. The held-out folder is reported separately.
- New docs: THREAT_MODEL, LIMITATIONS, ENERGY_ASSUMPTIONS, DESIGN, DEMO_SCRIPT, COMPETITORS (skeleton), updated MANUAL_TESTS. `ui-preview/chat-mock.html` is a mock page for UI/flow review.
- Manifest: `storage` only (host permissions and offscreen removed), CSP without wasm. Web demo claims toned down.

**Not done / not verified**
- Not yet tested on the real chatgpt.com (manual checklist). Gemini adapter, NER model and the web landing redesign are not done.
- No independent held-out data yet. Several energy sources are still TODO(source).

## 1.0.1b (15 Nov 2026)
- Fixed: the review sheet cleared its own findings list, so "Mask & Send" saw 0 items. In v1.0.0 this sent the **original** text.

## 1.0.1: Phase 1a "safe minimum" (15 Nov 2026)

Done before the source-code deadline so the submitted extension never sends unmasked text by accident.
The full rebuild (esbuild bundle, `src/core`, adapters, persistent vault) follows the plan in `docs/PLAN.md`.

**Send flow (`promptshield/src/content/content-script.js`)**
- **Fail closed.** The masked text is written into the composer and **read back**. If it doesn't match, or the send button isn't enabled within ~1.5 s, nothing is sent: the draft is restored and a "Copy safe text" button appears. The old fallback that sent the original text on error is gone.
- **Verified write.** Three strategies are tried in order (simulated paste → `insertText` → delete + `insertText`), each verified by read-back. This replaces the fixed 250 ms delay and the unverified `execCommand`. The synthetic Enter fallback is removed.
- Raw text is sent only when the user clicks **Send Unmasked**. "Mask & Send" is disabled when every item is unticked.
- The ~1 s bypass window after a send is replaced with a one-shot pass for our own click. User sends are blocked while the review sheet is open or masking is in progress. Enter during IME composition is ignored.
- The prompt text is re-read from the composer at send time (never a stale cached copy). The stored editor reference is re-resolved if ChatGPT re-rendered it.
- **Stable tokens across turns.** The same value gets the same token, and counters continue for the page. The restorer keeps every token from earlier turns, runs one observer without the 5-minute cutoff, and never rewrites the composer.
- `sendBG` is now defined (with a timeout). Counts per type go to the dashboard (counts only).
- Removed every `console.log` of prompts or detected values. A `PS_DEBUG` flag (off) logs only types, counts and timings.
- The review list shows partially hidden values (`3171••••••••0002`). The Escape listener no longer leaks.
- Removed the false "Protected with AES-GCM Vault" toast. The vault is not wired in yet.

**Other**
- Manifest: removed the unused `offscreen` permission. Version 1.0.1.
- Sample data: Luhn-valid demo card (the old `…4444` was never detected). Neutral bank wording (no real bank name).
- README: no absolute paths. Claims now match what runs, with limits stated.
- Tests: `npm test`. The suite now **exits non-zero on failure**. Added 7 safety-guard tests (30 total).
- Added `docs/PLAN.md`, `docs/MANUAL_TESTS.md`, `.gitignore`, `package.json`.

**Not done yet / not verified**
- Not tested on the real chatgpt.com. That needs the manual checklist.
- Detector gaps remain: NIK with spaces/dashes, NPWP, account numbers, names, and 16-digit order numbers flagged as NIK.
- Right-size banner not shown in ChatGPT. Energy figures not sourced.
- Detector code is still duplicated in three files (planned esbuild refactor).
