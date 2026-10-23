import { normalizeJobUrl } from "./normalize-job-url";

const GREENHOUSE_HOST = /(^|\.)greenhouse\.io$/;
const GREENHOUSE_JOB_PATH = /\/jobs\/(\d+)(?:\/confirmation)?$/;
const LEVER_JOB_PATH = /^\/[^/]+\/([0-9a-f-]{36})(?:\/(?:apply|thanks))?$/i;
const ASHBY_JOB_PATH = /^\/[^/]+\/([0-9a-f-]{36})(?:\/application)?$/i;
const WORKDAY_HOST = /\.(myworkdayjobs|myworkdaysite)\.com$/;
// ".../job/<location>/<Title>_<ReqId>" and everything under it (/apply, /apply/applyManually, ...)
const WORKDAY_JOB_PATH = /^(.*\/(?:job|details)\/(?:.*\/)?[^/]*_([A-Za-z0-9-]+))(?:\/|$)/;
const SMARTRECRUITERS_JOB_PATH = /^\/[^/]+\/(\d{6,})(?:-|$)/;

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

  if (url.hostname === "jobs.ashbyhq.com") {
    const id = url.pathname.match(ASHBY_JOB_PATH)?.[1];
    if (id) return `ashby:${id.toLowerCase()}`;
  }

  if (WORKDAY_HOST.test(url.hostname)) {
    const id = url.pathname.match(WORKDAY_JOB_PATH)?.[2];
    if (id) return `workday:${url.hostname}:${id}`;
  }

  if (url.hostname === "jobs.smartrecruiters.com") {
    const id = url.pathname.match(SMARTRECRUITERS_JOB_PATH)?.[1];
    if (id) return `smartrecruiters:${id}`;
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
  } else if (url.hostname === "jobs.ashbyhq.com") {
    url.pathname = url.pathname.replace(/\/application$/, "");
  } else if (WORKDAY_HOST.test(url.hostname)) {
    const jobPath = url.pathname.match(WORKDAY_JOB_PATH)?.[1];
    if (jobPath) url.pathname = jobPath;
  }
  return url.toString();
}
