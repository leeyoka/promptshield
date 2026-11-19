# Limitations (honest list)

**Scope**
- Automatic interception on one site only: ChatGPT web (`chatgpt.com`, `chat.openai.com`) on desktop Chrome.
  On every other site (Google Docs, Gmail, Gemini, …) PromptShield works through the **side panel**, which is manual:
  paste → copy safe text → paste into the AI; then paste the reply back to restore. It does not watch or underline
  text inside other sites (that would need access to all sites, and Google Docs draws text on a canvas).
- Text typed or pasted into the message box only. File uploads, images, voice and the mobile apps are **not** covered.
- Selectors for ChatGPT's message box and send button can break when ChatGPT changes its page. They live in one
  adapter object in `content-script.js`. If masking cannot be applied, nothing is sent (fail closed).

**Detection**
- **Names are rule-based** (cues such as `Nama:`, `a.n.`, `Bapak/Ibu`, `Yth.`, `saya <Nama>`, signatures).
  A name written with no cue (e.g. "tolong kirim ke rina besok") is not detected. There is **no NER model**
  in this version. The proposal's NER plan is roadmap.
- Bank account numbers are detected only with a nearby cue (rekening, rek, BRI, BCA, …).
- Context cues count only on the same line. Labels on the previous line are ignored.
- 16-digit numbers that look like a NIK but follow words like "order", "resi" or "invoice" are listed unticked
  ("possible") instead of being masked automatically.
- Accuracy so far comes from our own synthetic generator, and the rules were adjusted on it. **Independent accuracy
  is not measured yet**: the held-out folder `eval/dataset/heldout/` is empty until a teammate fills it.

**Masking and restore**
- Pseudonymization, not anonymization. Text around a token can still identify a person.
- Tokens shown in the review sheet are reserved in the encrypted vault when the sheet opens, even if the user cancels (local only, expires with the TTL).
- Editable blocks inside replies (e.g. ChatGPT "Writing" blocks) are **not** restored on screen, on purpose: changing an editor's
  content could make the site save real values. Use **Copy reply with real values** in the chip, or the side panel.
- Restore works per text node. A token split across several DOM elements (e.g. syntax-highlighted code) may stay
  visible as a token. The streaming restore rate in `docs/METRICS.md` measures the text restorer, not the page DOM.
- If the AI rewrites a token in an unexpected way (translates it, drops the number), it is not restored.
- Values are kept for 24 h by default (configurable 1/24/72 h). After that, old replies show tokens again.

**Right-size advice**
- A heuristic, not a model. Agreement with human labels was measured only on a developer-labelled dev set.
- PromptShield does not read or change the selected model. The user switches models themselves. "Accepted"
  means the user clicked the button, not that a smaller model was actually used.
- Energy numbers are estimates from stated assumptions. Several are still `TODO(source)` (see `ENERGY_ASSUMPTIONS.md`).

**Not verified by us**
- Real-site behaviour on chatgpt.com: checked only by the team with `docs/MANUAL_TESTS.md`. Automated checks run on
  a mock page (`ui-preview/chat-mock.html`) that imitates a contenteditable editor, not ChatGPT's real ProseMirror.
- Browser latency (only Node latency is measured), SUS/usability (no user test run yet).
