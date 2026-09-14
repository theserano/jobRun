import { supabase } from "./popup/lib/supabase";
import type { ExtractedJob } from "./popup/lib/extract-job";
import { jobKey, jobPageUrl } from "./popup/lib/job-key";
import { normalizeJobUrl } from "./popup/lib/normalize-job-url";

// Set WXT_GOOGLE_CLIENT_ID in your .env file — the same Client ID
// from the "Web application" OAuth client you created in Google Cloud Console.
const GOOGLE_CLIENT_ID = import.meta.env.WXT_GOOGLE_CLIENT_ID as string;
const UNIQUE_VIOLATION = "23505";

export type DetectionResult =
  | { status: "moved"; id: number; role: string | null; company: string | null }
  | { status: "unsaved" }
  | { status: "ignored" };

interface SenderTab {
  id?: number;
  url?: string;
  title?: string;
}

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function signInWithGoogle(): Promise<void> {
  const redirectUri = `https://${browser.runtime.id}.chromiumapp.org`;

  // Google gets the hashed nonce, Supabase gets the raw one — GoTrue verifies
  // by hashing what we pass it and comparing against the id_token's claim.
  const nonce = crypto.randomUUID();
  const hashedNonce = await sha256Hex(nonce);

  const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  authUrl.searchParams.set("client_id", GOOGLE_CLIENT_ID);
  authUrl.searchParams.set("response_type", "id_token");
  authUrl.searchParams.set("redirect_uri", redirectUri);
  authUrl.searchParams.set("scope", "openid email profile");
  authUrl.searchParams.set("nonce", hashedNonce);
  authUrl.searchParams.set("prompt", "select_account");

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
    nonce,
  });

  if (error) {
    throw error;
  }
}

async function currentUserId(): Promise<string | null> {
  const { data } = await supabase.auth.getUser();
  return data.user?.id ?? null;
}

async function setBadge(tabId: number | undefined, text: string) {
  if (tabId === undefined) return;
  await browser.action.setBadgeBackgroundColor({ tabId, color: "#1f6f5c" });
  await browser.action.setBadgeText({ tabId, text });
}

async function handleApplicationSubmitted(pageUrl: string, tab: SenderTab | undefined): Promise<DetectionResult> {
  if (!(await currentUserId())) return { status: "ignored" };

  const keys = new Set([pageUrl, tab?.url].flatMap((url) => (url ? [jobKey(url)] : [])));
  const { data, error } = await supabase.from("jobs").select("id, url, stage, role, company");
  if (error) throw error;

  const job = data.find((j) => j.url && keys.has(jobKey(j.url)));
  if (!job) return { status: "unsaved" };
  if (job.stage !== "SAVED") return { status: "ignored" };

  const { error: updateError } = await supabase.from("jobs").update({ stage: "APPLIED" }).eq("id", job.id);
  if (updateError) throw updateError;
  await setBadge(tab?.id, "✓");
  return { status: "moved", id: job.id, role: job.role, company: job.company };
}

async function undoApplied(id: number, tab: SenderTab | undefined): Promise<void> {
  const { error } = await supabase.from("jobs").update({ stage: "SAVED" }).eq("id", id);
  if (error) throw error;
  await setBadge(tab?.id, "");
}

async function addAsApplied(
  pageUrl: string,
  job: ExtractedJob | null,
  tab: SenderTab | undefined,
  inFrame: boolean,
): Promise<void> {
  const userId = await currentUserId();
  if (!userId) throw new Error("Sign in to JobRun first");

  // In an embedded application form, the tab's URL is the company's own job page.
  const url = inFrame && tab?.url ? normalizeJobUrl(tab.url) : jobPageUrl(pageUrl);
  const { error } = await supabase.from("jobs").insert({
    user_id: userId,
    role: job?.role ?? tab?.title ?? "Untitled role",
    company: job?.company ?? new URL(url).hostname.replace(/^www\./, ""),
    url,
    stage: "APPLIED",
  });

  if (error?.code === UNIQUE_VIOLATION) {
    const { error: updateError } = await supabase.from("jobs").update({ stage: "APPLIED" }).eq("url", url);
    if (updateError) throw updateError;
  } else if (error) {
    throw error;
  }
  await setBadge(tab?.id, "✓");
}

export default defineBackground(() => {
  browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
    const run = (() => {
      switch (message?.type) {
        case "SIGN_IN_WITH_GOOGLE":
          return signInWithGoogle();
        case "APPLICATION_SUBMITTED":
          return handleApplicationSubmitted(message.url, sender.tab);
        case "UNDO_APPLIED":
          return undoApplied(message.id, sender.tab);
        case "ADD_AS_APPLIED":
          return addAsApplied(message.url, message.job, sender.tab, sender.frameId !== 0);
      }
    })();
    if (!run) return;

    run
      .then((result) => sendResponse({ ok: true, result }))
      .catch((err) => sendResponse({ ok: false, error: err instanceof Error ? err.message : String(err) }));

    return true; // keep the message channel open for the async response
  });
});
