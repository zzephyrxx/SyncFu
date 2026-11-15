export function shouldAnimate(mode: 'full' | 'reduced' | 'off', reduced: boolean | null, lowEnd = false) {
  return mode === 'full' && !reduced && !lowEnd;
}
