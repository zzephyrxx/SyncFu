export type GlassCaptureOutcome<T> =
  | { status: 'captured'; value: T }
  | { status: 'unavailable' | 'timed-out' | 'cancelled' | 'invalidated' };

export interface GlassCaptureDeadline {
  timeoutMs: number;
  signal?: AbortSignal;
  /** Check the opening generation, viewport, and appearance before publishing. */
  isCurrent?: () => boolean;
}

/** A capture may outlive its popup. Cancellation stops waiting and publishing;
 * the native operation itself still owns its resources until it completes.
 * A late result must never replace the fallback after the popup is visible. */
export function captureGlassWithinDeadline<T>(
  capture: () => Promise<T | null>,
  { timeoutMs, signal, isCurrent }: GlassCaptureDeadline,
): Promise<GlassCaptureOutcome<T>> {
  return new Promise(resolve => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const current = () => {
      try { return isCurrent?.() ?? true; } catch { return false; }
    };
    const settle = (outcome: GlassCaptureOutcome<T>) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', cancel);
      resolve(outcome);
    };
    const cancel = () => settle({ status: 'cancelled' });
    const finish = (outcome: GlassCaptureOutcome<T>) => {
      if (settled) return;
      if (signal?.aborted) cancel();
      else if (!current()) settle({ status: 'invalidated' });
      else settle(outcome);
    };

    if (signal?.aborted) { cancel(); return; }
    if (!current()) { settle({ status: 'invalidated' }); return; }
    signal?.addEventListener('abort', cancel, { once: true });
    if (signal?.aborted) { cancel(); return; }
    const deadline = Number.isFinite(timeoutMs) ? Math.min(2_147_483_647, Math.max(0, timeoutMs)) : 0;
    if (!deadline) { finish({ status: 'timed-out' }); return; }
    timer = setTimeout(() => finish({ status: 'timed-out' }), deadline);
    try {
      void capture().then(
        value => finish(value === null ? { status: 'unavailable' } : { status: 'captured', value }),
        () => finish({ status: 'unavailable' }),
      );
    } catch {
      finish({ status: 'unavailable' });
    }
  });
}
