import type { ExtractedJob } from "./popup/lib/extract-job";
import { jobKey, jobPageUrl } from "./popup/lib/job-key";
import { addJob, findJob, updateJob, type Stage } from "./popup/lib/jobs";
import { normalizeJobUrl } from "./popup/lib/normalize-job-url";

export type DetectionResult =
  | { status: "moved"; id: string; role: string | null; company: string | null }
  | { status: "unsaved"; job: ExtractedJob | null }
  | { status: "ignored" };

// The job a tab is in the middle of applying to: the URLs it was seen at (job page first)
// and the details read while the posting was still on screen. A confirmation screen often
// has neither, so it's matched against this.
interface PendingApplication {
  urls: string[];
  job: ExtractedJob | null;
  at: number;
}

const PENDING_TTL_MS = 2 * 60 * 60 * 1000;

interface SenderTab {
  id?: number;
  url?: string;
  title?: string;
}

async function setBadge(tabId: number | undefined, text: string) {
  if (tabId === undefined) return;
  await browser.action.setBadgeBackgroundColor({ tabId, color: "#1f6f5c" });
  await browser.action.setBadgeText({ tabId, text });
}

const pendingKey = (tabId: number) => `pending:${tabId}`;

async function getPending(tabId: number | undefined): Promise<PendingApplication | null> {
  if (tabId === undefined) return null;
  const key = pendingKey(tabId);
  const pending = (await browser.storage.session.get(key))[key] as PendingApplication | undefined;
  return pending && Date.now() - pending.at < PENDING_TTL_MS ? pending : null;
}

async function clearPending(tabId: number | undefined) {
  if (tabId !== undefined) await browser.storage.session.remove(pendingKey(tabId));
}

// In an embedded application form, the tab's URL is the company's own job page.
function jobUrlFor(pageUrl: string, tab: SenderTab | undefined, inFrame: boolean, pending: PendingApplication | null) {
  if (pending?.urls[0]) return jobPageUrl(pending.urls[0]);
  return inFrame && tab?.url ? normalizeJobUrl(tab.url) : jobPageUrl(pageUrl);
}

async function insertJob(url: string, job: ExtractedJob | null, tab: SenderTab | undefined, stage: Stage) {
  return addJob({
    role: job?.role ?? tab?.title ?? "Untitled role",
    company: job?.company ?? new URL(url).hostname.replace(/^www\./, ""),
    url,
    stage,
  });
}

// Opening an application or pressing Submit. Remembers the job for the confirmation screen,
// and says whether to offer tracking it (not yet tracked, not already offered).
async function recordApplyIntent(
  pageUrl: string,
  job: ExtractedJob | null,
  tab: SenderTab | undefined,
  inFrame: boolean,
  offer: boolean,
): Promise<{ offer: boolean }> {
  if (tab?.id === undefined) return { offer: false };

  const seenAt = inFrame && tab.url ? [tab.url, pageUrl] : [pageUrl];
  const previous = await getPending(tab.id);
  const pending: PendingApplication = {
    urls: [...new Set([...(previous?.urls ?? []), ...seenAt])],
    job: previous?.job?.role ? previous.job : job,
    at: Date.now(),
  };
  await browser.storage.session.set({ [pendingKey(tab.id)]: pending });

  if (!offer) return { offer: false };
  const key = jobKey(pending.urls[0] ?? pageUrl);
  const { offered = [] } = (await browser.storage.session.get("offered")) as { offered?: string[] };
  if (offered.includes(key) || (await findJob(pending.urls))) return { offer: false };
  await browser.storage.session.set({ offered: [...offered, key] });
  return { offer: true };
}

async function saveJob(pageUrl: string, job: ExtractedJob | null, tab: SenderTab | undefined, inFrame: boolean) {
  const pending = await getPending(tab?.id);
  await insertJob(jobUrlFor(pageUrl, tab, inFrame, pending), pending?.job ?? job, tab, "SAVED");
}

async function handleApplicationSubmitted(
  pageUrl: string,
  job: ExtractedJob | null,
  tab: SenderTab | undefined,
): Promise<DetectionResult> {
  const pending = await getPending(tab?.id);
  const found = await findJob([pageUrl, tab?.url, ...(pending?.urls ?? [])]);
  if (!found) return { status: "unsaved", job: pending?.job?.role ? pending.job : job };
  await clearPending(tab?.id);
  if (found.stage !== "SAVED") return { status: "ignored" };

  await updateJob(found.id, { stage: "APPLIED" });
  await setBadge(tab?.id, "✓");
  return { status: "moved", id: found.id, role: found.role, company: found.company };
}

async function undoApplied(id: string, tab: SenderTab | undefined): Promise<void> {
  await updateJob(id, { stage: "SAVED" });
  await setBadge(tab?.id, "");
}

async function addAsApplied(
  pageUrl: string,
  job: ExtractedJob | null,
  tab: SenderTab | undefined,
  inFrame: boolean,
): Promise<void> {
  const url = jobUrlFor(pageUrl, tab, inFrame, await getPending(tab?.id));
  const { job: stored, existing } = await insertJob(url, job, tab, "APPLIED");
  if (existing) await updateJob(stored.id, { stage: "APPLIED" });
  await clearPending(tab?.id);
  await setBadge(tab?.id, "✓");
}

export default defineBackground(() => {
  browser.tabs.onRemoved.addListener((tabId) => clearPending(tabId));

  browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
    const run = (() => {
      switch (message?.type) {
        case "APPLY_INTENT":
          return recordApplyIntent(message.url, message.job, sender.tab, sender.frameId !== 0, message.offer);
        case "SAVE_JOB":
          return saveJob(message.url, message.job, sender.tab, sender.frameId !== 0);
        case "APPLICATION_SUBMITTED":
          return handleApplicationSubmitted(message.url, message.job, sender.tab);
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
