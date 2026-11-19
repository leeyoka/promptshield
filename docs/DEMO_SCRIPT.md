# Demo script (about 3 minutes, for the video and the live demo)

Use **only** the synthetic values below. The video will be posted publicly.
Before recording: in `chrome://extensions` reload PromptShield. In the popup → Settings → "Clear vault now".
Use a fresh ChatGPT chat with the browser zoom at 100%.

**Persona (from the proposal):** Rina Sari, 28, a bank customer writing a complaint email with ChatGPT.

| Time | Do | Say (one line) |
|---|---|---|
| 0:00 | Show ChatGPT with the small PromptShield icon in the corner | "PromptShield runs inside the browser. Nothing appears until it finds something." |
| 0:10 | Type a clean prompt: `Jelaskan perbedaan tabungan dan deposito.` and press Enter | "Clean prompt, sent immediately. No friction." |
| 0:25 | Paste the Rina prompt (below), wait for the suggestion banner | "While I type, it suggests a smaller model, with an estimated saving. It's labelled as an estimate." Click **Why?** to show reasons and sources |
| 0:50 | Press Enter → the review sheet opens | "Before anything leaves the browser, I see what was found: name, NIK, phone, email, account, card." |
| 1:05 | Click **What the AI sees** | "This is exactly what ChatGPT will receive: placeholders." |
| 1:15 | Untick nothing, click **Mask & send** | "It writes the masked text, reads it back to verify, and only then sends." |
| 1:30 | Point at your own bubble (placeholders), then at ChatGPT's answer (dotted underline), then click **Show AI version** in the top-right chip and back | "My message shows exactly what was sent. ChatGPT only saw `[NIK_1]`; the real values are put back on my screen, locally. Here is the reply exactly as the AI wrote it." |
| 1:50 | Click **View what was sent** in the toast | "Proof: this is the only text that left the browser." |
| 2:05 | Ask a follow-up using the same NIK | "Same value, same placeholder across turns. Replies still restore after a reload." Press F5 to show it |
| 2:25 | Open the popup → Overview | "Counts only: items protected, suggestions accepted, estimated Wh. No prompt text is stored." |
| 2:40 | Popup → Settings | "Per-type switches, a 24-hour encrypted vault, clear any time. One permission: storage." |
| 2:45 | Switch to a Google Docs tab → **Alt+Shift+P** → Sample → **Copy safe text** → paste into the doc | "Not on ChatGPT? The side panel works next to any site, with no extra permissions. It never reads the page; you paste in, you copy out." |
| 2:50 | (Optional, rehearsed) show the fail-closed toast from `ui-preview/chat-mock.html?mode=broken` | "If masking can't be applied safely, nothing is sent." |

Rina prompt:
```
Tolong rapikan email komplain ini supaya sopan tapi tegas.
Nama: Rina Sari
NIK: 3171016408980002
No. HP: 081298765432
Email: rina.sari98@example.com
Rekening BRI: 0123-01-012345-50-1
Kartu debit: 4111 2222 3333 4448
Saldo saya terpotong dua kali untuk transaksi yang sama.
```

Q&A prep (everyone should be able to answer):
- Why not encryption end-to-end? → The AI must read the prompt. We pseudonymize; we don't encrypt what is sent.
- What if masking fails? → Read-back check; nothing is sent; Copy safe text.
- How accurate is detection? → Show `docs/METRICS.md`. Synthetic results come from our own generator. The independent held-out set is (or isn't yet) filled. Be honest about which.
- Is the energy number real? → It's an estimate from listed assumptions. One anchor is sourced; the others are marked TODO(source).
