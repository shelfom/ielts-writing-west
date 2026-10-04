/**
 * Round to nearest 0.5, half-up.
 * e.g. 5.25 -> 5.5, 5.74 -> 5.5, 5.75 -> 6.0, 6.25 -> 6.5
 */
export function roundToHalf(value: number): number {
  return Math.round(value * 2) / 2;
}

/**
 * Compute overall band from 4 criterion scores (equally weighted).
 * Average rounded to nearest 0.5 (half-up).
 */
export function computeOverall(scores: number[]): number {
  if (scores.length !== 4) throw new Error('Expected exactly 4 criterion scores');
  const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
  return roundToHalf(avg);
}

/**
 * Clamp a score to valid IELTS band range [0, 9].
 */
export function clampBand(score: number): number {
  return Math.max(0, Math.min(9, Math.round(score)));
}

/**
 * Split essay text into code-assigned ordered paragraphs.
 * Paragraph IDs are stable: p1, p2, ... in source order.
 */
export function splitParagraphs(text: string): { id: string; text: string }[] {
  return text
    .split(/\n\n+/)
    .filter(p => p.trim().length > 0)
    .map((t, i) => ({ id: `p${i + 1}`, text: t.trim() }));
}
