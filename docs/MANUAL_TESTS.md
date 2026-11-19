# Manual tests on chatgpt.com (v1.1.0)

Use only the synthetic values below.

## Setup
1. `chrome://extensions` → Developer mode → remove any older PromptShield → **Load unpacked** → select the
   folder `promptshield` (the one with `manifest.json`).
2. Nothing to edit: the extension works right after loading. For logs (optional): click the PromptShield icon →
   Settings → **Debug logs** on. Reload ChatGPT (Ctrl+R), open DevTools with **Ctrl+Shift+J**, filter `PromptShield`,
   and set the level to **Verbose**. Turn it off again afterwards. Check that the popup header shows **v1.1.2**.
3. To check what was really sent: DevTools → **Network** → filter `conversation` → click the request → **Payload**.

Test prompt (multi-line):
```
Tolong rapikan email komplain ini.
Nama: Rina Sari
NIK saya 3171016408980002, HP 081298765432,
email rina.sari98@example.com, rekening BRI 0123-01-012345-50-1, kartu 4111-2222-3333-4448.
```

| # | Scenario | Steps | Expected |
|---|---|---|---|
| 1 | Enter, single line | `NIK saya 3171016408980002 tolong cek` → Enter → **Mask & send** | Review sheet opens; ChatGPT receives `NIK saya [NIK_1] tolong cek`; green toast |
| 2 | Click send button | Same as 1 but click ChatGPT's send arrow | Same as 1 |
| 3 | Multi-line, 6 items | Paste the test prompt → Enter → **What the AI sees** → **Mask & send** | Preview shows 6 placeholders; line breaks kept; Network payload has no raw value |
| 4 | Untick one | Test prompt → untick Email → Mask & send | Email stays raw, others are placeholders |
| 5 | Untick all | Untick every switch | **Mask & send** is disabled |
| 6 | Send unmasked | Prompt from 1 → **Send unmasked** | Original text sent |
| 7 | Cancel / Esc | Prompt from 1 → Cancel (and separately Esc, and click the dark backdrop) | Sheet closes, nothing sent, draft kept |
| 8 | Blocked while open | Sheet open → press Enter in ChatGPT's box or click its send arrow | Nothing sent |
| 9 | Clean prompt | `Jelaskan fotosintesis singkat` → Enter | Sent immediately, no sheet |
| 10 | Restore in reply | After 3, ask: "ulangi semua data saya persis" | Reply shows the real values on screen. Hover shows "Restored locally" |
| 11 | Multi-turn | After 3, send another prompt with the same NIK | The same `[NIK_1]` is reused; earlier replies still restored |
| 12 | Reload | After 10, press F5 | Restored values come back after the page loads |
| 13 | Order number | `Order ID 3171012304950001 belum sampai` → Enter | Sent immediately, no sheet: low-confidence items alone never open the sheet (by design) |
| 14 | Suggestion banner | Type `Tolong terjemahkan kalimat ini ke bahasa Inggris: saya sudah transfer kemarin.` and wait 1 s | Banner "A small model is likely enough · saves ≈ … Wh · estimate". **Why?** shows reasons and sources. **OK…** → popup shows 1 accepted and a Wh range |
| 15 | Proof | After 3, click **View what was sent** in the toast; also popup → Overview → "Last sent" | Shows the masked text only |
| 16 | Popup settings | Popup → Settings → switch off Email → repeat 3 | Email is not detected |
| 17 | Clear vault | Popup → Settings → Clear vault now → reload a chat with old replies | Old replies show placeholders again |
| 18 | Failure injection | Prompt from 1 → Enter (sheet opens). In the Console run `document.querySelector('#prompt-textarea').setAttribute('contenteditable','false')` → **Mask & send** | Red toast "Could not safely apply masking. Nothing was sent." + **Copy safe text**; no new message; then press F5 |
| 19 | Dark mode | Switch ChatGPT to dark theme and repeat 3 | Sheet and banner are dark and readable |
| 20 | Language | Popup → Settings → Language → Bahasa Indonesia, reload ChatGPT, repeat 1 | Sheet texts are in Indonesian |

## Side panel (any site)
| # | Scenario | Steps | Expected |
|---|---|---|---|
| 21 | Open | On a Google Docs tab: popup → **Open side panel**; also try **Alt+Shift+P** (if the shortcut is taken, set it at `chrome://extensions/shortcuts`) | Panel opens on the right |
| 22 | Mask + copy | Click **Sample** → **Copy safe text** → paste into a Google Doc | Pasted text has `[NAME_1]`, `[NIK_1]` … and no real values |
| 23 | Untick | Switch off Email → Copy | Email stays as typed, others masked |
| 24 | Same tokens as ChatGPT | Mask the NIK in ChatGPT first, then paste the same NIK in the panel | The panel uses the same `[NIK_…]` token |
| 25 | Restore | Paste the safe text into Gemini (or any AI), copy its reply, paste into **2. Restore the AI's reply** | Real values appear (dotted marks); **Copy restored reply** gives the real text |
| 26 | Not stored | Close and reopen the panel | Both text boxes are empty |
| 27 | Clean text | Paste `Jelaskan fotosintesis singkat` → Copy | "Copied. No sensitive data found." |

## What to paste back
- All `[PromptShield]` lines from tests 1, 3 and 18. The most important line is
  `write strategy paste|insertText|deleteThenInsert verified|mismatch`.
- Tests 1–4: did the Network payload contain any raw value (yes/no)?
- Test 10: did ChatGPT show `[NIK_1]` exactly, or an altered form (e.g. `\[NIK\_1\]`, `NIK_1`, a link)? Was it restored?
- Anything that looked broken: the test number, a screenshot, what you expected.
