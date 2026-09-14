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
    bottom: 20px;
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
    animation: toast-in 220ms cubic-bezier(0.2, 0.8, 0.2, 1);
  }
  .dot { flex: none; width: 8px; height: 8px; border-radius: 50%; background: #3fb68b; }
  .text { flex: 1; }
  button { font: inherit; border: none; border-radius: 6px; cursor: pointer; }
  .action { padding: 5px 10px; background: #e4f0ec; color: #185947; font-weight: 600; }
  .action:disabled { opacity: 0.6; cursor: default; }
  .close { padding: 2px 6px; background: transparent; color: #9aa3b0; font-size: 16px; line-height: 1; }
  .close:hover { color: #fff; }
  button:focus-visible { outline: 2px solid #3fb68b; outline-offset: 2px; }
  @keyframes toast-in { from { opacity: 0; transform: translateY(8px); } }
  @media (prefers-reduced-motion: reduce) { .toast { animation: none; } }
`;

function isConfirmationPage(url: URL): boolean {
  if (url.hostname.endsWith("greenhouse.io")) return /\/confirmation\/?$/.test(url.pathname);
  if (url.hostname === "jobs.lever.co") return /\/thanks\/?$/.test(url.pathname);
  return false;
}

export default defineContentScript({
  matches: ["*://*.greenhouse.io/*", "*://jobs.lever.co/*"],
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

    async function checkForConfirmation() {
      const url = location.href;
      if (reported.has(url) || !isConfirmationPage(new URL(url))) return;
      reported.add(url);

      const job = extractJobFromPage();
      const response = await browser.runtime.sendMessage({ type: "APPLICATION_SUBMITTED", url, job });
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
            const add = await browser.runtime.sendMessage({ type: "ADD_AS_APPLIED", url, job });
            return add?.ok ? "Added to Applied." : `Couldn't add: ${add?.error ?? "unknown error"}`;
          },
        });
      }
    }

    checkForConfirmation().catch(console.error);
    ctx.addEventListener(window, "wxt:locationchange", () => {
      checkForConfirmation().catch(console.error);
    });
  },
});
