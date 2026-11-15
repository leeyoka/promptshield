# Energy assumptions (right-size advice)

PromptShield shows an **estimated** energy saving when a smaller model is likely enough. Nothing is
measured on the user's machine or at the provider. Every number lives in one place,
`ENERGY_ASSUMPTIONS` in `promptshield/src/shared/constants.js`, and the in-page "Why?" panel lists them with
their sources.

| Assumption | Value | Source | Status |
|---|---|---|---|
| Anchor: median text prompt | 0.24 Wh | Google, *Measuring the environmental impact of delivering AI at Google scale* (Aug 2025), median Gemini Apps text prompt. Cited as ref [8] in our proposal | Sourced (one provider, one model family) |
| Small model per prompt | 0.02–0.08 Wh | Team assumption from the submitted proposal | **TODO(source)** |
| Medium model per prompt | 0.08–0.24 Wh | Team assumption. Upper bound = anchor | **TODO(source)** |
| Large model per prompt | 0.24–1.00 Wh | Team assumption. Lower bound = anchor. Luccioni et al., *Power Hungry Processing* (ACM FAccT 2024) show energy per query differs by large factors across model sizes, but the factor here is not taken from that paper | **TODO(source)** |
| User's current model | Large | Assumes chat sites default to their largest general model | Assumption |

**How the saving is computed:** saving range = (Large range) − (suggested tier range), shown as a range
(e.g. ≈ 0.16–0.98 Wh for Small). If the suggested tier is Medium, the lower bound is 0 ("up to ≈ 0.92 Wh").
The dashboard sums the ranges of suggestions the user **accepted**. It cannot know whether the user really
switched models.

## Sensitivity
- If the user already runs a small model, the real saving is ~0.
- The ranges are wide on purpose. Per-prompt energy depends on output length, hardware, batching, data centre
  and the provider's accounting boundary, and none of these are visible to the extension.
- So present results as "≈ x–y Wh, estimate", never as a measurement or a CO₂ claim.

## To do before the final (team)
1. Replace each TODO(source) with 2–3 credible, citable sources (paper or provider report: title, year, link),
   or narrow the claim to the anchor only.
2. Re-check that the Google figure and its wording match the original report.
3. If a local NER model is ever added, measure its own energy/latency overhead before claiming a net saving.
