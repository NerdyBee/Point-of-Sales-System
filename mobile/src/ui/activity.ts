/**
 * "Someone is using the till" signal for the auto-lock. Touches inside pop-ups (separate
 * windows) and typing do not reach the main screen, so they report here instead.
 */
const listeners = new Set<() => void>();

export function markActivity() {
  for (const listener of listeners) listener();
}

export function onActivity(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
