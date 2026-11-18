export const idleTimeout = 30 * 60 * 1000;
const memory = new Map<string, number>();
const key = (id: string) => 'lumodossier:last-activity:' + id;

function last(id: string) {
  try {
    const time = Number(localStorage.getItem(key(id)));
    if (Number.isFinite(time) && time > 0) return time;
  } catch {
    /* Use the in-memory timestamp when storage is unavailable. */
  }
  return memory.get(id);
}
export function recordActivity(id: string) {
  const time = Date.now();
  memory.set(id, time);
  try {
    localStorage.setItem(key(id), String(time));
  } catch {
    /* The current tab still tracks activity. */
  }
}
export function isIdle(id: string) {
  const time = last(id);
  return time !== undefined && Date.now() - time >= idleTimeout;
}
export function watchActivity(id: string, expire: () => void) {
  let timer: ReturnType<typeof setTimeout>,
    stopped = false;
  const events = ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart', 'scroll'] as const;
  if (last(id) === undefined) recordActivity(id);
  function stop() {
    stopped = true;
    clearTimeout(timer);
    for (const event of events) window.removeEventListener(event, activity, true);
    window.removeEventListener('storage', storage);
    window.removeEventListener('focus', check);
    window.removeEventListener('pageshow', check);
    document.removeEventListener('visibilitychange', check);
  }
  function check() {
    if (stopped) return;
    clearTimeout(timer);
    if (isIdle(id)) {
      stop();
      expire();
      return;
    }
    timer = setTimeout(check, Math.max(1, (last(id) ?? Date.now()) + idleTimeout - Date.now()));
  }
  function activity() {
    if (document.visibilityState !== 'visible' || stopped) return;
    if (isIdle(id)) {
      check();
      return;
    }
    if (Date.now() - (last(id) ?? 0) < 1000) return;
    recordActivity(id);
    check();
  }
  function storage(e: StorageEvent) {
    if (e.key === key(id)) check();
  }
  for (const event of events) window.addEventListener(event, activity, { capture: true, passive: true });
  window.addEventListener('storage', storage);
  window.addEventListener('focus', check);
  window.addEventListener('pageshow', check);
  document.addEventListener('visibilitychange', check);
  check();
  return stop;
}
