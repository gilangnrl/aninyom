import { api } from "./api";

// Google sign-in via Google Identity Services. The backend turns the ID token into an
// httpOnly session cookie. This module only keeps a display summary in localStorage.

const ACCOUNT_KEY = "aninyom_account";
const GIS_SRC = "https://accounts.google.com/gsi/client";

export interface Account {
  name: string | null;
  email: string | null;
  picture: string | null;
}

interface GoogleIdApi {
  initialize(config: { client_id: string; callback: (response: { credential: string }) => void }): void;
  renderButton(parent: HTMLElement, options: Record<string, unknown>): void;
}

declare global {
  interface Window {
    google?: { accounts: { id: GoogleIdApi } };
  }
}

export function getAccount(): Account | null {
  const raw = localStorage.getItem(ACCOUNT_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Account;
  } catch {
    return null;
  }
}

function saveAccount(account: Account): void {
  localStorage.setItem(ACCOUNT_KEY, JSON.stringify(account));
}

function clearAccount(): void {
  localStorage.removeItem(ACCOUNT_KEY);
}

let gisLoading: Promise<void> | null = null;

function loadGoogleScript(): Promise<void> {
  if (window.google?.accounts?.id) return Promise.resolve();
  if (!gisLoading) {
    gisLoading = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = GIS_SRC;
      script.async = true;
      script.onload = () => resolve();
      script.onerror = () => {
        gisLoading = null;
        reject(new Error("Could not load Google sign-in."));
      };
      document.head.appendChild(script);
    });
  }
  return gisLoading;
}

export async function renderGoogleButton(
  parent: HTMLElement,
  onCredential: (credential: string) => void,
): Promise<void> {
  const { google_client_id } = await api.authConfig();
  if (!google_client_id) throw new Error("Google sign-in is not configured on the server.");
  await loadGoogleScript();
  const id = window.google!.accounts.id;
  id.initialize({ client_id: google_client_id, callback: (r) => onCredential(r.credential) });
  id.renderButton(parent, { theme: "outline", size: "large", shape: "pill", text: "signin_with", width: 260 });
}

export async function signInWithGoogle(credential: string): Promise<Account> {
  const account = await api.authGoogle(credential);
  saveAccount(account);
  return account;
}

// Ends the server session. Local data and any sync code are kept.
export async function signOutGoogle(): Promise<void> {
  await api.authLogout();
  clearAccount();
}

// Deletes the server-side account and synced copy. Local data is kept.
export async function deleteGoogleAccount(): Promise<void> {
  await api.authDeleteAccount();
  clearAccount();
}

export function forgetAccount(): void {
  clearAccount();
}
