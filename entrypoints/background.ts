import { supabase } from "./popup/lib/supabase";

// Set WXT_GOOGLE_CLIENT_ID in your .env file — the same Client ID
// from the "Web application" OAuth client you created in Google Cloud Console.
const GOOGLE_CLIENT_ID = import.meta.env.WXT_GOOGLE_CLIENT_ID as string;

async function signInWithGoogle(): Promise<void> {
  const redirectUri = `https://${browser.runtime.id}.chromiumapp.org`;

  const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  authUrl.searchParams.set("client_id", GOOGLE_CLIENT_ID);
  authUrl.searchParams.set("response_type", "id_token");
  authUrl.searchParams.set("redirect_uri", redirectUri);
  authUrl.searchParams.set("scope", "openid email profile");
  authUrl.searchParams.set("nonce", crypto.randomUUID());

  const redirectedTo = await browser.identity.launchWebAuthFlow({
    url: authUrl.href,
    interactive: true,
  });

  if (!redirectedTo) {
    throw new Error("Sign-in was cancelled or failed");
  }

  const params = new URLSearchParams(new URL(redirectedTo).hash.substring(1));
  const idToken = params.get("id_token");

  if (!idToken) {
    throw new Error("Google did not return an ID token");
  }

  const { error } = await supabase.auth.signInWithIdToken({
    provider: "google",
    token: idToken,
  });

  if (error) {
    throw error;
  }
}

export default defineBackground(() => {
  browser.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== "SIGN_IN_WITH_GOOGLE") return;

    signInWithGoogle()
      .then(() => sendResponse({ ok: true }))
      .catch((err) => sendResponse({ ok: false, error: err instanceof Error ? err.message : String(err) }));

    return true; // keep the message channel open for the async response
  });
});
