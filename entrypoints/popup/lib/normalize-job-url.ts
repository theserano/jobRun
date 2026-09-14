const TRACKING_PARAMS = new Set([
  "gh_src",
  "lever-source",
  "lever-origin",
  "refId",
  "trackingId",
  "trk",
  "trkInfo",
  "lipi",
  "eBP",
  "originalSubdomain",
  "fbclid",
  "gclid",
  "ref",
  "source",
]);

export function normalizeJobUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return raw;
  }

  if (url.hostname.endsWith("linkedin.com")) {
    const id = url.searchParams.get("currentJobId") ?? url.pathname.match(/\/jobs\/view\/(?:[^/]*-)?(\d+)/)?.[1];
    if (id) return `https://www.linkedin.com/jobs/view/${id}`;
  }

  for (const key of [...url.searchParams.keys()]) {
    if (key.startsWith("utm_") || TRACKING_PARAMS.has(key)) url.searchParams.delete(key);
  }
  url.searchParams.sort();
  url.hash = "";
  if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/+$/, "");
  return url.toString();
}
