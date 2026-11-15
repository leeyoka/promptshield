# PromptShield – Manual Test Guide

> Run these tests in a real Chrome/Chromium browser after loading the unpacked extension.

## Setup

1. Open `chrome://extensions/`.
2. Enable **Developer mode** (top-right toggle).
3. Click **Load unpacked** → select the `promptshield/` folder.
4. Pin the PromptShield icon to the toolbar.

---

## Test Cases

### MT-01 – Clean prompt passes through

| Step | Action | Expected |
|------|--------|----------|
| 1 | Open `https://chat.openai.com` | Page loads normally |
| 2 | Type `What is the capital of Indonesia?` | No banner appears |
| 3 | Press **Enter** | Message is sent normally |

**Pass:** Message sent, no warning, badge stays blank.

---

### MT-02 – NIK triggers warning

| Step | Action | Expected |
|------|--------|----------|
| 1 | Open `https://chat.openai.com` | Page loads normally |
| 2 | Type `Cek NIK saya: 3201234501870001` | — |
| 3 | Press **Enter** | Yellow warning banner appears |
| 4 | Observe badge | Shows **1** |

**Pass:** Message is **not** sent; banner displays detected data type.

---

### MT-03 – Credit card number triggers warning

| Step | Action | Expected |
|------|--------|----------|
| 1 | Open any supported AI site | — |
| 2 | Type `Nomor kartu: 4111 1111 1111 1111` | — |
| 3 | Click the **Send** button | Yellow banner appears, send is blocked |

**Pass:** Badge increments; banner lists "credit card".

---

### MT-04 – Banner auto-dismisses

| Step | Action | Expected |
|------|--------|----------|
| 1 | Trigger any warning (see MT-02) | Banner appears |
| 2 | Wait 8 seconds | Banner disappears automatically |

**Pass:** Banner gone after ~8 s without user action.

---

### MT-05 – Badge resets on navigation

| Step | Action | Expected |
|------|--------|----------|
| 1 | Trigger a warning to increment badge | Badge shows \u2265 1 |
| 2 | Navigate to a new URL on the same tab | Badge clears to blank |

**Pass:** Badge shows no number after navigation.

---

## Notes

- Tested browsers: **Chrome 120+**, **Chromium 120+**.
- These tests are repeated for each supported site: ChatGPT, Claude, Gemini.
- Automated equivalent: `npm test` (runs `tests/safety.test.js`).
