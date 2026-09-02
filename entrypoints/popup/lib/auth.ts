import { supabase } from "./supabase";

// The actual OAuth flow runs in the background service worker — see
// entrypoints/background.ts. A popup gets closed by Chrome as soon as it
// loses focus, which happens the instant the Google consent window opens,
// so running launchWebAuthFlow directly in the popup kills it mid-flow.
export async function signInWithGoogle(): Promise<void> {
  const response = await browser.runtime.sendMessage({ type: "SIGN_IN_WITH_GOOGLE" });

  if (!response?.ok) {
    throw new Error(response?.error ?? "Sign-in failed");
  }
}

export async function signOut(): Promise<void> {
  await supabase.auth.signOut();
}
