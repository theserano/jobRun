import { useLayoutEffect, useRef, useState } from "react";
import "./App.css";
import { extractJob } from "./lib/extract-job";
import {
  addJob,
  deleteJob,
  exportJobs,
  importJobs,
  listJobs,
  onJobsChanged,
  updateJob,
  type Job,
  type Stage,
} from "./lib/jobs";
import { normalizeJobUrl } from "./lib/normalize-job-url";
import { applyTheme, loadTheme, NEXT_THEME, saveTheme, type Theme } from "./lib/theme";

const STAGES: { key: Stage; label: string }[] = [
  { key: "SAVED", label: "Saved" },
  { key: "APPLIED", label: "Applied" },
  { key: "INTERVIEWING", label: "Interviewing" },
  { key: "OFFER", label: "Offer" },
  { key: "DENIED", label: "Denied" },
];

const THEME_LABELS: Record<Theme, string> = { auto: "Auto", light: "Light", dark: "Dark" };

const ROW_EXIT_MS = 180;
// Chrome closes a popup when a file picker opens, so Import runs from this page in a tab.
const IN_TAB = location.hash === "#tab";

function formatRelative(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const days = Math.round(diffMs / (1000 * 60 * 60 * 24));
  if (days <= 0) return "today";
  if (days === 1) return "1 day ago";
  return `${days} days ago`;
}

function stageIndex(stage: Stage): number {
  return STAGES.findIndex((s) => s.key === stage);
}

function stageLabel(stage: Stage): string | undefined {
  return STAGES.find((s) => s.key === stage)?.label;
}

function prefersReducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export default function App() {
  const [applications, setApplications] = useState<Job[]>([]);
  const [activeStage, setActiveStage] = useState<Stage>("SAVED");
  const stagesRef = useRef<HTMLElement>(null);
  const [theme, setTheme] = useState<Theme>(loadTheme);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [slideFrom, setSlideFrom] = useState<"left" | "right">("right");
  const [leaving, setLeaving] = useState<{ id: string; to: "left" | "right" } | null>(null);
  const [arrivedId, setArrivedId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const importInput = useRef<HTMLInputElement>(null);

  // The background also writes jobs (when it detects an application), so follow storage live.
  useEffect(() => {
    listJobs().then(setApplications).catch((err) => setError(errorMessage(err)));
    return onJobsChanged(setApplications);
  }, []);

  const visible = applications.filter((a) => a.stage === activeStage);
  const inMotionCount = applications.filter((a) => a.stage !== "OFFER" && a.stage !== "DENIED").length;

  // Tabs size to their labels, so the indicator follows the active tab's measured box
  useLayoutEffect(() => {
    const nav = stagesRef.current;
    const tab = nav?.querySelector<HTMLElement>(".app__stage--active");
    const indicator = nav?.querySelector<HTMLElement>(".app__stages-indicator");
    if (!tab || !indicator) return;
    indicator.style.width = `${tab.offsetWidth}px`;
    indicator.style.transform = `translateX(${tab.offsetLeft}px)`;
  }, [activeStage, applications]);

  function cycleTheme() {
    const next = NEXT_THEME[theme];
    applyTheme(next);
    saveTheme(next);
    setTheme(next);
  }

  function selectStage(next: Stage) {
    if (next === activeStage) return;
    setSlideFrom(stageIndex(next) > stageIndex(activeStage) ? "right" : "left");
    setActiveStage(next);
    setArrivedId(null);
  }

  async function handleStageChange(id: string, stage: Stage) {
    const from = activeStage;
    const direction = stageIndex(stage) > stageIndex(from) ? "right" : "left";
    setError(null);
    setNotice(null);

    const update = updateJob(id, { stage }).then(() => null, (err: unknown) => err);

    setLeaving({ id, to: direction });
    await wait(prefersReducedMotion() ? 0 : ROW_EXIT_MS);
    setLeaving(null);
    setApplications((prev) => prev.map((a) => (a.id === id ? { ...a, stage } : a)));
    setSlideFrom(direction);
    setActiveStage(stage);
    setArrivedId(id);

    const error = await update;
    if (error) {
      setApplications((prev) => prev.map((a) => (a.id === id ? { ...a, stage: from } : a)));
      setSlideFrom(direction === "right" ? "left" : "right");
      setActiveStage(from);
      setArrivedId(null);
      setError(errorMessage(error));
    }
  }

  async function handleDelete(id: string) {
    const removed = applications.find((a) => a.id === id);
    if (!removed) return;
    setConfirmDeleteId(null);
    setError(null);
    setNotice(null);

    const request = deleteJob(id).then(() => null, (err: unknown) => err);

    setRemovingId(id);
    await wait(prefersReducedMotion() ? 0 : ROW_EXIT_MS);
    setRemovingId(null);
    setApplications((prev) => prev.filter((a) => a.id !== id));

    const error = await request;
    if (error) {
      setApplications((prev) => [...prev, removed].sort((a, b) => b.created_at.localeCompare(a.created_at)));
      setError(errorMessage(error));
    }
  }

  async function handleSaveCurrentPage() {
    setIsSaving(true);
    setError(null);
    setNotice(null);
    try {
      const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
      if (!tab?.url) throw new Error("This page can't be saved.");
      const job = tab.id ? await extractJob(tab.id) : null;
      const { job: saved, existing } = await addJob({
        role: job?.role ?? tab.title ?? "Untitled role",
        company: job?.company ?? new URL(tab.url).hostname.replace(/^www\./, ""),
        url: normalizeJobUrl(tab.url),
        stage: "SAVED",
      });

      if (existing) setNotice(`Already saved in ${stageLabel(saved.stage)}.`);
      else setApplications((prev) => [saved, ...prev.filter((a) => a.id !== saved.id)]);
      selectStage(saved.stage);
      setArrivedId(saved.id);
    } catch (err) {
      console.error("Error saving current page:", err);
      setError(errorMessage(err));
    } finally {
      setIsSaving(false);
    }
  }

  async function handleExport() {
    setError(null);
    setNotice(null);
    try {
      const blob = new Blob([await exportJobs()], { type: "application/json" });
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = `jobrun-${new Date().toISOString().slice(0, 10)}.json`;
      link.click();
      URL.revokeObjectURL(link.href);
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  async function handleImportClick() {
    if (IN_TAB) {
      importInput.current?.click();
      return;
    }
    await browser.tabs.create({ url: browser.runtime.getURL("/popup.html#tab") });
    window.close();
  }

  async function handleImportFile(file: File | undefined) {
    if (!file) return;
    setError(null);
    setNotice(null);
    try {
      const added = await importJobs(await file.text());
      setNotice(added === 0 ? "Nothing new to import." : `Imported ${added} ${added === 1 ? "job" : "jobs"}.`);
    } catch (err) {
      setError(err instanceof SyntaxError ? "This file isn't a JobRun export." : errorMessage(err));
    } finally {
      if (importInput.current) importInput.current.value = "";
    }
  }

  return (
    <div className={"app" + (IN_TAB ? " app--tab" : "")}>
      <header className="app__header">
        <div className="app__brand">
          <span className="app__brand-dot" />
          JobRun
        </div>
        <button
          className="app__icon-button"
          onClick={cycleTheme}
          aria-label={`Theme: ${THEME_LABELS[theme]}. Switch to ${THEME_LABELS[NEXT_THEME[theme]]}`}
          title={`Theme: ${THEME_LABELS[theme]}`}
        >
          <svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            {theme === "light" && (
              <>
                <circle cx="10" cy="10" r="2.5" />
                <path d="M10 2.5v2M10 15.5v2M17.5 10h-2M4.5 10h-2M15.1 4.9l-1.4 1.4M6.3 13.7l-1.4 1.4M15.1 15.1l-1.4-1.4M6.3 6.3 4.9 4.9" />
              </>
            )}
            {theme === "dark" && <path d="M16 12.2A6.5 6.5 0 0 1 7.8 4a6.5 6.5 0 1 0 8.2 8.2Z" />}
            {theme === "auto" && (
              <>
                <circle cx="10" cy="10" r="6.5" />
                <path d="M10 3.5a6.5 6.5 0 0 1 0 13Z" fill="currentColor" />
              </>
            )}
          </svg>
        </button>
      </header>

      <section className="app__hero">
        <p className="app__hero-number">{inMotionCount}</p>
        <p className="app__hero-label">applications in motion</p>
      </section>

      <button className="app__save-button" onClick={handleSaveCurrentPage} disabled={isSaving}>
        {isSaving ? "Saving…" : "Save this page"}
        <span className="app__save-plus" aria-hidden="true">
          +
        </span>
      </button>

      {error && <p className="app__error">{error}</p>}
      {notice && <p className="app__notice">{notice}</p>}

      <nav ref={stagesRef} className="app__stages" aria-label="Application stage">
        {STAGES.map((s) => {
          const count = applications.filter((a) => a.stage === s.key).length;
          return (
            <button
              key={s.key}
              className={"app__stage" + (activeStage === s.key ? " app__stage--active" : "")}
              onClick={() => selectStage(s.key)}
            >
              {s.label}
              <span className="app__stage-count">{count}</span>
            </button>
          );
        })}
        <span className="app__stages-indicator" aria-hidden="true" />
      </nav>

      <ul key={activeStage} className={`app__list app__list--from-${slideFrom}`}>
        {visible.length === 0 && (
          <li className="app__empty">
            Nothing here yet. Save a posting to add it to {stageLabel(activeStage)?.toLowerCase()}.
          </li>
        )}
        {visible.map((a) => (
          <li
            key={a.id}
            className={[
              "app__row",
              `app__row--${a.stage.toLowerCase()}`,
              leaving?.id === a.id && `app__row--leaving-${leaving.to}`,
              arrivedId === a.id && "app__row--arrived",
              removingId === a.id && "app__row--removing",
            ]
              .filter(Boolean)
              .join(" ")}
          >
            <a className="app__row-main" href={a.url} target="_blank" rel="noreferrer">
              <p className="app__row-company">{a.company}</p>
              <p className="app__row-role">{a.role}</p>
            </a>
            <div className="app__row-meta">
              <div className="app__row-top">
                <p className="app__row-time">{formatRelative(a.created_at)}</p>
                {confirmDeleteId === a.id ? (
                  <button
                    className="app__row-delete app__row-delete--confirm"
                    onClick={() => handleDelete(a.id)}
                    onBlur={() => setConfirmDeleteId(null)}
                    onKeyDown={(e) => e.key === "Escape" && setConfirmDeleteId(null)}
                    autoFocus
                  >
                    Delete?
                  </button>
                ) : (
                  <button
                    className="app__row-delete"
                    onClick={() => setConfirmDeleteId(a.id)}
                    aria-label={`Delete ${a.role ?? "this application"}`}
                    title="Delete"
                  >
                    <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.5h5.8l.6-8.5" />
                    </svg>
                  </button>
                )}
              </div>
              <select
                className="app__row-stage"
                value={a.stage}
                onChange={(e) => handleStageChange(a.id, e.target.value as Stage)}
                aria-label={`Stage for ${a.role ?? "this application"}`}
              >
                {STAGES.map((s) => (
                  <option key={s.key} value={s.key}>
                    {s.label}
                  </option>
                ))}
              </select>
            </div>
          </li>
        ))}
      </ul>

      <footer className="app__footer">
        <span className="app__sync-dot" />
        Saved on this device
        <button className="app__footer-action" onClick={handleExport} title="Download your jobs as a file">
          Export
        </button>
        <button className="app__footer-action" onClick={handleImportClick} title="Add jobs from an export file">
          Import
        </button>
        <input
          ref={importInput}
          type="file"
          accept="application/json,.json"
          hidden
          onChange={(e) => handleImportFile(e.target.files?.[0])}
        />
      </footer>
    </div>
  );
}
