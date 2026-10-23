export interface ExtractedJob {
  role: string | null;
  company: string | null;
}

// Serialised and run inside the page by scripting.executeScript, so it must
// stay self-contained: no imports, no references to anything outside it.
export function extractJobFromPage(): ExtractedJob {
  const clean = (value: unknown): string | null => {
    if (typeof value !== "string") return null;
    const text = new DOMParser().parseFromString(value, "text/html").documentElement.textContent?.trim();
    return text || null;
  };

  const findJobPosting = (node: any): any => {
    if (!node || typeof node !== "object") return null;
    if ([node["@type"]].flat().includes("JobPosting")) return node;
    for (const child of Array.isArray(node) ? node : Object.values(node)) {
      const found = findJobPosting(child);
      if (found) return found;
    }
    return null;
  };

  for (const script of document.querySelectorAll('script[type="application/ld+json"]')) {
    try {
      // Raw newlines inside description strings are common and make JSON.parse throw.
      const posting = findJobPosting(JSON.parse((script.textContent ?? "").replace(/[\u0000-\u001F]+/g, " ")));
      if (!posting) continue;
      const org = [posting.hiringOrganization].flat()[0];
      return {
        role: clean(posting.title),
        company: clean(typeof org === "string" ? org : org?.name),
      };
    } catch {
      continue;
    }
  }

  // LinkedIn's job pages and the search pane's detail view render the top card without JSON-LD.
  if (location.hostname.endsWith("linkedin.com")) {
    const text = (selector: string) => clean(document.querySelector(selector)?.textContent);
    const role = text(
      ".job-details-jobs-unified-top-card__job-title, .jobs-unified-top-card__job-title, .top-card-layout__title",
    );
    if (role) {
      return {
        role,
        company: text(
          ".job-details-jobs-unified-top-card__company-name, .jobs-unified-top-card__company-name, .topcard__org-name-link",
        ),
      };
    }
  }

  // Greenhouse ships no JSON-LD but titles every job page this way.
  const greenhouse = document.title.match(/^Job Application for (.+) at (.+)$/);
  if (greenhouse) return { role: clean(greenhouse[1]), company: clean(greenhouse[2]) };

  // Lever's /apply and /thanks pages have no JSON-LD; their titles are "Company - Role".
  const lever = location.hostname === "jobs.lever.co" && document.title.match(/^(.+?) - (.+)$/);
  if (lever) return { role: clean(lever[2]), company: clean(lever[1]) };

  const meta = (property: string) =>
    document.querySelector<HTMLMetaElement>(`meta[property="${property}"]`)?.content;

  return {
    role: clean(meta("og:title") ?? document.title),
    company: clean(meta("og:site_name")),
  };
}

export async function extractJob(tabId: number): Promise<ExtractedJob | null> {
  try {
    const [injection] = await browser.scripting.executeScript({ target: { tabId }, func: extractJobFromPage });
    return injection?.result ?? null;
  } catch {
    // chrome://, the Web Store and other restricted pages can't be scripted.
    return null;
  }
}
