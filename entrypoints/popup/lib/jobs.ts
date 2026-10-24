import { jobKey } from "./job-key";

export type Stage = "SAVED" | "APPLIED" | "INTERVIEWING" | "OFFER" | "DENIED";

export interface Job {
  id: string;
  company: string | null;
  role: string | null;
  url: string;
  stage: Stage;
  created_at: string;
}

export type NewJob = Pick<Job, "company" | "role" | "url" | "stage">;

const STORAGE_KEY = "jobs";
const STAGE_KEYS: Stage[] = ["SAVED", "APPLIED", "INTERVIEWING", "OFFER", "DENIED"];

// The whole list lives under one key in storage.local, newest first. The popup and the
// background both write it, so each context runs its read-modify-writes one at a time.
let queue: Promise<unknown> = Promise.resolve();

function mutate<T>(change: (jobs: Job[]) => { jobs: Job[]; result: T }): Promise<T> {
  const run = queue.then(async () => {
    const { jobs, result } = change(await listJobs());
    await browser.storage.local.set({ [STORAGE_KEY]: jobs });
    return result;
  });
  queue = run.catch(() => {});
  return run;
}

export async function listJobs(): Promise<Job[]> {
  const stored = await browser.storage.local.get(STORAGE_KEY);
  return (stored[STORAGE_KEY] as Job[] | undefined) ?? [];
}

// The page you saved, its application form and its confirmation screen all match.
export async function findJob(urls: (string | undefined)[]): Promise<Job | null> {
  const keys = new Set(urls.flatMap((url) => (url ? [jobKey(url)] : [])));
  return (await listJobs()).find((j) => keys.has(jobKey(j.url))) ?? null;
}

// Adds the job unless one with the same job key exists; returns whichever is stored.
export function addJob(job: NewJob): Promise<{ job: Job; existing: boolean }> {
  return mutate<{ job: Job; existing: boolean }>((jobs) => {
    const key = jobKey(job.url);
    const existing = jobs.find((j) => jobKey(j.url) === key);
    if (existing) return { jobs, result: { job: existing, existing: true } };
    const created: Job = { ...job, id: crypto.randomUUID(), created_at: new Date().toISOString() };
    return { jobs: [created, ...jobs], result: { job: created, existing: false } };
  });
}

export function updateJob(id: string, patch: Partial<Omit<Job, "id">>): Promise<void> {
  return mutate((jobs) => ({ jobs: jobs.map((j) => (j.id === id ? { ...j, ...patch } : j)), result: undefined }));
}

export function deleteJob(id: string): Promise<void> {
  return mutate((jobs) => ({ jobs: jobs.filter((j) => j.id !== id), result: undefined }));
}

export function onJobsChanged(callback: (jobs: Job[]) => void): () => void {
  const listener = (changes: Record<string, { newValue?: unknown }>, area: string) => {
    if (area === "local" && STORAGE_KEY in changes) callback((changes[STORAGE_KEY]!.newValue as Job[]) ?? []);
  };
  browser.storage.onChanged.addListener(listener);
  return () => browser.storage.onChanged.removeListener(listener);
}

export async function exportJobs(): Promise<string> {
  return JSON.stringify({ app: "JobRun", version: 1, exportedAt: new Date().toISOString(), jobs: await listJobs() }, null, 2);
}

// Merges an export into the list, skipping jobs that are already tracked. Returns how many were added.
export function importJobs(text: string): Promise<number> {
  const parsed = JSON.parse(text);
  const incoming: unknown[] = Array.isArray(parsed) ? parsed : parsed?.jobs;
  if (!Array.isArray(incoming)) throw new Error("This file isn't a JobRun export.");

  const valid = incoming.filter(
    (j): j is Job =>
      typeof j === "object" && j !== null && typeof (j as Job).url === "string" && STAGE_KEYS.includes((j as Job).stage),
  );

  return mutate((jobs) => {
    const seen = new Set(jobs.map((j) => jobKey(j.url)));
    const added: Job[] = [];
    for (const j of valid) {
      const key = jobKey(j.url);
      if (seen.has(key)) continue;
      seen.add(key);
      added.push({
        id: crypto.randomUUID(),
        company: j.company ?? null,
        role: j.role ?? null,
        url: j.url,
        stage: j.stage,
        created_at: typeof j.created_at === "string" ? j.created_at : new Date().toISOString(),
      });
    }
    const merged = [...added, ...jobs].sort((a, b) => b.created_at.localeCompare(a.created_at));
    return { jobs: merged, result: added.length };
  });
}
