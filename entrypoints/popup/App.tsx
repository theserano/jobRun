import { useState } from "react";
import "./App.css";
import { supabase } from "./lib/supabase";
import { signInWithGoogle } from "./lib/auth";
import google from "../../assets/google.svg";

type Stage = "SAVED" | "APPLIED" | "INTERVIEWING" | "OFFER";

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
];

function formatRelative(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const days = Math.round(diffMs / (1000 * 60 * 60 * 24));
  if (days <= 0) return "today";
  if (days === 1) return "1 day ago";
  return `${days} days ago`;
}

export default function App() {
  const [applications, setApplications] = useState<Application[]>([]);
  const [activeStage, setActiveStage] = useState<Stage>("APPLIED");
  const [isSaving, setIsSaving] = useState(false);
  const [user, setUser] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

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
  const inMotionCount = applications.filter((a) => a.stage !== "OFFER").length;

  async function handleStageChange(id: number, stage: Stage) {
    const previous = applications;
    setApplications((prev) => prev.map((a) => (a.id === id ? { ...a, stage } : a)));
    setError(null);

    const { error } = await supabase.from("jobs").update({ stage }).eq("id", id);

    if (error) {
      setApplications(previous);
      setError(error.message);
    }
  }

  async function handleSaveCurrentPage() {
    setIsSaving(true);
    setError(null);
    try {
      const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
      const {
      data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("Not signed in");
      const { data, error } = await supabase
        .from("jobs")
        .insert({
          user_id: user.id,
          role: tab?.title ?? "Untitled role",
          company: tab?.url ? new URL(tab.url).hostname.replace(/^www\./, "") : null,
          url: tab?.url ?? "",
          stage: "SAVED",
        })
        .select()
        .single();

      if (error) throw error;
      setApplications((prev) => [data as Application, ...prev]);
      setActiveStage("SAVED");
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
        <button className="app__icon-button" aria-label="Settings" title="Settings">
          <svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5">
            <circle cx="10" cy="10" r="2.5" />
            <path d="M10 2.5v2M10 15.5v2M17.5 10h-2M4.5 10h-2M15.1 4.9l-1.4 1.4M6.3 13.7l-1.4 1.4M15.1 15.1l-1.4-1.4M6.3 6.3 4.9 4.9" />
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

      <nav className="app__stages" aria-label="Application stage">
        {STAGES.map((s) => {
          const count = applications.filter((a) => a.stage === s.key).length;
          return (
            <button
              key={s.key}
              className={"app__stage" + (activeStage === s.key ? " app__stage--active" : "")}
              onClick={() => setActiveStage(s.key)}
            >
              {s.label}
              <span className="app__stage-count">{count}</span>
            </button>
          );
        })}
      </nav>

      <ul className="app__list">
        {visible.length === 0 && (
          <li className="app__empty">
            Nothing here yet. Save a posting to add it to {STAGES.find((s) => s.key === activeStage)?.label.toLowerCase()}.
          </li>
        )}
        {visible.map((a) => (
          <li key={a.id} className={`app__row app__row--${a.stage.toLowerCase()}`}>
            <div className="app__row-main">
              <p className="app__row-company">{a.company}</p>
              <p className="app__row-role">{a.role}</p>
            </div>
            <div className="app__row-meta">
              <p className="app__row-time">{formatRelative(a.created_at)}</p>
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
        Synced just now
      </footer>
    </div>
  );
}