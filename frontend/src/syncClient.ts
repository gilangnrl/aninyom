import { api } from "./api";
import { forgetAccount, getAccount } from "./auth";
import { localUserData, USER_DATA_CHANGED_EVENT } from "./localUserData";

// Optional cross-device sync. The sync code is the only credential: whoever has it can
// read and change the synced data, so it is stored on this device only.

const CODE_KEY = "aninyom_sync_code";
const DEFAULT_DELAY_MS = 3000;
const INVALID_CODE = "Invalid sync code";

let inFlight = false;
let dirty = false;
let timer: ReturnType<typeof setTimeout> | null = null;
let timerDueAt = 0;

export function getSyncCode(): string | null {
  return localStorage.getItem(CODE_KEY);
}

function setSyncCode(code: string | null): void {
  if (code) localStorage.setItem(CODE_KEY, code);
  else localStorage.removeItem(CODE_KEY);
}

// A Google session takes precedence over a sync code on the server, so either one enables sync.
function isSyncEnabled(): boolean {
  return Boolean(getSyncCode() || getAccount());
}

function clearTimer(): void {
  if (timer) clearTimeout(timer);
  timer = null;
  timerDueAt = 0;
}

function normalizeCode(raw: string): string {
  const cleaned = raw.replace(/[\s-]/g, "").toUpperCase();
  return cleaned.length === 16 ? cleaned.match(/.{4}/g)!.join("-") : raw.trim();
}

// Pushes local state and merges the server's response. Overlapping calls are coalesced:
// if a push is running, one more run is queued after it finishes.
export async function syncNow(): Promise<void> {
  if (!isSyncEnabled()) return;
  const code = getSyncCode();
  if (inFlight) {
    dirty = true;
    return;
  }
  inFlight = true;
  try {
    const remote = await api.syncPush(code, localUserData.exportState());
    localUserData.mergeState(remote);
  } catch (e) {
    if (e instanceof Error && e.message === INVALID_CODE) {
      if (code) setSyncCode(null);
      else forgetAccount();
    }
    console.error("Sync failed:", e);
  } finally {
    inFlight = false;
    if (dirty) {
      dirty = false;
      void syncNow();
    }
  }
}

// One pending push at a time. A sooner request moves the timer forward.
export function scheduleSync(delayMs: number): void {
  if (!isSyncEnabled()) return;
  const dueAt = Date.now() + delayMs;
  if (timer && timerDueAt <= dueAt) return;
  clearTimer();
  timerDueAt = dueAt;
  timer = setTimeout(() => {
    timer = null;
    timerDueAt = 0;
    void syncNow();
  }, delayMs);
}

export function startSyncListener(): () => void {
  const onChange = (event: Event) => {
    const delay = (event as CustomEvent<{ delay: number }>).detail?.delay ?? DEFAULT_DELAY_MS;
    scheduleSync(delay);
  };
  // Push right away when the tab is hidden, so a pending change is not lost on close.
  const onVisibility = () => {
    if (document.visibilityState === "hidden") void syncNow();
  };
  window.addEventListener(USER_DATA_CHANGED_EVENT, onChange);
  document.addEventListener("visibilitychange", onVisibility);
  return () => {
    window.removeEventListener(USER_DATA_CHANGED_EVENT, onChange);
    document.removeEventListener("visibilitychange", onVisibility);
  };
}

export async function createSyncCode(): Promise<string> {
  const { code } = await api.syncCreate();
  setSyncCode(code);
  await syncNow();
  return code;
}

// Pushes and merges first, so an invalid code throws to the UI and is not saved.
export async function connectSync(rawCode: string): Promise<void> {
  const code = normalizeCode(rawCode);
  const remote = await api.syncPush(code, localUserData.exportState());
  localUserData.mergeState(remote);
  setSyncCode(code);
}

// Stops syncing on this device. Local data is kept.
export function disconnectSync(): void {
  clearTimer();
  setSyncCode(null);
}

// Deletes the server copy. Local data is kept.
export async function deleteSyncData(): Promise<void> {
  const code = getSyncCode();
  if (!code) return;
  try {
    await api.syncDelete(code);
  } catch (e) {
    if (!(e instanceof Error && e.message === INVALID_CODE)) throw e;
  }
  clearTimer();
  setSyncCode(null);
}
