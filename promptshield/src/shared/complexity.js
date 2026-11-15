// PromptShield right-size advisor.
// Explainable point system over Indonesian + English cues. Each cue group adds points; the total
// picks a tier. It suggests a model size and an ESTIMATED energy saving range. No model call, no network.
//
//   points < 1.5  -> Small     1.5 <= points < 4 -> Medium     points >= 4 -> Large
//   Hard rules: >= 2 reasoning cues with code or math -> Large; >= 4 reasoning cues -> Large.
// Calibrated by hand on eval/advisor/dev-set.json (developer-labelled; see docs/METRICS.md).

var PS_TIERS = (typeof globalThis !== 'undefined' && globalThis.PS_TIERS) ? globalThis.PS_TIERS
  : (typeof require !== 'undefined' ? require('./constants.js').PS_TIERS : { SMALL: 'Small', MEDIUM: 'Medium', LARGE: 'Large' });
var PS_ENERGY = (typeof globalThis !== 'undefined' && globalThis.PS_ENERGY) ? globalThis.PS_ENERGY
  : (typeof require !== 'undefined' ? require('./constants.js').PS_ENERGY : {});

var psComplexity = (function () {
  const T_MEDIUM = 1.5;
  const T_LARGE = 4;

  const REASONING = [
    /\banaly[sz](?:e|es|ing|is)\b/gi, /\bcompar(?:e|es|ing|ison)\b/gi, /\bevaluat(?:e|ing|ion)\b/gi, /\bcritiqu(?:e|ing)\b/gi,
    /\btrade-?offs?\b/gi, /\bpros and cons\b/gi, /\bstep[- ]by[- ]step\b/gi, /\bprove\b|\bproof\b/gi,
    /\bderiv(?:e|ation)\b/gi, /\bjustif(?:y|ication)\b/gi, /\bexplain why\b/gi, /\broot cause\b/gi,
    /\barchitect(?:ure)?\b/gi, /\bdesign (?:a|the) system\b/gi, /\bstrateg(?:y|ies)\b/gi, /\boptimi[sz]e\b/gi,
    /\bdebug\b/gi, /\brefactor\b/gi, /\bin[- ]depth\b/gi,
    /\banalisis\b|\banalisa\b|\bmenganalisis\b/gi, /\bbandingkan\b|\bperbandingan\b|\bmembandingkan\b/gi,
    /\bevaluasi\b/gi, /\bkritik\b/gi, /\bkelebihan dan kekurangan\b/gi, /\blangkah demi langkah\b/gi,
    /\bbuktikan\b|\bpembuktian\b/gi, /\bturunkan\b/gi, /\bjelaskan (?:mengapa|kenapa)\b/gi, /\bakar masalah\b/gi,
    /\barsitektur\b/gi, /\brancang\b|\bmerancang\b/gi, /\bstrategi\b/gi, /\boptimalkan\b/gi, /\bmendalam\b/gi
  ];
  const CODE = [
    /```/g, /\bfunction\s/g, /\bconst\s/g, /\blet\s/g, /\bimport\s/g, /\bclass\s/g, /\bdef\s/g, /\breturn\s/g,
    /\bif\s*\(/g, /\bfor\s*\(/g, /\bwhile\s*\(/g, /=>/g, /;\s*\n/g, /\bSELECT\s/gi, /\bFROM\s/g, /\bSQL\b/g,
    /\bpip install\b/g, /\bnpm install\b/g, /\bTraceback\b/g, /\bException\b/g, /<\/?\w+>/g, /\bscript\b/gi
  ];
  const MATH = [
    /\d+\s*[\+\*\/\^=]\s*\d+/g, /\d+\s+-\s+\d+/g, /\bequation\b|\bpersamaan\b/gi, /\bformula\b|\brumus\b/gi,
    /\bcalculate\b|\bcompute\b|\bhitung(?:lah)?\b|\bperhitungan\b/gi, /\bintegral\b/gi, /\bderivative\b|\bturunan\b|\bgradient\b/gi,
    /\bmatri(?:x|ks)\b/gi, /\bprobabilit(?:y|as)\b|\bpeluang\b/gi, /\bstatisti(?:c|cs|cal|k)\b/gi, /\bsample size\b/gi,
    /[∑∫√πθσμΔ]/g, /\\frac|\\sum|\\int/g
  ];
  const OUTPUT = [
    /\bdetail(?:ed)?\b|\brinci\b/gi, /\blengkap\b|\bcomprehensive\b|\bkomprehensif\b/gi,
    /\besai\b|\bessay\b/gi, /\blaporan\b|\breport\b/gi, /\bmakalah\b|\bpaper\b/gi
  ];
  // Asks to explain something or to produce new content (pushes Small -> Medium).
  const TASK = [
    /\bjelaskan\b|\bexplain\b/gi, /\b(?:write|draft) (?:a|an|me)\b/gi, /\btulis(?:kan)? (?:surat|artikel|esai|cerita)\b/gi,
    /\bbuat(?:kan)? (?:rencana|outline|surat|daftar|artikel|proposal)\b/gi, /\boutline\b/gi, /\bplan\b|\brencana\b/gi,
    /\b(?:give me|buat(?:kan)?) \d+\b/gi, /\bquery\b/gi, /\bkonsep\b/gi
  ];
  const SIMPLE = [
    /\brapikan\b|\bmerapikan\b/gi, /\bperbaiki (?:tata bahasa|ejaan|kalimat|typo)\b/gi, /\bterjemahkan\b|\btranslate\b/gi,
    /\bparafrase\b|\bparaphrase\b/gi, /\bringkas(?:kan)?\b|\bsummari[sz]e\b|\brangkum(?:kan)?\b/gi,
    /\bfix (?:the )?(?:grammar|typos?)\b/gi, /\bproofread\b/gi, /\btulis ulang\b|\brewrite\b/gi,
    /\bbuat(?:kan)? judul\b/gi, /\bformal(?:kan)?\b/gi, /\bsingkat\b|\bshort\b/gi, /\bucapan\b/gi
  ];

  function hits(text, patterns) {
    let n = 0;
    for (const p of patterns) { const m = text.match(p); if (m) n += m.length; }
    return n;
  }

  function multipartCount(text) {
    const listItems = (text.match(/^\s*\d+[.)]\s/gm) || []).length;
    const bullets = (text.match(/^\s*[-*•]\s/gm) || []).length;
    const questions = Math.min((text.match(/\?/g) || []).length, 3);
    return listItems + bullets + (questions >= 2 ? questions : 0);
  }

  function wordsRequested(text) {
    const m = text.match(/\b(\d{3,5})\s*-?\s*(?:kata|words?)\b/i);
    return m ? Number(m[1]) : 0;
  }

  /** Reason labels shown in the "Why?" disclosure. */
  const REASON_TEXT = {
    reasoning: { id: 'Butuh penalaran/analisis', en: 'Needs reasoning or analysis' },
    code: { id: 'Ada kode program', en: 'Contains code' },
    math: { id: 'Ada matematika/perhitungan', en: 'Contains math' },
    multipart: { id: 'Banyak sub-tugas', en: 'Several sub-tasks' },
    output: { id: 'Minta jawaban panjang/detail', en: 'Asks for a long, detailed answer' },
    task: { id: 'Minta penjelasan atau konten baru', en: 'Asks for an explanation or new content' },
    length: { id: 'Prompt panjang', en: 'Long prompt' },
    simple: { id: 'Tugas sederhana (rapikan, terjemahkan, ringkas)', en: 'Simple task (rewrite, translate, summarise)' },
    short: { id: 'Prompt pendek tanpa penalaran berat', en: 'Short prompt without heavy reasoning' }
  };

  function savingVsLarge(tier) {
    const L = PS_ENERGY.Large, T = PS_ENERGY[tier];
    if (!L || !T || tier === PS_TIERS.LARGE) return null;
    const min = Math.max(0, L.min - T.max), max = Math.max(0, L.max - T.min);
    return { min: Math.round(min * 100) / 100, max: Math.round(max * 100) / 100, label: `~${min.toFixed(2)}–${max.toFixed(2)} Wh` };
  }

  return {
    REASON_TEXT,
    THRESHOLDS: { medium: T_MEDIUM, large: T_LARGE },
    /**
     * @param {string} text
     * @returns {{score:number, points:number, tier:string, features:Object<string,number>, reasons:string[],
     *            energyRange:Object, potentialSaving:({min:number,max:number,label:string}|null), suggestion:string}}
     */
    score(text) {
      text = String(text || '');
      const r = hits(text, REASONING), c = hits(text, CODE), m = hits(text, MATH);
      const o = hits(text, OUTPUT), t = hits(text, TASK), s = hits(text, SIMPLE);
      const words = wordsRequested(text);
      const parts = multipartCount(text);

      const features = {
        reasoning: r === 0 ? 0 : r === 1 ? 2 : r === 2 ? 3 : r === 3 ? 4 : 6,
        code: c === 0 ? 0 : c < 3 ? 1 : c < 6 ? 2 : 3,
        math: m === 0 ? 0 : m < 3 ? 1.5 : 2.5,
        output: Math.min(3, o + (words >= 1000 ? 2 : words >= 300 ? 1 : 0)),
        task: t > 0 ? 1.5 : 0,
        multipart: parts >= 4 ? 2 : parts >= 2 ? 1 : 0,
        length: text.length > 2000 ? 2 : text.length > 800 ? 1 : 0
      };
      let points = Object.values(features).reduce((a, b) => a + b, 0);
      const simple = s > 0 && r === 0 && c < 3 && m === 0;
      if (simple) points -= 2;
      if (r >= 2 && (c > 0 || m > 0)) points = Math.max(points, T_LARGE);
      if (r >= 4) points = Math.max(points, T_LARGE);
      points = Math.max(0, points);

      const tier = points < T_MEDIUM ? PS_TIERS.SMALL : points < T_LARGE ? PS_TIERS.MEDIUM : PS_TIERS.LARGE;

      const contrib = Object.entries(features).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).map(([k]) => k);
      const reasons = [];
      if (simple) reasons.push('simple');
      reasons.push(...contrib.slice(0, 3 - reasons.length));
      if (reasons.length === 0) reasons.push('short');

      const potentialSaving = savingVsLarge(tier);
      return {
        score: Math.round(Math.min(1, points / 8) * 100) / 100,
        points,
        tier,
        features,
        reasons,
        energyRange: PS_ENERGY[tier],
        potentialSaving,
        suggestion: potentialSaving
          ? `A ${tier} model is likely enough. Estimated saving vs. a large model: ${potentialSaving.label}`
          : 'This prompt likely benefits from a large model.'
      };
    }
  };
})();

if (typeof globalThis !== 'undefined') {
  globalThis.psComplexity = psComplexity;
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { psComplexity };
}
