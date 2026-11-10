/** Calculate rest from an absolute deadline so background throttling does not extend it. */
export function remainingRestSeconds(deadline: number, now: number): number {
  return Math.max(0, Math.ceil((deadline - now) / 1000));
}
