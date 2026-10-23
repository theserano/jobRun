import { useLayoutEffect, useRef, useState } from "react";
import "./App.css";
import { supabase } from "./lib/supabase";
import { signInWithGoogle, signOut } from "./lib/auth";
import { extractJob } from "./lib/extract-job";
import { normalizeJobUrl } from "./lib/normalize-job-url";
import google from "../../assets/google.svg";
import { applyTheme, loadTheme, NEXT_THEME, saveTheme, type Theme } from "./lib/theme";

type Stage = "SAVED" | "APPLIED" | "INTERVIEWING" | "OFFER" | "DENIED";

interface Application {
  id: number;
  company: string | null;
  role: string | null;
  url: string | null;
  stage: Stage;
  created_at: string;
}

const STAGES: { key: Stage; label: string }[] = [
  { key: "SAVED", label: "Saved" },
  { key: "APPLIED", label: "Applied" },
  { key: "INTERVIEWING", label: "Interviewing" },
  { key: "OFFER", label: "Offer" },
  { key: "DENIED", label: "Denied" },
];

const THEME_LABELS: Record<Theme, string> = { auto: "Auto", light: "Light", dark: "Dark" };

const ROW_EXIT_MS = 180;
const UNIQUE_VIOLATION = "23505";

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

export default function App() {
  const [applications, setApplications] = useState<Application[]>([]);
  const [activeStage, setActiveStage] = useState<Stage>("SAVED");
  const stagesRef = useRef<HTMLElement>(null);
  const [theme, setTheme] = useState<Theme>(loadTheme);
  const [isSaving, setIsSaving] = useState(false);
  const [user, setUser] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [slideFrom, setSlideFrom] = useState<"left" | "right">("right");
  const [leaving, setLeaving] = useState<{ id: number; to: "left" | "right" } | null>(null);
  const [arrivedId, setArrivedId] = useState<number | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);
  const [removingId, setRemovingId] = useState<number | null>(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUser(data.user));
  }, []);

  useEffect(() => {
    if (!user) return;
    supabase
      .from("jobs")
      .select("*")
      .order("created_at", { ascending: false })
      .then(({ data, error }) => {
        if (error) setError(error.message);
        else setApplications(data as Application[]);
      });
  }, [user]);

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
  }, [activeStage, applications, user]);

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

  async function handleStageChange(id: number, stage: Stage) {
    const from = activeStage;
    const direction = stageIndex(stage) > stageIndex(from) ? "right" : "left";
    setError(null);
    setNotice(null);

    const update = supabase.from("jobs").update({ stage }).eq("id", id).then(({ error }) => error);

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
      setError(error.message);
    }
  }

  async function handleDelete(id: number) {
    const removed = applications.find((a) => a.id === id);
    if (!removed) return;
    setConfirmDeleteId(null);
    setError(null);
    setNotice(null);

    const request = supabase.from("jobs").delete().eq("id", id).then(({ error }) => error);

    setRemovingId(id);
    await wait(prefersReducedMotion() ? 0 : ROW_EXIT_MS);
    setRemovingId(null);
    setApplications((prev) => prev.filter((a) => a.id !== id));

    const error = await request;
    if (error) {
      setApplications((prev) => [...prev, removed].sort((a, b) => b.created_at.localeCompare(a.created_at)));
      setError(error.message);
    }
  }

  async function handleSaveCurrentPage() {
    setIsSaving(true);
    setError(null);
    setNotice(null);
    try {
      const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("Not signed in");
      const url = tab?.url ? normalizeJobUrl(tab.url) : "";
      const job = tab?.id ? await extractJob(tab.id) : null;
      const { data, error } = await supabase
        .from("jobs")
        .insert({
          user_id: user.id,
          role: job?.role ?? tab?.title ?? "Untitled role",
          company: job?.company ?? (tab?.url ? new URL(tab.url).hostname.replace(/^www\./, "") : null),
          url,
          stage: "SAVED",
        })
        .select()
        .single();

      if (error?.code === UNIQUE_VIOLATION) {
        const existing = applications.find((a) => a.url === url);
        if (existing) {
          setNotice(`Already saved in ${stageLabel(existing.stage)}.`);
          selectStage(existing.stage);
          setArrivedId(existing.id);
        } else {
          setNotice("Already saved.");
        }
        return;
      }
      if (error) throw error;
      setApplications((prev) => [data as Application, ...prev]);
      selectStage("SAVED");
      setArrivedId((data as Application).id);
    } catch (err) {
      console.error("Error saving current page:", err);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="app">
      <header className="app__header">
        <div className="app__brand">
          <span className="app__brand-dot" />
          JobRun
        </div>
        {!user && (
          <button onClick={() => signInWithGoogle().then(() => window.location.reload()).catch(console.error)} className="app__google__button" aria-label="Sign in with Google" title="Sign in with Google">
            <img src={google} alt="Sign in with Google" style={{ width: "16px", height: "16px" }} />
            Sign in with Google
          </button>
        )}
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
            <a className="app__row-main" href={a.url || undefined} target="_blank" rel="noreferrer">
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
        {user ? `Signed in as ${user.email}` : "Not signed in"}
        {user && (
          <button className="app__signout" onClick={() => signOut().then(() => window.location.reload())}>
            Sign out
          </button>
        )}
      </footer>
    </div>
  );
}
