import { extractJobFromPage } from "./popup/lib/extract-job";
import type { DetectionResult } from "./background";

const TOAST_HOST_ID = "jobrun-toast-host";
const TOAST_MS = 8000;

const TOAST_CSS = `
  :host { all: initial; }
  .toast {
    position: fixed;
    z-index: 2147483647;
    right: 20px;
    top: 12px;
    display: flex;
    align-items: center;
    gap: 10px;
    max-width: 380px;
    padding: 10px 10px 10px 14px;
    border-radius: 10px;
    background: #14181f;
    color: #fff;
    font: 500 13px/1.4 "IBM Plex Sans", -apple-system, BlinkMacSystemFont, sans-serif;
    box-shadow: 0 8px 24px rgba(20, 24, 31, 0.25);
    animation: toast-in 280ms cubic-bezier(0.2, 0.8, 0.2, 1);
  }
  .dot { flex: none; width: 8px; height: 8px; border-radius: 50%; background: #3fb68b; }
  .text { flex: 1; }
  button { font: inherit; border: none; border-radius: 6px; cursor: pointer; }
  .action { padding: 5px 10px; background: #e4f0ec; color: #185947; font-weight: 600; }
  .action:disabled { opacity: 0.6; cursor: default; }
  .close { padding: 2px 6px; background: transparent; color: #9aa3b0; font-size: 16px; line-height: 1; }
  .close:hover { color: #fff; }
  button:focus-visible { outline: 2px solid #3fb68b; outline-offset: 2px; }
  @keyframes toast-in { from { opacity: 0; transform: translate(24px, -16px) scale(0.96); } }
  @media (prefers-reduced-motion: reduce) { .toast { animation: none; } }
`;

// How long after pressing Submit an on-page success message still counts as a confirmation.
const SUBMIT_WINDOW_MS = 2 * 60 * 1000;
const FORM_CHECK_DELAY_MS = 1500;
const DIALOG_POLL_MS = 1000;
const CLICKABLE = 'button, a, [role="button"], input[type="submit"]';

