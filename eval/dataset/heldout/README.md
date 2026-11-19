# Held-out evaluation set (independent)

This folder holds the evaluation that the judges asked for: data written by someone who **has not read
the detector rules** (`promptshield/src/shared/detectors.js`). `npm run eval` reports it separately from
the synthetic set.

## Who fills it
One teammate who did not write or read the rules. Do not tune the rules on these files; if you look at
errors, move the file into `eval/dataset/dev/` and write a new held-out file.

## Rules for the data
- **Synthetic values only.** Invent NIK/phone/card/account numbers; never copy real ones.
  Card numbers must pass Luhn if you want them to count as cards (use test numbers like `4111 1111 1111 1111`).
- Write prompts the way real users would (complaint emails, contracts, customer rows, code with keys,
  thesis paragraphs, WhatsApp-style messages), in Indonesian and English.
- Include **clean prompts too** (no personal data, but numbers like order IDs, prices, dates, versions).

## Format
One or more `.json` files in this folder (files starting with `_` are ignored). Each file is an array:

```json
[
  {
    "text": "Halo kak, saya Dina Maharani mau komplain. No HP 0813 2222 1111, rek BRI 1234-56-789012-34-5.",
    "entities": [
      { "type": "NAME", "start": 20, "end": 33 },
      { "type": "PHONE", "start": 56, "end": 70 },
      { "type": "BANK_ACCOUNT", "start": 79, "end": 98 }
    ],
    "lang": "id",
    "source": "heldout:teammate-name"
  }
]
```

Types: `NIK`, `NPWP`, `PHONE`, `EMAIL`, `CARD`, `BANK_ACCOUNT`, `API_KEY`, `NAME`.
`start`/`end` are character offsets (end exclusive), the same as JavaScript `text.slice(start, end)`.
Check offsets with: `node eval/check-heldout.js`.

## Advisor labels (optional, separate file)
`advisor.json`: `{ "items": [ { "text": "...", "label": "Small" | "Medium" | "Large" } ] }`.
Label each prompt by asking: "Would a small, fast model answer this well?" (Small), "needs a mid-size model"
(Medium), "needs the strongest model" (Large). Label before running the advisor.
