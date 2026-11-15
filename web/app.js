// PromptShield Interactive Web Gateway Application
'use strict';

(() => {
  // Elements
  const composer = document.getElementById('live-composer');
  const counterText = document.getElementById('counter-text');
  const shieldDot = document.querySelector('.shield-dot');
  const chipsTray = document.getElementById('chips-tray');
  const ecoBox = document.getElementById('eco-box');
  const ecoTierText = document.getElementById('eco-tier-text');
  const ecoDescText = document.getElementById('eco-desc-text');
  const btnSend = document.getElementById('btn-send-prompt');
  const btnClear = document.getElementById('btn-clear-input');

  const chatMessages = document.getElementById('chat-messages');
  const wirePayloadText = document.getElementById('wire-payload-text');

  // Metric displays
  const metricProtected = document.getElementById('metric-protected');
  const metricEnergy = document.getElementById('metric-energy');
  const metricRightsized = document.getElementById('metric-rightsized');

  // Modal
  const modal = document.getElementById('sim-modal');
  const modalPreviewText = document.getElementById('modal-preview-text');
  const modalFindingCount = document.getElementById('modal-finding-count');
  const modalItemsContainer = document.getElementById('modal-items-container');
  const modalAdviceDetail = document.getElementById('modal-advice-detail');
  const modalApprovedCount = document.getElementById('modal-approved-count');
  const modalBtnCancel = document.getElementById('modal-btn-cancel');
  const modalBtnRaw = document.getElementById('modal-btn-raw');
  const modalBtnShielded = document.getElementById('modal-btn-shielded');

  // Scenario buttons
  const btnScenarioRina = document.getElementById('btn-scenario-rina');
  const btnScenarioDev = document.getElementById('btn-scenario-dev');
  const btnScenarioClean = document.getElementById('btn-scenario-clean');

  // Document upload elements
  const docFileInput = document.getElementById('doc-file-input');
  const docDroparea = document.getElementById('doc-droparea');
  const btnBrowseFile = document.getElementById('btn-browse-file');
  const docFileList = document.getElementById('doc-file-list');
  const docFileItems = document.getElementById('doc-file-items');
  const btnClearFiles = document.getElementById('btn-clear-files');

  // Energy graph elements
  const energyChartEmpty = document.getElementById('energy-chart-empty');
  const energyBarsWrapper = document.getElementById('energy-bars-wrapper');

  // State
  let currentFindings = [];
  let currentAdvice = null;
  let uploadedDocs = []; // { name, size, text, findings }
  let stats = {
    protectedCount: 0,
    energySavedWh: 0.0,
    rightsizedCount: 0
  };
  let energyHistory = []; // { label, saving, tier }

  // Presets from Proposal
  const SCENARIOS = {
    rina: `Yth. Customer Care Bank,

Saya ingin melaporkan keluhan terkait pemotongan saldo otomatis yang tidak sah.
Berikut adalah identitas saya untuk verifikasi akun:
- Nama Lengkap: Rina Sari
- NIK: 3171016408980002
- Nomor Telepon Terdaftar: 081298765432
- Email Akun: rina.sari98@gmail.com
- Nomor Rekening / Kartu Terkait: 4111-2222-3333-4448

Tolong bantu saya menyusun surat komplain resmi yang tegas namun sopan untuk saya kirimkan ke pihak direksi bank hari ini. Terima kasih!`,

    dev: `// Debugging AWS and OpenAI microservice integration
const config = {
  service: 'payment-webhook-listener',
  awsAccessKey: 'AKIAIOSFODNN7EXAMPLE',
  openaiSecret: 'sk-proj-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',
  adminContact: 'lead.dev@company-jakarta.co.id',
  backupPhone: '+62 813 4567 8901'
};

Please write a secure Node.js retry logic handler for connection timeouts in this service.`,

    clean: `Please analyze the themes of freedom and responsibility in Jean-Paul Sartre's existentialist philosophy. Summarize the key arguments in 3 distinct bullet points for university seminar discussion.`
  };

  // Preset switching
  function loadPreset(key, btn) {
    document.querySelectorAll('.preset-btn').forEach((b) => b.classList.remove('active'));
    if (btn) btn.classList.add('active');
    composer.value = SCENARIOS[key];
    analyzeComposer();
  }

  btnScenarioRina.addEventListener('click', () => loadPreset('rina', btnScenarioRina));
  btnScenarioDev.addEventListener('click', () => loadPreset('dev', btnScenarioDev));
  btnScenarioClean.addEventListener('click', () => loadPreset('clean', btnScenarioClean));

  // Clear button
  btnClear.addEventListener('click', () => {
    composer.value = '';
    analyzeComposer();
  });

  // Real-time analysis on input
  composer.addEventListener('input', analyzeComposer);

  function analyzeComposer() {
    const text = composer.value.trim();

    // Combine text from prompt and uploaded documents
    const allText = getAllText();

    if (!allText) {
      counterText.textContent = '0 sensitive items detected';
      shieldDot.className = 'shield-dot';
      chipsTray.innerHTML = '<span class="tray-empty">No sensitive entities detected yet. Try typing an Indonesian NIK or phone number!</span>';
      ecoBox.classList.add('hidden');
      currentFindings = [];
      currentAdvice = null;
      return;
    }

    // 1. Detect PII from prompt text only (for masking)
    currentFindings = text ? psDetectAll(text) : [];

    // Also collect findings from uploaded docs
    const docFindings = [];
    uploadedDocs.forEach((doc) => {
      doc.findings.forEach((f) => {
        docFindings.push({ ...f, source: doc.name });
      });
    });

    const totalFindings = currentFindings.length + docFindings.length;

    // 2. Compute Eco Complexity
    currentAdvice = psComplexity.score(allText);

    // Update Counter & Indicator
    if (totalFindings > 0) {
      const promptLabel = currentFindings.length > 0 ? `${currentFindings.length} in prompt` : '';
      const docLabel = docFindings.length > 0 ? `${docFindings.length} in docs` : '';
      const parts = [promptLabel, docLabel].filter(Boolean).join(', ');
      counterText.textContent = `${totalFindings} sensitive item${totalFindings > 1 ? 's' : ''} detected (${parts})`;
      shieldDot.className = 'shield-dot danger';
    } else {
      counterText.textContent = 'Prompt clean (No personal identifiers)';
      shieldDot.className = 'shield-dot clean';
    }

    // Render Entity Chips
    chipsTray.innerHTML = '';
    if (totalFindings === 0) {
      chipsTray.innerHTML = '<span class="tray-empty" style="color:#276749;">\u2705 No sensitive data detected in text or documents.</span>';
    } else {
      const allFindings = [
        ...currentFindings.map((f) => ({ ...f, source: 'prompt' })),
        ...docFindings
      ];
      allFindings.forEach((f) => {
        const chip = document.createElement('span');
        let typeClass = 'chip-nik';
        if (f.type === PS_TYPES.PHONE) typeClass = 'chip-phone';
        else if (f.type === PS_TYPES.EMAIL) typeClass = 'chip-email';
        else if (f.type === PS_TYPES.CARD) typeClass = 'chip-card';
        else if (f.type === PS_TYPES.API_KEY) typeClass = 'chip-key';

        chip.className = `entity-chip ${typeClass}`;
        const sourceTag = f.source !== 'prompt' ? ` [${f.source}]` : '';
        chip.textContent = `${f.type}: ${f.value}${sourceTag}`;
        chipsTray.appendChild(chip);
      });
    }

    // Render Eco Box
    if (currentAdvice) {
      ecoBox.classList.remove('hidden');
      ecoTierText.textContent = `Model Complexity: ${currentAdvice.tier} (${(currentAdvice.score * 100).toFixed(0)}%)`;
      ecoDescText.textContent = `${currentAdvice.suggestion} (Estimated tier range: ${currentAdvice.energyRange.label})`;
    }
  }

  // ======= Document Upload Logic =======

  function getAllText() {
    const prompt = composer.value.trim();
    const docTexts = uploadedDocs.map((d) => d.text).join('\n');
    return [prompt, docTexts].filter(Boolean).join('\n');
  }

  // Browse button
  btnBrowseFile.addEventListener('click', (e) => {
    e.stopPropagation();
    docFileInput.click();
  });

  // Click on droparea
  docDroparea.addEventListener('click', () => {
    docFileInput.click();
  });

  // Drag and drop
  docDroparea.addEventListener('dragover', (e) => {
    e.preventDefault();
    docDroparea.classList.add('drag-over');
  });
  docDroparea.addEventListener('dragleave', () => {
    docDroparea.classList.remove('drag-over');
  });
  docDroparea.addEventListener('drop', (e) => {
    e.preventDefault();
    docDroparea.classList.remove('drag-over');
    if (e.dataTransfer.files.length) {
      handleFiles(e.dataTransfer.files);
    }
  });

  // File input change
  docFileInput.addEventListener('change', () => {
    if (docFileInput.files.length) {
      handleFiles(docFileInput.files);
      docFileInput.value = ''; // reset for re-upload
    }
  });

  // Clear all files
  btnClearFiles.addEventListener('click', () => {
    uploadedDocs = [];
    renderFileList();
    analyzeComposer();
  });

  function handleFiles(fileList) {
    Array.from(fileList).forEach((file) => {
      readFileContent(file).then((text) => {
        const findings = psDetectAll(text);
        uploadedDocs.push({
          name: file.name,
          size: file.size,
          text: text,
          findings: findings
        });
        renderFileList();
        analyzeComposer();
      }).catch((err) => {
        // Show error for unreadable files
        uploadedDocs.push({
          name: file.name,
          size: file.size,
          text: '',
          findings: [],
          error: err.message || 'Could not read file'
        });
        renderFileList();
      });
    });
  }

  function readFileContent(file) {
    return new Promise((resolve, reject) => {
      const ext = file.name.split('.').pop().toLowerCase();

      if (['txt', 'csv', 'json', 'xml', 'html', 'md', 'log', 'js', 'py', 'java', 'sql', 'yml', 'yaml', 'env', 'cfg', 'ini', 'conf'].includes(ext)) {
        // Read as plain text
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(new Error('Failed to read file'));
        reader.readAsText(file);
      } else if (ext === 'pdf') {
        // For PDF: Try to read as text (will get some content from simple PDFs)
        const reader = new FileReader();
        reader.onload = () => {
          // Extract text-like content from PDF binary
          const text = extractTextFromPdfBinary(reader.result);
          resolve(text || '[PDF content could not be fully extracted \u2014 for best results, paste the text manually]');
        };
        reader.onerror = () => reject(new Error('Failed to read PDF'));
        reader.readAsText(file);
      } else if (ext === 'doc' || ext === 'docx') {
        // For DOCX: extract text from the XML inside the zip
        const reader = new FileReader();
        reader.onload = () => {
          extractTextFromDocx(reader.result).then(resolve).catch(() => {
            resolve('[DOCX content could not be fully extracted \u2014 for best results, paste the text manually]');
          });
        };
        reader.onerror = () => reject(new Error('Failed to read document'));
        reader.readAsArrayBuffer(file);
      } else {
        // Attempt text read for unknown extensions
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(new Error('Unsupported file format'));
        reader.readAsText(file);
      }
    });
  }

  function extractTextFromPdfBinary(raw) {
    // Simple PDF text extraction: find text between parenthesized strings
    const textParts = [];
    const streamRegex = /\(([^)]*)\)/g;
    let m;
    while ((m = streamRegex.exec(raw)) !== null) {
      const decoded = m[1]
        .replace(/\\n/g, '\n')
        .replace(/\\r/g, '\r')
        .replace(/\\t/g, '\t')
        .replace(/\\\\/g, '\\')
        .replace(/\\([()])/g, '$1');
      if (decoded.trim().length > 1) textParts.push(decoded);
    }
    return textParts.join(' ');
  }

  async function extractTextFromDocx(arrayBuffer) {
    // DOCX is a ZIP file. We'll look for the document.xml entry
    try {
      const uint8 = new Uint8Array(arrayBuffer);
      const decoder = new TextDecoder('utf-8');
      const fullStr = decoder.decode(uint8);

      // Try to find XML content that looks like word document content
      const xmlMatch = fullStr.match(/<w:body[\s\S]*?<\/w:body>/);
      if (xmlMatch) {
        // Strip XML tags, keep text
        return xmlMatch[0].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      }

      // Fallback: just extract all readable text
      const readable = fullStr.replace(/[^\x20-\x7E\n\r\t]/g, ' ').replace(/\s{3,}/g, ' ').trim();
      return readable.length > 50 ? readable : '[Could not extract DOCX content]';
    } catch (e) {
      return '[Could not extract DOCX content]';
    }
  }

  function formatFileSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  }

  function getFileIcon(name) {
    const ext = name.split('.').pop().toLowerCase();
    const icons = {
      txt: '\uD83D\uDCDD', csv: '\uD83D\uDCCA', json: '\uD83D\uDD27', xml: '\uD83D\uDCCB', html: '\uD83C\uDF10',
      md: '\uD83D\uDCD6', log: '\uD83D\uDCDC', pdf: '\uD83D\uDCD5', doc: '\uD83D\uDCD8', docx: '\uD83D\uDCD8',
      js: '\uD83D\uDC9B', py: '\uD83D\uDC0D', sql: '\uD83D\uDDC3\uFE0F', env: '\uD83D\uDD10'
    };
    return icons[ext] || '\uD83D\uDCC4';
  }

  function renderFileList() {
    if (uploadedDocs.length === 0) {
      docFileList.classList.add('hidden');
      return;
    }

    docFileList.classList.remove('hidden');
    docFileItems.innerHTML = '';

    uploadedDocs.forEach((doc, idx) => {
      const item = document.createElement('div');
      item.className = 'doc-file-item';

      const findingCount = doc.findings.length;
      const findingClass = findingCount > 0 ? 'has-findings' : 'no-findings';
      const findingLabel = findingCount > 0
        ? `\u26A0 ${findingCount} sensitive`
        : '\u2705 Clean';

      const errorNote = doc.error ? ` <em style="color:#e53e3e;font-size:10px;">(${doc.error})</em>` : '';

      item.innerHTML = `
        <span class="file-icon">${getFileIcon(doc.name)}</span>
        <span class="file-name">${escapeHTML(doc.name)}${errorNote}</span>
        <span class="file-size">${formatFileSize(doc.size)}</span>
        <span class="file-findings ${findingClass}">${findingLabel}</span>
        <button class="btn-remove-file" data-idx="${idx}" title="Remove">\u2715</button>
      `;

      item.querySelector('.btn-remove-file').addEventListener('click', (e) => {
        e.stopPropagation();
        uploadedDocs.splice(idx, 1);
        renderFileList();
        analyzeComposer();
      });

      docFileItems.appendChild(item);
    });
  }

  // Trigger Send
  btnSend.addEventListener('click', () => {
    const text = composer.value.trim();
    const allText = getAllText();
    if (!allText) return;

    // Combine all findings (prompt + docs) for the review modal
    const allFindings = [...currentFindings];
    uploadedDocs.forEach((doc) => {
      doc.findings.forEach((f) => {
        allFindings.push({ ...f, source: doc.name });
      });
    });

    if (allFindings.length > 0) {
      openReviewModal(allText, allFindings, currentAdvice);
    } else {
      // Send directly
      dispatchToAi(allText, allText, []);
    }
  });

  // Modal Flow
  function openReviewModal(text, findings, advice) {
    findings.forEach((f, idx) => {
      f.id = idx;
      f.approved = true;
    });

    modalPreviewText.innerHTML = buildHighlightedHtml(text, findings);
    modalFindingCount.textContent = findings.length;

    modalItemsContainer.innerHTML = '';
    findings.forEach((f) => {
      const row = document.createElement('label');
      row.className = 'modal-item-row';
      const colors = PS_COLORS[f.type] || { bg: '#e2e8f0', text: '#2d3748', border: '#cbd5e0' };
      const sourceTag = f.source && f.source !== 'prompt' ? ` <span style="font-size:10px;color:#718096;">[${escapeHTML(f.source)}]</span>` : '';

      row.innerHTML = `
        <input type="checkbox" data-id="${f.id}" checked>
        <span class="modal-item-tag" style="background:${colors.bg};color:${colors.text};border:1px solid ${colors.border};">${f.type}</span>
        <span class="modal-item-val">${escapeHTML(f.value)}${sourceTag}</span>
        <span style="font-size:11px;color:#718096;font-weight:600;">${Math.round(f.confidence * 100)}%</span>
      `;

      row.querySelector('input').addEventListener('change', (e) => {
        f.approved = e.target.checked;
        updateModalApprovedCount();
      });

      modalItemsContainer.appendChild(row);
    });

    if (advice && advice.tier !== PS_TIERS.LARGE) {
      modalAdviceDetail.textContent = advice.suggestion;
    } else {
      modalAdviceDetail.textContent = 'This task benefits from a Large model.';
    }

    updateModalApprovedCount();
    modal.classList.remove('hidden');
  }

  function updateModalApprovedCount() {
    const approved = currentFindings.filter((f) => f.approved).length;
    modalApprovedCount.textContent = approved;
  }

  function closeModal() {
    modal.classList.add('hidden');
  }

  modalBtnCancel.addEventListener('click', closeModal);

  modalBtnRaw.addEventListener('click', () => {
    closeModal();
    const rawText = getAllText();
    dispatchToAi(rawText, rawText, []);
  });

  modalBtnShielded.addEventListener('click', () => {
    closeModal();
    const approved = currentFindings.filter((f) => f.approved);
    const text = getAllText();

    // Pseudonymize
    const sorted = [...approved].sort((a, b) => b.start - a.start);
    let masked = text;
    const typeCounters = {};
    const mappings = [];

    sorted.forEach((f) => {
      typeCounters[f.type] = (typeCounters[f.type] || 0) + 1;
      const token = `[${f.type}_${typeCounters[f.type]}]`;
      masked = masked.slice(0, f.start) + token + masked.slice(f.end);
      mappings.push({ token, original: f.value, type: f.type });
    });

    dispatchToAi(masked, text, mappings);
  });

  // Dispatch to AI with Streaming & Live Token Restoration
  function dispatchToAi(networkPayload, displayPrompt, mappings) {
    // 1. Update Wire Inspector
    wirePayloadText.textContent = networkPayload;

    // 2. Add User Message to Chat
    const userMsg = document.createElement('div');
    userMsg.className = 'msg-bubble user';
    userMsg.textContent = displayPrompt;
    chatMessages.appendChild(userMsg);
    chatMessages.scrollTop = chatMessages.scrollHeight;

    // 3. Prepare AI Assistant Response Container
    const aiMsg = document.createElement('div');
    aiMsg.className = 'msg-bubble assistant';
    const sender = document.createElement('div');
    sender.className = 'msg-sender';
    sender.textContent = 'AI Chatbot Assistant';
    const content = document.createElement('div');
    content.className = 'msg-content';
    content.innerHTML = '<span style="color:#718096;font-style:italic;">Processing prompt...</span>';

    aiMsg.appendChild(sender);
    aiMsg.appendChild(content);
    chatMessages.appendChild(aiMsg);
    chatMessages.scrollTop = chatMessages.scrollHeight;

    // 4. Update Dashboard Stats & Energy Graph
    stats.protectedCount += mappings.length;
    let promptSaving = 0;
    let promptTier = currentAdvice ? currentAdvice.tier : PS_TIERS.LARGE;

    if (currentAdvice && currentAdvice.tier !== PS_TIERS.LARGE) {
      stats.rightsizedCount += 1;
      const saving = (PS_ENERGY.Large.min + PS_ENERGY.Large.max) / 2 - (currentAdvice.energyRange.min + currentAdvice.energyRange.max) / 2;
      promptSaving = Math.max(0.12, saving);
      stats.energySavedWh += promptSaving;
    }

    // Record in energy history for the graph
    const promptLabel = `#${energyHistory.length + 1}`;
    energyHistory.push({
      label: promptLabel,
      saving: promptSaving,
      tier: promptTier
    });

    updateDashboardUI();
    updateEnergyGraph();

    // 5. Generate AI Response Template based on content
    const responseTemplate = buildAiResponseTemplate(networkPayload, mappings);

    // 6. Simulate Chunked Streaming & Real-time on-screen token restoration
    simulateStreamingWithRestoration(content, responseTemplate, mappings);
  }

  function buildAiResponseTemplate(payload, mappings) {
    if (payload.includes('Bank') || payload.includes('komplain')) {
      return `Kepada Yth. Customer Care Bank

Perihal: Pengaduan Resmi Pemotongan Saldo Tidak Sah

Dengan hormat,
Saya yang bertanda tangan di bawah ini:
- Nama: [NAME_1]
- NIK: [NIK_1]
- Kontak: [PHONE_1]
- Email: [EMAIL_1]
- Nomor Rekening / Kartu Terkait: [CARD_1]

Dengan ini menyampaikan keberatan resmi atas terjadinya transaksi pendebetan saldo yang tidak pernah saya otorisasi. Mohon tindak lanjut investigasi, pemblokiran sementara instrumen pembayaran nomor [CARD_1], serta pengembalian dana selambat-lambatnya 3x24 jam kerja sesuai ketentuan UU Pelindungan Data Pribadi dan regulasi Bank Indonesia.

Hormat saya,
[NAME_1]`;
    }

    if (payload.includes('AWS') || payload.includes('OpenAI') || payload.includes('config')) {
      return `Here is the production-ready retry logic handler for your microservice webhook:

\`\`\`javascript
const axios = require('axios');

async function handleWebhookWithRetry(payload, maxRetries = 3) {
  // Safe authentication using local environment variables:
  const clientKey = process.env.SERVICE_KEY || '[API_KEY_1]';
  const openAiSecret = process.env.AI_SECRET || '[API_KEY_2]';
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(\`Attempt \${attempt}: Dispatching notification to [EMAIL_1]...\`);
      const res = await axios.post('https://api.openai.com/v1/chat/completions', payload, {
        headers: { 'Authorization': \`Bearer \${openAiSecret}\` }
      });
      return res.data;
    } catch (err) {
      if (attempt === maxRetries) {
        console.error('Fatal: alert sent to admin at [PHONE_1]');
        throw err;
      }
      await new Promise(r => setTimeout(r, Math.pow(2, attempt) * 1000));
    }
  }
}
\`\`\`

Notice that your credential tokens ([API_KEY_1], [API_KEY_2]) were protected on-device and never exposed to the model.`;
    }

    return `I have reviewed your query. Here is a concise breakdown:
1. **Core Premise:** The text has been processed cleanly without any sensitive personal data exposure.
2. **Analysis:** The philosophical arguments hold strong consistency regarding self-determination.
3. **Conclusion:** All key discussion points have been formatted for academic delivery.`;
  }

  function simulateStreamingWithRestoration(targetElement, fullText, mappings) {
    let index = 0;
    targetElement.innerHTML = '';

    // Create a mapping dictionary for instant token lookup
    const lookupMap = {};
    mappings.forEach((m) => {
      lookupMap[m.token] = m.original;
    });

    const interval = setInterval(() => {
      // Stream in 4-8 characters per step
      const chunkSize = Math.floor(Math.random() * 5) + 4;
      index = Math.min(fullText.length, index + chunkSize);

      let currentStream = fullText.slice(0, index);

      // Perform REVERSIBLE RESTORATION: Replace tokens with real values (highlighted green)
      for (const [token, realVal] of Object.entries(lookupMap)) {
        if (currentStream.includes(token)) {
          const restoredHtml = `<span class="restored-token" title="PromptShield Vault Restored: ${token}">${escapeHTML(realVal)}</span>`;
          currentStream = currentStream.split(token).join(restoredHtml);
        }
      }

      // Convert newlines to breaks or pre
      targetElement.innerHTML = currentStream.replace(/\n/g, '<br>');
      chatMessages.scrollTop = chatMessages.scrollHeight;

      if (index >= fullText.length) {
        clearInterval(interval);
      }
    }, 40);
  }

  function updateDashboardUI() {
    metricProtected.textContent = stats.protectedCount;
    metricEnergy.innerHTML = `${stats.energySavedWh.toFixed(2)} <span class="metric-unit">Wh</span>`;
    metricRightsized.textContent = stats.rightsizedCount;
  }

  // ======= Energy Savings Graph =======
  function updateEnergyGraph() {
    if (energyHistory.length === 0) {
      energyChartEmpty.classList.remove('hidden');
      energyBarsWrapper.innerHTML = '';
      return;
    }

    energyChartEmpty.classList.add('hidden');

    // Max height for bars: 90px
    const maxBarHeight = 90;
    // Max energy value for scaling (at least 1.0 Wh)
    const maxEnergy = Math.max(1.0, ...energyHistory.map((h) => h.saving));

    energyBarsWrapper.innerHTML = '';

    energyHistory.forEach((entry, idx) => {
      const col = document.createElement('div');
      col.className = 'energy-bar-col animate';

      // Value label on top
      const valLabel = document.createElement('div');
      valLabel.className = 'energy-bar-value';
      valLabel.textContent = entry.saving > 0 ? `${entry.saving.toFixed(2)}` : '0';

      // The bar itself
      const bar = document.createElement('div');
      bar.className = `energy-bar tier-${entry.tier.toLowerCase()}`;
      const barHeight = entry.saving > 0 ? Math.max(4, (entry.saving / maxEnergy) * maxBarHeight) : 4;
      bar.style.height = barHeight + 'px';
      bar.title = `Prompt ${entry.label}: ${entry.tier} tier, saved ${entry.saving.toFixed(2)} Wh`;

      // Bottom label
      const lbl = document.createElement('div');
      lbl.className = 'energy-bar-label';
      lbl.textContent = entry.label;

      col.appendChild(valLabel);
      col.appendChild(bar);
      col.appendChild(lbl);
      energyBarsWrapper.appendChild(col);
    });
  }

  function buildHighlightedHtml(text, findings) {
    let html = '';
    let last = 0;
    const sorted = [...findings].sort((a, b) => a.start - b.start);

    for (const f of sorted) {
      if (f.start > last) {
        html += escapeHTML(text.slice(last, f.start));
      }
      const colors = PS_COLORS[f.type] || { bg: '#e2e8f0', text: '#2d3748', border: '#cbd5e0' };
      html += `<span class="highlight" style="background:${colors.bg};color:${colors.text};border:1px solid ${colors.border};">${escapeHTML(f.value)}</span>`;
      last = Math.max(last, f.end);
    }
    if (last < text.length) {
      html += escapeHTML(text.slice(last));
    }
    return html;
  }

  function escapeHTML(str) {
    if (!str) return '';
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  // Initialize with Rina Scenario
  loadPreset('rina', btnScenarioRina);
})();
