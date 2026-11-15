/**
 * tests/safety.test.js
 * Safety integration tests: verifies that PromptShield's send-flow
 * never leaks data it has flagged, and that clean prompts pass through.
 *
 * Run with: npm test
 */

import { detectSensitiveData } from '../promptshield/src/shared/detectors.js';

function simulateSend(text) {
  const findings = detectSensitiveData(text);
  return { safe: findings.length === 0, findings };
}

describe('Safety \u2013 clean prompts pass through', () => {
  const cleanPrompts = [
    'What is the capital of France?',
    'Explain how React hooks work.',
    'Write a poem about the ocean.',
    'Translate "good morning" to Japanese.',
    'Give me a recipe for nasi goreng.',
  ];

  test.each(cleanPrompts)('"%s" \u2192 safe', (prompt) => {
    const { safe } = simulateSend(prompt);
    expect(safe).toBe(true);
  });
});

describe('Safety \u2013 sensitive prompts are flagged', () => {
  const cases = [
    ['NIK in prompt', 'tolong cek NIK saya 3201234501870001 apakah valid'],
    ['credit card number', 'kartu kredit 4111 1111 1111 1111 exp 12/28'],
    ['phone number', 'hubungi saya di 0812-3456-7890'],
    ['email address', 'balas ke user@example.com ya'],
  ];

  test.each(cases)('%s \u2192 blocked', (_label, prompt) => {
    const { safe } = simulateSend(prompt);
    expect(safe).toBe(false);
  });
});

describe('Safety \u2013 flagged prompts are never silently forwarded', () => {
  test('findings array is non-empty when blocked', () => {
    const { safe, findings } = simulateSend('NIK: 3201234501870001');
    expect(safe).toBe(false);
    expect(findings.length).toBeGreaterThan(0);
  });

  test('clean prompt returns empty findings', () => {
    const { safe, findings } = simulateSend('What time is it in Tokyo?');
    expect(safe).toBe(true);
    expect(findings).toHaveLength(0);
  });
});
