# Competitors (skeleton, verify before using in the deck)

The table is a starting point from the team brief and proposal. **Every cell marked TODO(verify) must be
checked on the product's own site or store page, with the date checked.** Don't put an unverified cell on a slide.

| | PromptShield (this repo) | Caviard | Prompt Armour | Rescriber (CHI '25) | Nightfall |
|---|---|---|---|---|---|
| Form | Chrome extension | TODO(verify) | TODO(verify) | Research prototype, TODO(verify) | Enterprise DLP platform |
| Where detection runs | Local (rules) | Local, TODO(verify) | TODO(verify) | Local small model, TODO(verify) | Cloud, TODO(verify) |
| Sites | ChatGPT (Gemini roadmap) | ChatGPT, DeepSeek, TODO(verify others) | TODO(verify) | TODO(verify) | TODO(verify) |
| Restores real values in replies (two-way) | Yes, multi-turn, survives reload (24 h vault) | TODO(verify) | TODO(verify) | TODO(verify) | TODO(verify) |
| Indonesian IDs (NIK, NPWP, rekening, +62) | Yes (NIK structure check) | TODO(verify) | TODO(verify) | TODO(verify) | TODO(verify) |
| Names | Rule-based cues (no NER) | TODO(verify) | TODO(verify) | Model-based, TODO(verify) | TODO(verify) |
| Energy / right-size advice | Yes (estimates, sources listed) | TODO(verify) | TODO(verify) | No, TODO(verify) | No, TODO(verify) |
| Proof of what was sent | Yes (proof sheet) | TODO(verify) | TODO(verify) | TODO(verify) | TODO(verify) |
| Price | Free / open source (licence TODO) | TODO(verify) | Free; planned ~$5/mo Pro per brief, TODO(verify) | — | Enterprise pricing, TODO(verify) |

Also in the proposal: PiiI, PiiBlocker, PromptMask, Presidio SDK. If you cite them, re-verify the proposal's claims.

**Name note:** an unrelated Firefox add-on is also called "promptShield". Our store text and docs say
"PromptShield for ChatGPT, Indonesia-aware, two-way masking" to keep them distinct.

## Our honest positioning
- **Two-way**: users get useful answers because real values come back on screen. Most tools only redact.
- **Indonesia-aware**: NIK structure validation, NPWP, rekening with bank cues, +62 phones, Indonesian name cues.
- **Energy-aware**: right-size advice at the moment of sending, with visible assumptions.
- **Provable trust**: proof sheet, storage-only permission, no network calls, fail closed.
- **Weak spots to admit**: one site, rule-based names, no independent accuracy number yet.
