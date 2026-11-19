// PromptShield microcopy (Indonesian + English). Short, calm, no exclamation marks.

var PS_I18N = {
  id: {
    sheetTitle: 'Periksa sebelum dikirim',
    sheetSub: 'Data ini terdeteksi di perangkatmu. Yang dicentang akan diganti placeholder sebelum dikirim ke AI.',
    viewOriginal: 'Asli',
    viewMasked: 'Yang dilihat AI',
    detected: 'Terdeteksi',
    possible: 'mungkin',
    maskSend: 'Samarkan & kirim',
    sendRaw: 'Kirim tanpa disamarkan',
    cancel: 'Batal',
    nOfM: (n, m) => `${n} dari ${m} akan disamarkan`,
    sentOk: (n) => `${n} data disamarkan. Hanya placeholder yang dikirim.`,
    failClosed: 'Gagal menerapkan penyamaran dengan aman. Tidak ada yang dikirim.',
    copySafe: 'Salin teks aman',
    copied: 'Tersalin',
    copyFailed: 'Gagal menyalin',
    readyInBox: 'Teks yang sudah disamarkan ada di kotak pesan. Tekan kirim untuk mengirim.',
    nothingToMask: 'Tidak ada yang disamarkan. Tidak ada yang dikirim.',
    noSendButton: 'Tombol kirim tidak tersedia. Tidak ada yang dikirim.',
    restoredTip: 'Dipulihkan secara lokal. AI hanya melihat placeholder.',
    rsTitle: 'Saran model',
    rsSuggest: (tier) => `Model ${tierName(tier, 'id')} kemungkinan cukup`,
    rsSaving: (min, max) => (min > 0 ? `hemat ≈ ${fmt(min, 'id')}–${fmt(max, 'id')} Wh` : `hemat hingga ≈ ${fmt(max, 'id')} Wh`),
    estimate: 'estimasi',
    why: 'Kenapa?',
    assumptions: 'Asumsi & sumber',
    rsAccept: 'Oke, pakai model lebih kecil',
    rsAccepted: 'Tercatat. Pilih model yang lebih kecil di pemilih model.',
    dismiss: 'Tutup',
    rsNote: 'Perkiraan dari asumsi, bukan pengukuran. Penghematan nyata bisa lebih kecil.',
    statusIdle: 'PromptShield aktif. Klik untuk memindai kotak pesan.',
    statusProtected: 'Terlindungi',
    statusBlocked: 'Tidak terkirim',
    noneFound: 'Tidak ada data sensitif terdeteksi.',
    typeFirst: 'Tulis pesan dulu, lalu klik ikon ini untuk memindai.',
    viewSent: 'Lihat yang dikirim',
    proofTitle: 'Yang dikirim ke AI',
    proofLine: 'Hanya teks ini yang meninggalkan browser. Nilai asli tetap terenkripsi di perangkatmu.',
    close: 'Tutup',
    preparing: 'Menyiapkan placeholder…',
    chipRestored: 'Nilai asli ditampilkan hanya di layarmu. AI hanya melihat placeholder.',
    chipShowAi: 'Lihat versi AI',
    chipAiShown: 'Menampilkan balasan persis seperti yang ditulis AI.',
    chipShowReal: 'Tampilkan nilai asli',
    chipEditable: 'Blok yang bisa diedit tetap berisi placeholder.',
    chipCopy: 'Salin balasan + nilai asli',
    chipCopied: 'Balasan terakhir disalin dengan nilai asli (hanya di perangkatmu).',
    chipCopyNone: 'Belum ada balasan AI untuk disalin.'
  },
  en: {
    sheetTitle: 'Review before sending',
    sheetSub: 'Found on your device. Checked items are replaced with placeholders before the AI sees them.',
    viewOriginal: 'Original',
    viewMasked: 'What the AI sees',
    detected: 'Detected',
    possible: 'possible',
    maskSend: 'Mask & send',
    sendRaw: 'Send unmasked',
    cancel: 'Cancel',
    nOfM: (n, m) => `${n} of ${m} will be masked`,
    sentOk: (n) => `Masked ${n} item(s). Only placeholders were sent.`,
    failClosed: 'Could not safely apply masking. Nothing was sent.',
    copySafe: 'Copy safe text',
    copied: 'Copied',
    copyFailed: 'Copy failed',
    readyInBox: 'The masked text is in the message box. Press send to send it.',
    nothingToMask: 'Nothing to mask. Nothing was sent.',
    noSendButton: 'Send button not available. Nothing was sent.',
    restoredTip: 'Restored locally. The AI only saw a placeholder.',
    rsTitle: 'Model suggestion',
    rsSuggest: (tier) => `A ${tierName(tier, 'en')} model is likely enough`,
    rsSaving: (min, max) => (min > 0 ? `saves ≈ ${fmt(min, 'en')}–${fmt(max, 'en')} Wh` : `saves up to ≈ ${fmt(max, 'en')} Wh`),
    estimate: 'estimate',
    why: 'Why?',
    assumptions: 'Assumptions & sources',
    rsAccept: 'OK, use a smaller model',
    rsAccepted: 'Noted. Pick a smaller model in the model picker.',
    dismiss: 'Dismiss',
    rsNote: 'Estimated from stated assumptions, not measured. Real savings may be lower.',
    statusIdle: 'PromptShield is on. Click to scan the message box.',
    statusProtected: 'Protected',
    statusBlocked: 'Not sent',
    noneFound: 'No sensitive data found.',
    typeFirst: 'Type your message first, then click this icon to scan it.',
    viewSent: 'View what was sent',
    proofTitle: 'What was sent to the AI',
    proofLine: 'Only this text left your browser. The real values stay encrypted on your device.',
    close: 'Close',
    preparing: 'Preparing placeholders…',
    chipRestored: 'Real values are shown only on your screen. The AI only saw placeholders.',
    chipShowAi: 'Show AI version',
    chipAiShown: 'Showing the reply exactly as the AI wrote it.',
    chipShowReal: 'Show real values',
    chipEditable: 'Editable blocks keep placeholders.',
    chipCopy: 'Copy reply with real values',
    chipCopied: 'Latest reply copied with real values (on your device only).',
    chipCopyNone: 'No AI reply to copy yet.'
  }
};

function tierName(tier, lang) {
  const names = { Small: { id: 'kecil', en: 'small' }, Medium: { id: 'menengah', en: 'medium' }, Large: { id: 'besar', en: 'large' } };
  return (names[tier] || {})[lang] || tier;
}

function fmt(n, lang) {
  return Number(n).toLocaleString(lang === 'id' ? 'id-ID' : 'en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Resolve 'auto' to 'id' or 'en' from the browser language. */
function psResolveLang(setting) {
  if (setting === 'id' || setting === 'en') return setting;
  const nav = (typeof navigator !== 'undefined' && navigator.language) || 'en';
  return /^id|^in/i.test(nav) ? 'id' : 'en';
}

if (typeof globalThis !== 'undefined') {
  globalThis.PS_I18N = PS_I18N;
  globalThis.psResolveLang = psResolveLang;
  globalThis.psFmtNumber = fmt;
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { PS_I18N, psResolveLang, psFmtNumber: fmt };
}
