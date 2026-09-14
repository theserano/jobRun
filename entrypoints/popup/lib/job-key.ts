import { normalizeJobUrl } from "./normalize-job-url";

const GREENHOUSE_HOST = /(^|\.)greenhouse\.io$/;
const GREENHOUSE_JOB_PATH = /\/jobs\/(\d+)(?:\/confirmation)?$/;
const LEVER_JOB_PATH = /^\/[^/]+\/([0-9a-f-]{36})(?:\/(?:apply|thanks))?$/i;

// The page you saved, its application form and the confirmation screen all
// reduce to the same key, so a confirmation can be matched to a saved job.
export function jobKey(raw: string): string {
  const normalized = normalizeJobUrl(raw);
  let url: URL;
  try {
    url = new URL(normalized);
  } catch {
    return normalized;
  }

  const greenhouseId =
    url.searchParams.get("gh_jid") ??
    (GREENHOUSE_HOST.test(url.hostname)
      ? (url.searchParams.get("token") ?? url.pathname.match(GREENHOUSE_JOB_PATH)?.[1])
      : undefined);
  if (greenhouseId) return `greenhouse:${greenhouseId}`;

  if (url.hostname === "jobs.lever.co") {
    const id = url.pathname.match(LEVER_JOB_PATH)?.[1];
    if (id) return `lever:${id.toLowerCase()}`;
  }

  return normalized;
}

export function jobPageUrl(raw: string): string {
  const normalized = normalizeJobUrl(raw);
  let url: URL;
  try {
    url = new URL(normalized);
  } catch {
    return normalized;
  }

  if (url.hostname === "jobs.lever.co" || GREENHOUSE_HOST.test(url.hostname)) {
    url.pathname = url.pathname.replace(/\/(apply|thanks|confirmation)$/, "");
  }
  return url.toString();
}