const APPLY_LABEL =
  /^(easy apply( to .+)?|apply( now| for this (job|position|role)| to this job| manually| here)?|i'?m interested)$/i;
const SUBMIT_LABEL = /^(submit( your)?( application)?|send application)$/i;
// Only looked for in content that appears after a submit, never in the page as it loaded.
const SUCCESS_TEXT =
  /application (has been |was )?(successfully )?(submitted|sent|received)|thanks? (you )?for (applying|your application)/i;

// Sites that show a dedicated confirmation URL. The rest (Ashby, Workday, SmartRecruiters,
// LinkedIn Easy Apply) confirm in place, so they're caught by SUCCESS_TEXT after a submit.
function isConfirmationPage(url: URL): boolean {
  if (url.hostname.endsWith("greenhouse.io")) return /\/confirmation\/?$/.test(url.pathname);
  if (url.hostname === "jobs.lever.co") return /\/thanks\/?$/.test(url.pathname);
  return false;
}

// LinkedIn's content script runs site-wide because it navigates without page loads.
function isJobArea(url: URL): boolean {
  return !url.hostname.endsWith("linkedin.com") || url.pathname.startsWith("/jobs");
}

function isApplicationPage(url: URL): boolean {
  if (/\/(apply|application)(\/|$)/.test(url.pathname) || url.pathname.startsWith("/oneclick-ui/")) return true;
  return document.querySelector('form input[type="file"]') !== null;
}

function looksLikeApplicationForm(form: HTMLFormElement): boolean {
  return form.querySelector('input[type="file"], input[type="email"]') !== null;
}

const log = (...args: unknown[]) => console.debug("[JobRun]", ...args);

// The document plus every open shadow root in it. LinkedIn renders Easy Apply inside one,
// where document-level observers and selectors can't see.
function allRoots(): (Document | ShadowRoot)[] {
  const roots: (Document | ShadowRoot)[] = [document];
  for (let i = 0; i < roots.length; i++) {
    for (const el of roots[i]!.querySelectorAll("*")) {
      if (el.shadowRoot) roots.push(el.shadowRoot);
    }
  }
  return roots;
}

function dialogsShowSuccess(): boolean {
  return allRoots().some((root) =>
    [...root.querySelectorAll('[role="dialog"], [role="alertdialog"], dialog')].some((d) =>
      SUCCESS_TEXT.test(d.textContent ?? ""),
    ),
  );
}

function labelOf(el: Element): string {
  const raw = el instanceof HTMLInputElement ? el.value : el.textContent;
  const text = (raw ?? "").replace(/\s+/g, " ").trim();
  return text || el.getAttribute("aria-label")?.trim() || "";
}

export default defineContentScript({
  matches: [
    "*://*.greenhouse.io/*",
    "*://jobs.lever.co/*",
    "*://jobs.ashbyhq.com/*",
    "*://*.myworkdayjobs.com/*",
    "*://*.myworkdaysite.com/*",
    "*://jobs.smartrecruiters.com/*",
    "*://*.linkedin.com/*",
  ],
  allFrames: true,
  main(ctx) {
    const reported = new Set<string>();

    function showToast(message: string, action?: { label: string; run: () => Promise<string> }) {
      document.getElementById(TOAST_HOST_ID)?.remove();
      const host = document.createElement("div");
      host.id = TOAST_HOST_ID;
      const root = host.attachShadow({ mode: "closed" });
      root.innerHTML = `<style>${TOAST_CSS}</style><div class="toast" role="status"><span class="dot"></span><span class="text"></span></div>`;
      const toast = root.querySelector(".toast")!;
      root.querySelector(".text")!.textContent = message;

      if (action) {
        const button = document.createElement("button");
        button.className = "action";
        button.textContent = action.label;
        button.addEventListener("click", async () => {
          button.disabled = true;
          showToast(await action.run());
        });
        toast.append(button);
      }

      const close = document.createElement("button");
      close.className = "close";
      close.setAttribute("aria-label", "Dismiss");
      close.textContent = "×";
      close.addEventListener("click", () => host.remove());
      toast.append(close);

      document.documentElement.append(host);
      ctx.setTimeout(() => host.remove(), TOAST_MS);
    }

    let submittedAt = 0;
    let successObserver: MutationObserver | null = null;
    let dialogPoll: number | null = null;

    function stopWatching() {
      successObserver?.disconnect();
      successObserver = null;
      if (dialogPoll !== null) clearInterval(dialogPoll);
      dialogPoll = null;
    }

    async function reportSubmitted() {
      const url = location.href;
      if (reported.has(url)) return;
      reported.add(url);
      stopWatching();
      log("application confirmed", url);

      const response = await browser.runtime.sendMessage({
        type: "APPLICATION_SUBMITTED",
        url,
        job: extractJobFromPage(),
      });
      if (!response?.ok) return;
      const result = response.result as DetectionResult;

      if (result.status === "moved") {
        const name = [result.role, result.company].filter(Boolean).join(" at ") || "This job";
        showToast(`${name} moved to Applied.`, {
          label: "Undo",
          run: async () => {
            const undo = await browser.runtime.sendMessage({ type: "UNDO_APPLIED", id: result.id });
            return undo?.ok ? "Moved back to Saved." : "Couldn't undo. Change it in JobRun.";
          },
        });
      } else if (result.status === "unsaved") {
        showToast("Add this job to JobRun as Applied?", {
          label: "Add",
          run: async () => {
            const add = await browser.runtime.sendMessage({ type: "ADD_AS_APPLIED", url, job: result.job });
            return add?.ok ? "Added to Applied." : `Couldn't add: ${add?.error ?? "unknown error"}`;
          },
        });
      }
    }

    // Remembers this job in the background; with offer, prompts to track it if it isn't yet.
    async function noteApplyIntent(offer: boolean) {
      const job = extractJobFromPage();
      const response = await browser.runtime.sendMessage({ type: "APPLY_INTENT", url: location.href, job, offer });
      if (!response?.ok || !response.result?.offer) return;
      showToast("Track this job in JobRun?", {
        label: "Save",
        run: async () => {
          const save = await browser.runtime.sendMessage({ type: "SAVE_JOB", url: location.href, job });
          return save?.ok
            ? "Saved. It moves to Applied when you submit."
            : `Couldn't save: ${save?.error ?? "unknown error"}`;
        },
      });
    }

    // Pressing Submit doesn't mean it went through (validation, captchas), so wait for the
    // site to confirm: a confirmation URL, or a success message added to the page.
    function onSubmitAttempt() {
      submittedAt = Date.now();
      log("submit pressed; waiting for confirmation");
      noteApplyIntent(false).catch(console.error);
      if (successObserver) return;

      // A success dialog already open before submitting isn't evidence of this one.
      const alreadyShowing = dialogsShowSuccess();
      dialogPoll = ctx.setInterval(() => {
        if (Date.now() - submittedAt > SUBMIT_WINDOW_MS) {
          log("no confirmation seen; giving up");
          stopWatching();
        } else if (!alreadyShowing && dialogsShowSuccess()) {
          reportSubmitted().catch(console.error);
        }
      }, DIALOG_POLL_MS);

      successObserver = new MutationObserver((mutations) => {
        const confirmed = mutations.some((m) =>
          [...m.addedNodes].some((node) => {
            const text = node.textContent ?? "";
            return text.length < 5000 && SUCCESS_TEXT.test(text);
          }),
        );
        if (confirmed) reportSubmitted().catch(console.error);
      });
      successObserver.observe(document.documentElement, { childList: true, subtree: true });
    }

    function onPageChange() {
      const url = new URL(location.href);
      if (!isJobArea(url)) return;
      if (isConfirmationPage(url)) {
        reportSubmitted().catch(console.error);
        return;
      }
      // Let SPA forms render before looking for them.
      ctx.setTimeout(() => {
        if (location.href === url.href && isApplicationPage(url)) noteApplyIntent(true).catch(console.error);
      }, FORM_CHECK_DELAY_MS);
    }

    ctx.addEventListener(
      document,
      "click",
      (event) => {
        if (!isJobArea(new URL(location.href))) return;
        // composedPath reaches into open shadow roots; event.target stops at their host.
        const target = event
          .composedPath()
          .find((node): node is Element => node instanceof Element && node.matches(CLICKABLE));
        if (!target) return;
        const label = labelOf(target);
        log("click", JSON.stringify(label));
        if (SUBMIT_LABEL.test(label)) onSubmitAttempt();
        else if (APPLY_LABEL.test(label)) noteApplyIntent(true).catch(console.error);
      },
      { capture: true },
    );

    ctx.addEventListener(
      document,
      "submit",
      (event) => {
        const form = event.target;
        if (form instanceof HTMLFormElement && looksLikeApplicationForm(form)) onSubmitAttempt();
      },
      { capture: true },
    );

    onPageChange();
    ctx.addEventListener(window, "wxt:locationchange", onPageChange);
  },
});
