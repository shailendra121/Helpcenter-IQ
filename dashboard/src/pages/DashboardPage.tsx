import { useCallback, useEffect, useState } from "react";
import {
  draftToHtml,
  draftToMarkdown,
} from "../utils/draftExport";

type WindowDays = 30 | 60 | 90;

type RunStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed";

type Classification =
  | "missing"
  | "weak"
  | "outdated"
  | "good_coverage";

type SortOption =
  | "priority"
  | "volume"
  | "topic";

interface DashboardSession {
  authenticated: boolean;
  zendesk_account_id: number;
  subdomain: string;
  zendesk_url: string;
}

interface AnalysisRun {
  id: number;
  window_days: number;
  status: RunStatus;
  current_stage: string | null;
  error_stage: string | null;
  error_message: string | null;
  started_at?: string | null;
  completed_at?: string | null;
  stage_timestamps?: Record<
    string,
    {
      started_at?: string;
      completed_at?: string;
    }
  >;
}

interface DashboardSummary {
  top_missing_articles: Array<{
    id: number;
    topic: string;
    ticket_volume: number;
    priority_score: string | null;
  }>;

  most_repeated_questions: Array<{
    id: number;
    topic: string;
    ticket_volume: number;
    classification: Classification;
  }>;

  estimated_ticket_volume: number;
  articles_needing_updates: number;
  potential_deflection_estimate: number;
  potential_deflection_label: string;
  methodology: string;
}

interface Gap {
  id: number;
  analysis_run_id: number;
  cluster_id?: number;
  topic: string;
  classification: Classification;
  ticket_volume: number;
  priority_score: number | string | null;
  justification: string | null;

  matched_article_id: number | string | null;
  matched_article_title: string | null;
  matched_article_locale: string | null;
  matched_article_url: string | null;

  representative_tickets: RepresentativeTicket[];
  recommendations: Recommendation[];
}

interface RepresentativeTicket {
  id: number;
  zendesk_ticket_id: string;
  subject: string | null;
  description: string | null;
  status: string | null;
  zendesk_url: string;
}

interface Recommendation {
  id: number;
  recommendation_type: string;
  rationale: string;
  suggested_keywords?: string[] | null;
  suggested_title?: string | null;
}

type DraftReviewStatus =
  | "draft"
  | "in_review"
  | "approved"
  | "rejected";

interface DraftListItem {
  id: number;
  gap_id: number;
  topic: string;
  title: string;
  ai_title: string;
  status: DraftReviewStatus;
  generated_at: string;
  reviewer_edited_at: string | null;
  status_updated_at: string | null;
}

interface DraftContent {
  suggested_title: string;
  problem_summary: string;
  step_by_step_resolution: string;
  faq: Array<{
    question: string;
    answer: string;
  }>;
  related_keywords: string[];
  internal_reviewer_notes: string;
}

interface DraftReviewerRevision {
  suggested_title: string | null;
  problem_summary: string | null;
  step_by_step_resolution: string | null;
  faq:
    | Array<{
        question: string;
        answer: string;
      }>
    | null;
  related_keywords: string[] | null;
  internal_reviewer_notes: string | null;
}

interface DraftDetail {
  id: number;
  gap_id: number;
  status: DraftReviewStatus;
  generated_at: string;
  reviewer_edited_at: string | null;
  status_updated_at: string | null;
  rejection_reason: string | null;
  ai_original: DraftContent;
  reviewer_revision: DraftReviewerRevision;
}

const classificationLabels: Record<
  Classification,
  string
> = {
  missing: "Missing",
  weak: "Weak",
  outdated: "Outdated",
  good_coverage: "Good",
};

const stageLabels: Record<string, string> = {
  ticket_ingestion: "Ticket ingestion",
  guide_ingestion: "Guide ingestion",
  clustering: "Clustering",
  classification: "Classification",
  recommendation: "Recommendations",
};

function formatRecommendationType(
  value: string,
): string {
  return value
    .split("_")
    .map(
      (part) =>
        part.charAt(0).toUpperCase() +
        part.slice(1),
    )
    .join(" ");
}

export default function DashboardPage() {
  const [dashboardSession, setDashboardSession] =
    useState<DashboardSession | null>(null);

  const [windowDays, setWindowDays] =
    useState<WindowDays>(30);

  const [run, setRun] =
    useState<AnalysisRun | null>(null);

  const [summary, setSummary] =
    useState<DashboardSummary | null>(null);

  const [gaps, setGaps] = useState<Gap[]>([]);

  const [classification, setClassification] =
    useState<Classification | "">("");

  const [sort, setSort] =
    useState<SortOption>("priority");

  const [selectedGap, setSelectedGap] =
    useState<Gap | null>(null);

  const [loading, setLoading] =
    useState(true);

  const [starting, setStarting] =
    useState(false);

  const [generatingDraft, setGeneratingDraft] =
    useState(false);

  const [draftMessage, setDraftMessage] =
    useState("");

  const [drafts, setDrafts] =
  useState<DraftListItem[]>([]);

  const [selectedDraft, setSelectedDraft] =
  useState<DraftDetail | null>(null);

  const [draftForm, setDraftForm] =
  useState<DraftContent | null>(null);
  
  const [draftFormDirty, setDraftFormDirty] =
  useState(false);

  const [pendingClose, setPendingClose] =
  useState(false);

  const [pendingRegenerate, setPendingRegenerate] =
  useState(false);
  
  const [pendingStatusChange, setPendingStatusChange] =
  useState<{
    status: DraftReviewStatus;
    rejectionReason?: string;
  } | null>(null);

  const [savingDraft, setSavingDraft] =
  useState(false);

  const [draftActionMessage, setDraftActionMessage] =
  useState("");
  
  const [updatingDraftStatus, setUpdatingDraftStatus] =
  useState(false);
  
  const [regeneratingDraft, setRegeneratingDraft] =
  useState(false);

  const [rejectionReason, setRejectionReason] =
  useState("");
   
  const [draftsLoading, setDraftsLoading] =
  useState(false);

  const [draftsError, setDraftsError] =
  useState("");  

  const [error, setError] =
    useState("");

  const [gapsError, setGapsError] =
  useState("");

  /*
   * Fetch the authenticated Zendesk tenant represented
   * by the signed ZAF dashboard session.
   */
  const fetchDashboardSession =
    useCallback(async () => {
      const response = await fetch(
        "/api/dashboard/session",
        {
          credentials: "include",
        },
      );

      if (!response.ok) {
        throw new Error(
          "Failed to verify connected Zendesk account.",
        );
      }

      const data =
        (await response.json()) as DashboardSession;

      setDashboardSession(data);
    }, []);

  /*
   * Fetch dashboard summary.
   */
  const fetchSummary =
    useCallback(async () => {
      const response = await fetch(
        "/api/dashboard/summary",
        {
          credentials: "include",
        },
      );

      if (!response.ok) {
        throw new Error(
          "Failed to fetch dashboard summary.",
        );
      }

      const data = await response.json();

      setSummary(data.summary);
    }, []);

  /*
   * Fetch gaps.
   */
  const fetchGaps =
    useCallback(async () => {
      const params = new URLSearchParams();

      if (classification) {
        params.set(
          "classification",
          classification,
        );
      }

      params.set("sort", sort);

      const response = await fetch(
        `/api/dashboard/gaps?${params.toString()}`,
        {
          credentials: "include",
        },
      );

      if (!response.ok) {
        throw new Error(
          "Failed to fetch knowledge gaps.",
        );
      }

      const data = await response.json();

      setGaps(data.gaps ?? []);
    }, [classification, sort]);

    const fetchDrafts =
  useCallback(async () => {
    try {
      setDraftsLoading(true);
      setDraftsError("");

      const response = await fetch(
        "/api/dashboard/drafts",
        {
          credentials: "include",
        },
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data.error ??
            "Failed to fetch draft articles.",
        );
      }

      setDrafts(data.drafts ?? []);
    } catch (err) {
      setDraftsError(
        err instanceof Error
          ? err.message
          : "Failed to fetch draft articles.",
      );
    } finally {
      setDraftsLoading(false);
    }
  }, []);
  const openDraft =
  useCallback(async (draftId: number) => {
    try {
      setDraftsError("");

      const response = await fetch(
        `/api/dashboard/drafts/${draftId}`,
        {
          credentials: "include",
        },
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data.error ??
            "Failed to load draft article.",
        );
      }

setSelectedDraft({
  ...data,
  ai_original: {
    ...data.ai_original,
    faq: data.ai_original?.faq ?? [],
    related_keywords:
      data.ai_original?.related_keywords ?? [],
  },
});

setDraftForm({
  suggested_title:
    data.reviewer_revision?.suggested_title ??
    data.ai_original?.suggested_title ??
    "",

  problem_summary:
    data.reviewer_revision?.problem_summary ??
    data.ai_original?.problem_summary ??
    "",

  step_by_step_resolution:
    data.reviewer_revision?.step_by_step_resolution ??
    data.ai_original?.step_by_step_resolution ??
    "",

  faq:
    data.reviewer_revision?.faq ??
    data.ai_original?.faq ??
    [],

  related_keywords:
    data.reviewer_revision?.related_keywords ??
    data.ai_original?.related_keywords ??
    [],

  internal_reviewer_notes:
    data.reviewer_revision?.internal_reviewer_notes ??
    data.ai_original?.internal_reviewer_notes ??
    "",
});
setDraftFormDirty(false);
setDraftActionMessage("");
    } catch (err) {
      setDraftsError(
        err instanceof Error
          ? err.message
          : "Failed to load draft article.",
      );
    }
  }, []);
  const saveDraftEdits =
  useCallback(async () => {
    if (!selectedDraft || !draftForm) {
      return;
    }

    try {
      setSavingDraft(true);
      setDraftActionMessage("");

      const response = await fetch(
        `/api/dashboard/drafts/${selectedDraft.id}`,
        {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
          },
          credentials: "include",
          body: JSON.stringify({
            suggested_title:
              draftForm.suggested_title,
            problem_summary:
              draftForm.problem_summary,
            step_by_step_resolution:
              draftForm.step_by_step_resolution,
            faq: draftForm.faq,
            related_keywords:
              draftForm.related_keywords,
            internal_reviewer_notes:
              draftForm.internal_reviewer_notes,
          }),
        },
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data.error ??
            "Failed to save draft edits.",
        );
      }

      await openDraft(selectedDraft.id);
      await fetchDrafts();

      setDraftActionMessage(
     "Draft edits saved successfully.",
);
    } catch (err) {
      setDraftActionMessage(
        err instanceof Error
          ? err.message
          : "Failed to save draft edits.",
      );
    } finally {
      setSavingDraft(false);
    }
  }, [
    selectedDraft,
    draftForm,
    openDraft,
    fetchDrafts,
  ]);

  const changeDraftStatus =
  useCallback(
    async (
      newStatus: DraftReviewStatus,
      reason?: string,
    ) => {
      if (!selectedDraft) {
        return;
      }

      try {
        setUpdatingDraftStatus(true);
        setDraftActionMessage("");

        const response = await fetch(
          `/api/dashboard/drafts/${selectedDraft.id}/status`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            credentials: "include",
            body: JSON.stringify({
              status: newStatus,
              ...(reason
                ? {
                    rejection_reason:
                      reason.trim(),
                  }
                : {}),
            }),
          },
        );

        const data = await response.json();

        if (!response.ok) {
          throw new Error(
            data.error ??
              "Failed to update draft status.",
          );
        }

        setRejectionReason("");

        await openDraft(selectedDraft.id);
        await fetchDrafts();

        setDraftActionMessage(
          "Draft status updated successfully.",
        );
      } catch (err) {
        setDraftActionMessage(
          err instanceof Error
            ? err.message
            : "Failed to update draft status.",
        );
      } finally {
        setUpdatingDraftStatus(false);
      }
    },
    [
      selectedDraft,
      openDraft,
      fetchDrafts,
    ],
  );

  const regenerateDraft =
  useCallback(async () => {
    if (!selectedDraft) {
      return;
    }

    try {
      setRegeneratingDraft(true);
      setDraftActionMessage("");

      const response = await fetch(
        `/api/dashboard/drafts/${selectedDraft.id}/regenerate`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          credentials: "include",
        },
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data.error ??
            "Failed to regenerate draft.",
        );
      }

      await fetchDrafts();

      if (data.draft_id) {
        await openDraft(data.draft_id);
     }

     setDraftActionMessage(
       "Draft regenerated successfully.",
     );
    } catch (err) {
      setDraftActionMessage(
        err instanceof Error
          ? err.message
          : "Failed to regenerate draft.",
      );
    } finally {
      setRegeneratingDraft(false);
    }
  }, [
    selectedDraft,
    fetchDrafts,
    openDraft,
  ]);

  const copyDraftExport =
  useCallback(
    async (format: "markdown" | "html") => {
      if (!draftForm) {
        return;
      }

      try {
        const exportableDraft = {
          suggestedTitle:
            draftForm.suggested_title,
          problemSummary:
            draftForm.problem_summary,
          stepByStepResolution:
            draftForm.step_by_step_resolution,
          faq: draftForm.faq,
          relatedKeywords:
            draftForm.related_keywords,
          internalReviewerNotes:
            draftForm.internal_reviewer_notes,
        };

        const content =
          format === "markdown"
            ? draftToMarkdown(exportableDraft)
            : draftToHtml(exportableDraft);

        await navigator.clipboard.writeText(
          content,
        );

        setDraftActionMessage(
          format === "markdown"
            ? "Markdown copied to clipboard."
            : "HTML copied to clipboard.",
        );
      } catch {
        setDraftActionMessage(
          "Unable to copy draft to clipboard.",
        );
      }
    },
    [draftForm],
  );

  /*
   * Fetch latest run.
   *
   * This is important:
   * it restores an already-running run when
   * the dashboard page is refreshed.
   */
  const fetchLatestRun =
    useCallback(async () => {
      const response = await fetch(
        "/api/analysis-runs/latest",
        {
          credentials: "include",
        },
      );

      if (!response.ok) {
        throw new Error(
          "Failed to fetch latest analysis run.",
        );
      }

      const data = await response.json();

      setRun(data.run ?? null);

      return data.run as AnalysisRun | null;
    }, []);

  /*
 * Initial dashboard load.
 *
 * Session, summary, and latest-run state do not depend on the
 * knowledge-gap filters. Keeping them in a separate effect prevents
 * classification/sort changes from reloading the whole dashboard.
 */
useEffect(() => {
  const loadDashboard = async () => {
    try {
      setLoading(true);
      setError("");

      await Promise.all([
        fetchDashboardSession(),
        fetchSummary(),
        fetchLatestRun(),
        fetchDrafts(),
     ]);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Failed to load dashboard.",
      );
    } finally {
      setLoading(false);
    }
  };

  void loadDashboard();
}, [
  fetchDashboardSession,
  fetchSummary,
  fetchLatestRun,
  fetchDrafts,
]);

/*
 * Fetch the knowledge-gap list independently.
 *
 * Changing classification or sort only changes fetchGaps, so those
 * controls refresh the gap list without refetching the session,
 * summary, or latest analysis run.
 */
useEffect(() => {
  const loadGaps = async () => {
    try {
      setGapsError("");
      await fetchGaps();
    } catch (err) {
      setGapsError(
        err instanceof Error
          ? err.message
          : "Failed to fetch knowledge gaps.",
      );
    }
  };

  void loadGaps();
}, [fetchGaps]);
   /*
   * Poll active runs with capped backoff.
   * Wait 3s, 5s, 8s, 13s, then 20s between requests.
   */
  useEffect(() => {
    if (
      !run ||
      (run.status !== "queued" && run.status !== "running")
    ) {
      return;
    }

    const runId = run.id;
    const delays = [3000, 5000, 8000, 13000, 20000];
    let delayIndex = 0;
    let cancelled = false;
    let finished = false;
    let timeoutId: number | undefined;

    const controller = new AbortController();

    const scheduleNextPoll = () => {
      timeoutId = window.setTimeout(() => {
        void poll();
      }, delays[delayIndex]);
    };

    const poll = async () => {
      try {
        const response = await fetch(
          `/api/analysis-runs/${runId}`,
          {
            credentials: "include",
            signal: controller.signal,
          },
        );

        if (!response.ok) {
          throw new Error("Failed to refresh analysis status.");
        }

        const data = await response.json();
        const updatedRun = (data.run ?? data) as AnalysisRun;

        if (cancelled) {
          return;
        }

        finished =
          updatedRun.status === "completed" ||
          updatedRun.status === "failed";

        setRun(updatedRun);

        if (updatedRun.status === "completed") {
          // Report refresh failures separately from polling failures.
          void Promise.all([
            fetchSummary(),
            fetchGaps(),
          ]).catch((err: unknown) => {
            setError(
              err instanceof Error
                ? err.message
                : "Failed to refresh dashboard data.",
            );
          });
        }
      } catch (err) {
        if (cancelled) {
          return;
        }

        setError(
          err instanceof Error
            ? err.message
            : "Failed to refresh analysis status.",
        );
      } finally {
        if (!cancelled && !finished) {
          delayIndex = Math.min(
            delayIndex + 1,
            delays.length - 1,
          );
          scheduleNextPoll();
        }
      }
    };

    scheduleNextPoll();

    return () => {
      cancelled = true;
      controller.abort();

      if (timeoutId !== undefined) {
        window.clearTimeout(timeoutId);
      }
    };
  }, [
    run?.id,
    run?.status,
    fetchSummary,
    fetchGaps,
  ]);
  /*
   * Start new analysis.
   */
  const startAnalysis =
    async () => {
      try {
        setStarting(true);
        setError("");

        const response = await fetch(
          "/api/analysis-runs",
          {
            method: "POST",
            headers: {
              "Content-Type":
                "application/json",
            },
            credentials: "include",
            body: JSON.stringify({
              windowDays,
            }),
          },
        );

        const data =
          await response.json();

        if (response.status === 409) {
          setError(
            data.error ??
              "An analysis run is already active for this account.",
          );

          /*
           * Important:
           * If another run is active, immediately
           * fetch it and show its status.
           */
          await fetchLatestRun();

          return;
        }

        if (!response.ok) {
          throw new Error(
            data.error ??
              "Failed to start analysis.",
          );
        }

        setRun(data.run ?? data);
      } catch (err) {
        setError(
          err instanceof Error
            ? err.message
            : "Failed to start analysis.",
        );
      } finally {
        setStarting(false);
      }
    };

  /*
   * Open gap detail.
   */
  const openGap =
    async (gapId: number) => {
      try {
        setError("");
        setDraftMessage("");

        const response = await fetch(
          `/api/dashboard/gaps/${gapId}`,
          {
            credentials: "include",
          },
        );

        if (!response.ok) {
          throw new Error(
            "Failed to load gap details.",
          );
        }

        const data =
          await response.json();

        /*
         * Backend returns the gap object
         * directly, not { gap: ... }.
         */
        setSelectedGap(data);
      } catch (err) {
        setError(
          err instanceof Error
            ? err.message
            : "Failed to load gap details.",
        );
      }
    };

  /*
   * Generate draft for selected gap.
   */
  const generateDraft =
    async () => {
      if (!selectedGap) {
        return;
      }

      try {
        setGeneratingDraft(true);
        setDraftMessage("");
        setError("");

        const response = await fetch(
          `/api/dashboard/gaps/${selectedGap.id}/drafts`,
          {
            method: "POST",
            headers: {
              "Content-Type":
                "application/json",
            },
            credentials: "include",
          },
        );

        const data =
          await response.json();

        if (!response.ok) {
          throw new Error(
            data.error ??
              "Failed to generate draft.",
          );
        }
        await fetchDrafts();
        setDraftMessage(
          `Draft article generated successfully. Draft ID: ${data.id}`,
        );
      } catch (err) {
        setError(
          err instanceof Error
            ? err.message
            : "Failed to generate draft.",
        );
      } finally {
        setGeneratingDraft(false);
      }
    };

  return (
    <main
      style={{
        minHeight: "100vh",
        background: "#f7f8fa",
        padding: "32px",
        fontFamily:
          "Arial, sans-serif",
        color: "#1f2937",
      }}
    >
      <header
        style={{
          marginBottom: "32px",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          gap: "24px",
          flexWrap: "wrap",
        }}
      >
        <div>
          <h1
            style={{
              margin: 0,
            }}
          >
            HelpCenterIQ
          </h1>

          <p
            style={{
              color: "#6b7280",
              marginBottom: 0,
            }}
          >
            Knowledge gap intelligence
            dashboard
          </p>
        </div>

        {dashboardSession && (
          <div
            aria-label="Connected Zendesk account"
            style={{
              background: "#fff",
              border: "1px solid #e5e7eb",
              borderRadius: "10px",
              padding: "12px 16px",
              minWidth: "230px",
            }}
          >
            <div
              style={{
                fontSize: "12px",
                fontWeight: 600,
                color: "#047857",
                marginBottom: "4px",
              }}
            >
              ✓ Connected Zendesk
            </div>

            <a
              href={dashboardSession.zendesk_url}
              target="_blank"
              rel="noreferrer"
              style={{
                color: "#1f2937",
                fontWeight: 600,
                textDecoration: "none",
                fontSize: "14px",
              }}
            >
              {dashboardSession.subdomain}.zendesk.com
            </a>
          </div>
        )}
      </header>

      {error && (
        <div
          style={{
            marginBottom: "24px",
            padding: "12px",
            borderRadius: "6px",
            background: "#fee2e2",
            color: "#991b1b",
          }}
        >
          {error}
        </div>
      )}

      {/* Run Analysis */}
      <section
        style={{
          background: "#fff",
          border:
            "1px solid #e5e7eb",
          borderRadius: "10px",
          padding: "24px",
          marginBottom: "24px",
        }}
      >
        <h2>Run Analysis</h2>

        <p
          style={{
            color: "#6b7280",
          }}
        >
          Analyze recent Zendesk tickets
          and knowledge base content.
        </p>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "12px",
            marginTop: "20px",
            flexWrap: "wrap",
          }}
        >
          <strong>
            Lookback window:
          </strong>

          {[30, 60, 90].map(
            (days) => (
              <button
                key={days}
                onClick={() =>
                  setWindowDays(
                    days as WindowDays,
                  )
                }
                disabled={
                  starting ||
                  run?.status ===
                    "queued" ||
                  run?.status ===
                    "running"
                }
                style={{
                  padding:
                    "8px 16px",
                  borderRadius: "6px",
                  border:
                    "1px solid #d1d5db",
                  background:
                    windowDays === days
                      ? "#2563eb"
                      : "#fff",
                  color:
                    windowDays === days
                      ? "#fff"
                      : "#374151",
                  cursor:
                    starting ||
                    run?.status ===
                      "queued" ||
                    run?.status ===
                      "running"
                      ? "default"
                      : "pointer",
                }}
              >
                {days} days
              </button>
            ),
          )}

          <button
            onClick={
              startAnalysis
            }
            disabled={
              starting ||
              run?.status ===
                "queued" ||
              run?.status ===
                "running"
            }
            style={{
              marginLeft: "12px",
              padding:
                "9px 18px",
              border: "none",
              borderRadius: "6px",
              background:
                "#111827",
              color: "#fff",
              cursor:
                starting ||
                run?.status ===
                  "queued" ||
                run?.status ===
                  "running"
                  ? "default"
                  : "pointer",
              fontWeight: 600,
            }}
          >
            {starting
              ? "Starting..."
              : run?.status ===
                  "queued" ||
                run?.status ===
                  "running"
              ? "Run in progress"
              : "Start Analysis"}
          </button>
        </div>
      </section>

      {/* Analysis Status */}
      {run && (
        <section
          style={{
            background: "#fff",
            border:
              "1px solid #e5e7eb",
            borderRadius: "10px",
            padding: "24px",
            marginBottom: "24px",
          }}
        >
          <h2>
            Analysis Status
          </h2>

          <p>
            <strong>
              Run ID:
            </strong>{" "}
            {run.id}
          </p>

          <p>
            <strong>
              Status:
            </strong>{" "}
            {run.status}
          </p>

          {run.current_stage && (
            <p>
              <strong>
                Current stage:
              </strong>{" "}
              {stageLabels[
                run.current_stage
              ] ??
                run.current_stage.replace(
                  /_/g,
                  " ",
                )}
            </p>
          )}

          {run.status ===
            "queued" && (
            <p>
              Analysis is queued and
              will start shortly.
            </p>
          )}

          {run.status ===
            "running" && (
            <p>
              Analysis is currently
              running...
            </p>
          )}

          {run.status ===
            "completed" && (
            <p
              style={{
                color:
                  "#047857",
              }}
            >
              Analysis completed
              successfully.
            </p>
          )}

          {run.status ===
            "failed" && (
            <div
              style={{
                color:
                  "#b91c1c",
              }}
            >
              <p>
                <strong>
                  Failed stage:
                </strong>{" "}
                {run.error_stage ??
                  "Unknown"}
              </p>

              <p>
                <strong>
                  Error:
                </strong>{" "}
                {run.error_message ??
                  "Analysis failed."}
              </p>
            </div>
          )}
        </section>
      )}

      {/* Loading / Empty */}
      {loading ? (
        <section
          style={{
            background: "#fff",
            padding: "24px",
            borderRadius: "10px",
            marginBottom: "24px",
          }}
        >
          Loading dashboard...
        </section>
      ) : (
        <>
          {/* Dashboard Overview */}
          {summary && (
            <>
              <section
                style={{
                  marginBottom:
                    "24px",
                }}
              >
                <h2>
                  Dashboard Overview
                </h2>

                <div
                  style={{
                    display:
                      "grid",
                    gridTemplateColumns:
                      "repeat(3, minmax(0, 1fr))",
                    gap: "16px",
                  }}
                >
                  {[
                    [
                      "Estimated Ticket Volume",
                      summary.estimated_ticket_volume,
                    ],
                    [
                      "Articles Needing Updates",
                      summary.articles_needing_updates,
                    ],
                    [
                      "Potential Deflection",
                      summary.potential_deflection_estimate,
                    ],
                  ].map(
                    ([label, value]) => (
                      <div
                        key={label}
                        style={{
                          background:
                            "#fff",
                          border:
                            "1px solid #e5e7eb",
                          borderRadius:
                            "10px",
                          padding:
                            "20px",
                        }}
                      >
                        <div
                          style={{
                            color:
                              "#6b7280",
                          }}
                        >
                          {label}
                        </div>

                        <div
                          style={{
                            fontSize:
                              "28px",
                            fontWeight:
                              700,
                            marginTop:
                              "8px",
                          }}
                        >
                          {value}
                        </div>
                      </div>
                    ),
                  )}
                </div>
              </section>

              <section
                style={{
                  display:
                    "grid",
                  gridTemplateColumns:
                    "1fr 1fr",
                  gap: "16px",
                  marginBottom:
                    "24px",
                }}
              >
                <div
                  style={{
                    background:
                      "#fff",
                    border:
                      "1px solid #e5e7eb",
                    borderRadius:
                      "10px",
                    padding:
                      "24px",
                  }}
                >
                  <h2>
                    Top Missing Articles
                  </h2>

                  {summary
                    .top_missing_articles
                    .length === 0 ? (
                    <p
                      style={{
                        color:
                          "#6b7280",
                      }}
                    >
                      No missing
                      articles found.
                    </p>
                  ) : (
                    <ol>
                      {summary.top_missing_articles.map(
                        (item) => (
                          <li
                            key={
                              item.id
                            }
                            style={{
                              marginBottom:
                                "10px",
                            }}
                          >
                            <strong>
                              {
                                item.topic
                              }
                            </strong>
                            {" — "}
                            {
                              item.ticket_volume
                            }{" "}
                            tickets
                          </li>
                        ),
                      )}
                    </ol>
                  )}
                </div>

                <div
                  style={{
                    background:
                      "#fff",
                    border:
                      "1px solid #e5e7eb",
                    borderRadius:
                      "10px",
                    padding:
                      "24px",
                  }}
                >
                  <h2>
                    Most Repeated Questions
                  </h2>

                  {summary
                    .most_repeated_questions
                    .length === 0 ? (
                    <p
                      style={{
                        color:
                          "#6b7280",
                      }}
                    >
                      No repeated
                      questions found.
                    </p>
                  ) : (
                    <ol>
                      {summary.most_repeated_questions.map(
                        (item) => (
                          <li
                            key={
                              item.id
                            }
                            style={{
                              marginBottom:
                                "10px",
                            }}
                          >
                            <strong>
                              {
                                item.topic
                              }
                            </strong>
                            {" — "}
                            {
                              item.ticket_volume
                            }{" "}
                            tickets ·{" "}
                            {
                              classificationLabels[
                                item
                                  .classification
                              ]
                            }
                          </li>
                        ),
                      )}
                    </ol>
                  )}
                </div>
              </section>

              <p
                style={{
                  color:
                    "#6b7280",
                  fontSize:
                    "13px",
                  marginBottom:
                    "24px",
                }}
              >
                {
                  summary.potential_deflection_label
                }
                .{" "}
                {
                  summary.methodology
                }
              </p>
            </>
          )}

          {/* Knowledge Gaps */}
          <section
            style={{
              background:
                "#fff",
              border:
                "1px solid #e5e7eb",
              borderRadius:
                "10px",
              padding:
                "24px",
              marginBottom:
                "24px",
            }}
          >
            <div
              style={{
                display:
                  "flex",
                justifyContent:
                  "space-between",
                alignItems:
                  "center",
                gap: "16px",
                flexWrap:
                  "wrap",
              }}
            >
              <div>
                <h2>
                  Knowledge Gaps
                </h2>

                <p
                  style={{
                    color:
                      "#6b7280",
                  }}
                >
                  Review knowledge gaps
                  identified from
                  analyzed tickets.
                </p>
              </div>

              <div
                style={{
                  display:
                    "flex",
                  gap: "12px",
                }}
              >
                <select
                  value={
                    classification
                  }
                  onChange={(e) =>
                    setClassification(
                      e.target.value as
                        | Classification
                        | "",
                    )
                  }
                >
                  <option value="">
                    All classifications
                  </option>

                  <option value="missing">
                    Missing
                  </option>

                  <option value="weak">
                    Weak
                  </option>

                  <option value="outdated">
                    Outdated
                  </option>

                  <option value="good_coverage">
                    Good
                  </option>
                </select>

                <select
                  value={sort}
                  onChange={(e) =>
                    setSort(
                      e.target
                        .value as SortOption,
                    )
                  }
                >
                  <option value="priority">
                    Sort by Priority
                  </option>

                  <option value="volume">
                    Sort by Volume
                  </option>

                  <option value="topic">
                    Sort by Topic
                  </option>
                </select>
              </div>
            </div>

            {gapsError ? (
  <p
    role="alert"
    style={{
      color: "#b91c1c",
    }}
  >
    Unable to load knowledge gaps.
  </p>
) : !run ? (
  <p
    style={{
      color: "#6b7280",
    }}
  >
    No analysis runs yet. Start an analysis to identify knowledge gaps.
  </p>
) : gaps.length === 0 ? (
  <p
    style={{
      color: "#6b7280",
    }}
  >
    No gaps match this view.
  </p>
) : (
              <div
                style={{
                  overflowX:
                    "auto",
                }}
              >
                <table
                  style={{
                    width:
                      "100%",
                    borderCollapse:
                      "collapse",
                    marginTop:
                      "20px",
                  }}
                >
                  <thead>
                    <tr>
                      {[
                        "Topic",
                        "Classification",
                        "Tickets",
                        "Priority",
                        "Matched Article",
                        "Action",
                      ].map(
                        (heading) => (
                          <th
                            key={
                              heading
                            }
                            style={{
                              textAlign:
                                "left",
                              padding:
                                "12px 10px",
                              borderBottom:
                                "1px solid #e5e7eb",
                            }}
                          >
                            {
                              heading
                            }
                          </th>
                        ),
                      )}
                    </tr>
                  </thead>

                  <tbody>
                    {gaps.map(
                      (gap) => (
                        <tr
                          key={
                            gap.id
                          }
                        >
                          <td
                            style={{
                              padding:
                                "12px 10px",
                            }}
                          >
                            <strong>
                              {
                                gap.topic
                              }
                            </strong>
                          </td>

                          <td
                            style={{
                              padding:
                                "12px 10px",
                            }}
                          >
                            {
                              classificationLabels[
                                gap
                                  .classification
                              ]
                            }
                          </td>

                          <td
                            style={{
                              padding:
                                "12px 10px",
                            }}
                          >
                            {
                              gap.ticket_volume
                            }
                          </td>

                          <td
                            style={{
                              padding:
                                "12px 10px",
                            }}
                          >
                            {
                              gap.priority_score ??
                              "—"
                            }
                          </td>

                          <td
                            style={{
                              padding:
                                "12px 10px",
                            }}
                          >
                            {gap.matched_article_url ? (
                              <a
                                href={
                                  gap.matched_article_url
                                }
                                target="_blank"
                                rel="noreferrer"
                              >
                                {
                                  gap.matched_article_title ??
                                  "Open article"
                                }
                              </a>
                            ) : (
                              "—"
                            )}
                          </td>

                          <td
                            style={{
                              padding:
                                "12px 10px",
                            }}
                          >
                            <button
                              onClick={() =>
                                void openGap(
                                  gap.id,
                                )
                              }
                            >
                              View Details
                            </button>
                          </td>
                        </tr>
                      ),
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}

      {/* Draft Review */}
<section
  style={{
    background: "#fff",
    border: "1px solid #e5e7eb",
    borderRadius: "10px",
    padding: "24px",
    marginBottom: "24px",
  }}
>
  <h2>Draft Review</h2>

  <p
    style={{
      color: "#6b7280",
    }}
  >
    Review and manage AI-generated knowledge article drafts.
  </p>

  {draftsLoading ? (
    <p>Loading drafts...</p>
  ) : draftsError ? (
    <p
      role="alert"
      style={{
        color: "#b91c1c",
      }}
    >
      {draftsError}
    </p>
  ) : drafts.length === 0 ? (
    <p
      style={{
        color: "#6b7280",
      }}
    >
      No draft articles yet.
    </p>
  ) : (
    <div
      style={{
        overflowX: "auto",
      }}
    >
      <table
        style={{
          width: "100%",
          borderCollapse: "collapse",
          marginTop: "20px",
        }}
      >
        <thead>
          <tr>
            {[
              "Title",
              "Topic",
              "Status",
              "Generated",
              "Action",
            ].map((heading) => (
              <th
                key={heading}
                style={{
                  textAlign: "left",
                  padding: "12px 10px",
                  borderBottom:
                    "1px solid #e5e7eb",
                }}
              >
                {heading}
              </th>
            ))}
          </tr>
        </thead>

        <tbody>
          {drafts.map((draft) => (
            <tr key={draft.id}>
              <td
                style={{
                  padding: "12px 10px",
                }}
              >
                <strong>{draft.title}</strong>
              </td>

              <td
                style={{
                  padding: "12px 10px",
                }}
              >
                {draft.topic}
              </td>

              <td
                style={{
                  padding: "12px 10px",
                }}
              >
                {draft.status}
              </td>

              <td
                style={{
                  padding: "12px 10px",
                }}
              >
                {new Date(
                  draft.generated_at,
                ).toLocaleString()}
              </td>

              <td
                style={{
                  padding: "12px 10px",
                }}
              >
                <button
                  type="button"
                  onClick={() =>
                   void openDraft(draft.id)
                  }
               >
                  Review
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )}
</section>

      {/* Gap Detail */}
      {selectedGap && (
        <div
          style={{
            position:
              "fixed",
            inset: 0,
            background:
              "rgba(0,0,0,0.35)",
            display:
              "flex",
            justifyContent:
              "flex-end",
            zIndex: 1000,
          }}
        >
          <aside
            style={{
              width:
                "min(700px, 92vw)",
              height:
                "100%",
              boxSizing: 
              "border-box",
              overflowY:
                "auto",
              background:
                "#fff",
              padding:
                "32px",
            }}
          >
            <div
              style={{
                display:
                  "flex",
                justifyContent:
                  "space-between",
                alignItems:
                  "center",
                marginBottom:
                  "24px",
              }}
            >
              <h2
                style={{
                  margin: 0,
                }}
              >
                {
                  selectedGap.topic
                }
              </h2>

              <button
                onClick={() =>
                  setSelectedGap(
                    null,
                  )
                }
              >
                Close
              </button>
            </div>

            <p
              style={{
                color:
                  "#6b7280",
              }}
            >
              {
                classificationLabels[
                  selectedGap
                    .classification
                ]
              }{" "}
              ·{" "}
              {
                selectedGap.ticket_volume
              }{" "}
              tickets · Priority{" "}
              {
                selectedGap.priority_score ??
                "—"
              }
            </p>

            <h3>
              Classification
              Justification
            </h3>

            <p>
              {
                selectedGap.justification ??
                "No justification available."
              }
            </p>

            {selectedGap.matched_article_url && (
              <>
                <h3>
                  Matched Article
                </h3>

                <a
                  href={
                    selectedGap.matched_article_url
                  }
                  target="_blank"
                  rel="noreferrer"
                >
                  {
                    selectedGap.matched_article_title ??
                    "Open article"
                  }
                </a>
              </>
            )}

            <h3
              style={{
                marginTop:
                  "28px",
              }}
            >
              Representative
              Tickets
            </h3>

            {selectedGap
              .representative_tickets
              .length === 0 ? (
              <p
                style={{
                  color:
                    "#6b7280",
                }}
              >
                No representative
                tickets available.
              </p>
            ) : (
              <ul>
                {selectedGap.representative_tickets.map(
                  (ticket) => (
                    <li
                      key={
                        ticket.id
                      }
                      style={{
                        marginBottom:
                          "12px",
                      }}
                    >
                      <a
                        href={
                          ticket.zendesk_url
                        }
                        target="_blank"
                        rel="noreferrer"
                      >
                        #
                        {
                          ticket.zendesk_ticket_id
                        }{" "}
                        —{" "}
                        {
                          ticket.subject ??
                          "Untitled ticket"
                        }
                      </a>

                      {ticket.description && (
                        <p
                          style={{
                            color:
                              "#6b7280",
                          }}
                        >
                          {
                            ticket.description
                          }
                        </p>
                      )}
                    </li>
                  ),
                )}
              </ul>
            )}

            <h3>
              Recommendations
            </h3>

            {selectedGap
              .recommendations
              .length === 0 ? (
              <p
                style={{
                  color:
                    "#6b7280",
                }}
              >
                No recommendations
                available.
              </p>
            ) : (
              <div>
                {selectedGap.recommendations.map(
                  (recommendation) => (
                    <article
                      key={
                        recommendation.id
                      }
                      style={{
                        border:
                          "1px solid #e5e7eb",
                        borderRadius:
                          "8px",
                        padding:
                          "16px",
                        marginBottom:
                          "12px",
                      }}
                    >
                      <strong>
                        {formatRecommendationType(
                          recommendation.recommendation_type,
                        )}
                      </strong>

                      <p
                        style={{
                          color:
                            "#4b5563",
                        }}
                      >
                        {
                          recommendation.rationale
                        }
                      </p>

                      {recommendation.suggested_title && (
                        <p
                          style={{
                            color:
                              "#4b5563",
                          }}
                        >
                          <strong>
                            Suggested title:
                          </strong>{" "}
                          {
                            recommendation.suggested_title
                          }
                        </p>
                      )}

                      {recommendation
                        .suggested_keywords
                        ?.length ? (
                        <p
                          style={{
                            fontSize:
                              "13px",
                            color:
                              "#6b7280",
                          }}
                        >
                          <strong>
                            Keywords:
                          </strong>{" "}
                          {recommendation.suggested_keywords.join(
                            ", ",
                          )}
                        </p>
                      ) : null}
                    </article>
                  ),
                )}
              </div>
            )}

            {selectedGap
              .classification !==
              "good_coverage" && (
              <div
                style={{
                  marginTop:
                    "24px",
                  paddingTop:
                    "20px",
                  borderTop:
                    "1px solid #e5e7eb",
                }}
              >
                <button
                  onClick={() =>
                    void generateDraft()
                  }
                  disabled={
                    generatingDraft
                  }
                >
                  {generatingDraft
                    ? "Generating draft..."
                    : "Generate Draft"}
                </button>

                {draftMessage && (
                  <p
                    style={{
                      color:
                        "#047857",
                    }}
                  >
                    {draftMessage}
                  </p>
                )}
              </div>
            )}
          </aside>
        </div>
      )}
      {/* Draft Detail */}
{selectedDraft && (
  <div
    style={{
      position: "fixed",
      inset: 0,
      background: "rgba(0,0,0,0.35)",
      display: "flex",
      justifyContent: "flex-end",
      zIndex: 1100,
    }}
  >
    <aside
      style={{
        width: "min(760px, 94vw)",
        height: "100%",
        boxSizing: "border-box",
        overflowY: "auto",
        background: "#fff",
        padding: "32px",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: "16px",
          marginBottom: "24px",
        }}
      >
        <div>
          <h2 style={{ margin: 0 }}>
            Draft Review
          </h2>

          <p
            style={{
              color: "#6b7280",
              marginBottom: 0,
            }}
          >
            Status: {selectedDraft.status}
          </p>
        </div>

        <button
          type="button"
          onClick={() => {
            if (draftFormDirty) {
              setPendingClose(true);
              return;
            }

            setSelectedDraft(null);
          }}
        >
          Close
        </button>
        {pendingClose && (
  <div
    style={{
      position: "absolute",
      top: "80px",
      right: "32px",
      padding: "12px",
      border: "1px solid #f59e0b",
      borderRadius: "8px",
      background: "#fffbeb",
      zIndex: 1200,
    }}
  >
    <strong>Unsaved changes</strong>

    <p style={{ margin: "8px 0" }}>
      You have unsaved changes. Discard them and close the draft?
    </p>

    <div style={{ display: "flex", gap: "8px" }}>
      <button
        type="button"
        onClick={() => {
          setPendingClose(false);
          setSelectedDraft(null);
        }}
      >
        Discard & Close
      </button>

      <button
        type="button"
        onClick={() => {
          setPendingClose(false);
        }}
      >
        Keep Editing
      </button>
    </div>
  </div>
)}
      </div>
      
      <div
  style={{
    marginBottom: "28px",
    padding: "16px",
    border: "1px solid #e5e7eb",
    borderRadius: "8px",
  }}
>
 <h3>AI Generated Draft</h3>
      <h4>Title</h4>
      <p>
        {
          selectedDraft.ai_original
            .suggested_title
        }
      </p>

      <h4>Problem Summary</h4>
      <p>
        {
          selectedDraft.ai_original
            .problem_summary
        }
      </p>

      <h4>Resolution</h4>
      <p
        style={{
          whiteSpace: "pre-wrap",
        }}
      >
        {
          selectedDraft.ai_original
            .step_by_step_resolution
        }
      </p>

      <h4>FAQ</h4>

      {selectedDraft.ai_original.faq.length ===
      0 ? (
        <p
          style={{
            color: "#6b7280",
          }}
        >
          No FAQ entries.
        </p>
      ) : (
        <ul>
          {selectedDraft.ai_original.faq.map(
            (item, index) => (
              <li key={index}>
                <strong>
                  {item.question}
                </strong>
                <p>{item.answer}</p>
              </li>
            ),
          )}
        </ul>
      )}

      <h4>Related Keywords</h4>
      <p>
        {selectedDraft.ai_original
          .related_keywords.length > 0
          ? selectedDraft.ai_original.related_keywords.join(
              ", ",
            )
          : "No related keywords."}
      </p>

      <h4>Internal Reviewer Notes</h4>
      <p
        style={{
          whiteSpace: "pre-wrap",
        }}
      >
        {selectedDraft.ai_original
          .internal_reviewer_notes ||
          "No reviewer notes."}
      </p>

      </div>
      {draftForm && (
  <>
    <hr
      style={{
        margin: "32px 0",
        border: 0,
        borderTop: "1px solid #e5e7eb",
      }}
    />
    
    <div
  style={{
    marginBottom: "28px",
  }}
>
  <h3>AI vs Reviewer Comparison</h3>

  <div
    style={{
      display: "grid",
      gridTemplateColumns:
        "repeat(2, minmax(0, 1fr))",
      gap: "16px",
    }}
  >
    {/* AI Original */}
    <div
      style={{
        border: "1px solid #e5e7eb",
        borderRadius: "8px",
        padding: "16px",
      }}
    >
      <h4>AI Original</h4>

      <strong>Title</strong>
      <p>
        {
          selectedDraft.ai_original
            .suggested_title
        }
      </p>

      <strong>Problem Summary</strong>
      <p>
        {
          selectedDraft.ai_original
            .problem_summary
        }
      </p>

      <strong>Resolution</strong>
      <p style={{ whiteSpace: "pre-wrap" }}>
        {
          selectedDraft.ai_original
            .step_by_step_resolution
        }
      </p>

      <strong>FAQ</strong>

      {selectedDraft.ai_original.faq.length === 0 ? (
        <p>No FAQ entries.</p>
      ) : (
        selectedDraft.ai_original.faq.map(
          (item, index) => (
            <div key={index}>
              <p>
                <strong>{item.question}</strong>
              </p>
              <p>{item.answer}</p>
            </div>
          ),
        )
      )}

      <strong>Related Keywords</strong>
      <p>
        {selectedDraft.ai_original.related_keywords
          .join(", ") || "No keywords."}
      </p>

      <strong>Internal Reviewer Notes</strong>
      <p style={{ whiteSpace: "pre-wrap" }}>
        {selectedDraft.ai_original
          .internal_reviewer_notes ||
          "No reviewer notes."}
      </p>
    </div>

    {/* Reviewer Edited */}
    <div
      style={{
        border: "1px solid #e5e7eb",
        borderRadius: "8px",
        padding: "16px",
      }}
    >
      <h4>Reviewer Edited</h4>

      <strong>Title</strong>
      <p>{draftForm.suggested_title}</p>

      <strong>Problem Summary</strong>
      <p>{draftForm.problem_summary}</p>

      <strong>Resolution</strong>
      <p style={{ whiteSpace: "pre-wrap" }}>
        {draftForm.step_by_step_resolution}
      </p>

      <strong>FAQ</strong>

      {draftForm.faq.length === 0 ? (
        <p>No FAQ entries.</p>
      ) : (
        draftForm.faq.map((item, index) => (
          <div key={index}>
            <p>
              <strong>{item.question}</strong>
            </p>
            <p>{item.answer}</p>
          </div>
        ))
      )}

      <strong>Related Keywords</strong>
      <p>
        {draftForm.related_keywords.join(", ") ||
          "No keywords."}
      </p>

      <strong>Internal Reviewer Notes</strong>
      <p style={{ whiteSpace: "pre-wrap" }}>
        {draftForm.internal_reviewer_notes ||
          "No reviewer notes."}
      </p>
    </div>
  </div>
</div>
    <h3>Reviewer Revision</h3>

    <p style={{ color: "#6b7280" }}>
      Edit the AI draft below. The original AI content
      remains unchanged.
    </p>

    <label>
      <strong>Title</strong>
    </label>

    <input
      type="text"
      value={draftForm.suggested_title}
      onChange={(event) => {
       setDraftForm({
        ...draftForm,
        suggested_title: event.target.value,
        });
        setDraftFormDirty(true);
    }}
      style={{
        width: "100%",
        boxSizing: "border-box",
        marginTop: "8px",
        marginBottom: "20px",
        padding: "10px",
      }}
    />

    <label>
      <strong>Problem Summary</strong>
    </label>

    <textarea
      value={draftForm.problem_summary}
      onChange={(event) => {
        setDraftForm({
         ...draftForm,
         problem_summary: event.target.value,
      });
      setDraftFormDirty(true);
    }}
      rows={5}
      style={{
        width: "100%",
        boxSizing: "border-box",
        marginTop: "8px",
        marginBottom: "20px",
        padding: "10px",
      }}
    />

    <label>
      <strong>Resolution Steps</strong>
    </label>

    <textarea
      value={draftForm.step_by_step_resolution}
      onChange={(event) => {
        setDraftForm({
         ...draftForm,
         step_by_step_resolution:
           event.target.value,
        });
        setDraftFormDirty(true);
     }}
      rows={10}
      style={{
        width: "100%",
        boxSizing: "border-box",
        marginTop: "8px",
        marginBottom: "20px",
        padding: "10px",
      }}
    />

    <div style={{ marginBottom: "20px" }}>
      <strong>FAQ</strong>

      {draftForm.faq.length === 0 && (
        <p style={{ color: "#6b7280" }}>
          No FAQ entries.
        </p>
      )}
      <button
  type="button"
  onClick={() => {
  setDraftForm({
    ...draftForm,
    faq: [
      ...draftForm.faq,
      {
        question: "",
        answer: "",
      },
    ],
  });
  setDraftFormDirty(true);
}}
  style={{
    marginTop: "8px",
  }}
>
  Add FAQ
</button>

      {draftForm.faq.map((item, index) => (
        <div
          key={index}
          style={{
            border: "1px solid #e5e7eb",
            borderRadius: "8px",
            padding: "12px",
            marginTop: "10px",
          }}
        >
          <input
            type="text"
            value={item.question}
            placeholder="Question"
            onChange={(event) => {
              const faq = [...draftForm.faq];

              faq[index] = {
                ...faq[index],
                question: event.target.value,
              };

              setDraftForm({
                ...draftForm,
                faq,
              });
              setDraftFormDirty(true);
            }}
            style={{
              width: "100%",
              boxSizing: "border-box",
              marginBottom: "8px",
              padding: "10px",
            }}
          />

          <textarea
            value={item.answer}
            placeholder="Answer"
            rows={3}
            onChange={(event) => {
              const faq = [...draftForm.faq];

              faq[index] = {
                ...faq[index],
                answer: event.target.value,
              };

              setDraftForm({
                ...draftForm,
                faq,
              });
              setDraftFormDirty(true);
            }}
            style={{
              width: "100%",
              boxSizing: "border-box",
              padding: "10px",
            }}
          />
          <button
  type="button"
  onClick={() => {
    const faq = draftForm.faq.filter(
      (_, faqIndex) => faqIndex !== index,
    );

    setDraftForm({
      ...draftForm,
      faq,
    });
    setDraftFormDirty(true);
  }}
  style={{
    marginTop: "8px",
  }}
>
  Remove FAQ
</button>
        </div>
      ))}
    </div>

    <label>
      <strong>Related Keywords</strong>
    </label>

    <input
      type="text"
      value={draftForm.related_keywords.join(", ")}
      onChange={(event) => {
        setDraftForm({
         ...draftForm,
         related_keywords: event.target.value
           .split(",")
           .map((keyword) => keyword.trim()),
      });
      setDraftFormDirty(true);
    }}
      placeholder="password reset, login, account access"
      style={{
        width: "100%",
        boxSizing: "border-box",
        marginTop: "8px",
        marginBottom: "20px",
        padding: "10px",
      }}
    />

    <label>
      <strong>Internal Reviewer Notes</strong>
    </label>

    <textarea
      value={draftForm.internal_reviewer_notes}
      onChange={(event) => {
        setDraftForm({
         ...draftForm,
         internal_reviewer_notes:
           event.target.value,
        });
        setDraftFormDirty(true);
      }}
      rows={4}
      style={{
        width: "100%",
        boxSizing: "border-box",
        marginTop: "8px",
        marginBottom: "20px",
        padding: "10px",
      }}
    />

    <button
      type="button"
      onClick={() => void saveDraftEdits()}
      disabled={savingDraft}
    >
      {savingDraft
        ? "Saving..."
        : "Save Changes"}
    </button>

    {draftActionMessage && (
      <p
        style={{
          marginTop: "12px",
          color: "#4b5563",
        }}
      >
        {draftActionMessage}
      </p>
    )}
    <div
  style={{
    marginTop: "28px",
    paddingTop: "20px",
    borderTop: "1px solid #e5e7eb",
  }}
>
  <div
  style={{
    marginBottom: "20px",
  }}
>
  <button
    type="button"
    onClick={() => {
      if (draftFormDirty) {
        setPendingRegenerate(true);
        return;
     }

  void regenerateDraft();
}}
    disabled={regeneratingDraft}
  >
    {regeneratingDraft
      ? "Regenerating..."
      : "Regenerate Draft"}
  </button>
  {pendingRegenerate && (
  <div
    style={{
      marginTop: "12px",
      padding: "12px",
      border: "1px solid #f59e0b",
      borderRadius: "8px",
      background: "#fffbeb",
    }}
  >
    <strong>Unsaved changes</strong>

    <p style={{ margin: "8px 0" }}>
      You have unsaved changes. Discard them and regenerate the draft?
    </p>

    <div style={{ display: "flex", gap: "8px" }}>
      <button
        type="button"
        onClick={() => {
          setPendingRegenerate(false);
          void regenerateDraft();
        }}
      >
        Discard & Regenerate
      </button>

      <button
        type="button"
        onClick={() => {
          setPendingRegenerate(false);
        }}
      >
        Keep Editing
      </button>
    </div>
  </div>
)}
  <p
    style={{
      color: "#6b7280",
      fontSize: "13px",
      marginBottom: 0,
    }}
  >
   Regeneration updates the existing draft.
  </p>
</div>

  <div
  style={{
    marginBottom: "24px",
    paddingTop: "20px",
    borderTop: "1px solid #e5e7eb",
  }}
>
  <h3>Export Draft</h3>

  <p
    style={{
      color: "#6b7280",
      fontSize: "13px",
    }}
  >
    Copy the reviewed draft for manual paste into
    Zendesk Guide. This does not publish the article.
  </p>

  <div
    style={{
      display: "flex",
      gap: "12px",
      flexWrap: "wrap",
    }}
  >
    <button
      type="button"
      onClick={() =>
        void copyDraftExport("markdown")
      }
    >
      Copy Markdown
    </button>

    <button
      type="button"
      onClick={() =>
        void copyDraftExport("html")
      }
    >
      Copy HTML
    </button>
  </div>
</div>
  <h3>Review Status</h3>

  <p
    style={{
      color: "#6b7280",
    }}
  >
    Current status:{" "}
    <strong>
      {selectedDraft.status}
    </strong>
  </p>
  {/* 👇 Unsaved changes warning for status actions */}
{pendingStatusChange !== null && (
  <div
    style={{
      marginBottom: "16px",
      padding: "12px",
      border: "1px solid #f59e0b",
      borderRadius: "8px",
      background: "#fffbeb",
    }}
  >
    <strong>Unsaved changes</strong>

    <p style={{ margin: "8px 0" }}>
      You have unsaved changes. Discard them and change the review status?
    </p>

    <div style={{ display: "flex", gap: "8px" }}>
      <button
        type="button"
        onClick={() => {
          const pending = pendingStatusChange;
          setPendingStatusChange(null);

          void changeDraftStatus(
            pending.status,
            pending.rejectionReason,
          );
        }}
      >
        Discard & Continue
      </button>

      <button
        type="button"
        onClick={() => {
          setPendingStatusChange(null);
        }}
      >
        Keep Editing
      </button>
    </div>
  </div>
)}
  {selectedDraft.status === "draft" && (
    <button
      type="button"
      disabled={updatingDraftStatus}
      onClick={() => {
        if (draftFormDirty) {
          setPendingStatusChange({
            status: "in_review",
        });
        return;
      }

      void changeDraftStatus("in_review");
    }}
    >
      {updatingDraftStatus
        ? "Updating..."
        : "Send to Review"}
    </button>
  )}

  {selectedDraft.status ===
    "in_review" && (
    <>
      <div
        style={{
          display: "flex",
          gap: "12px",
          flexWrap: "wrap",
          marginBottom: "20px",
        }}
      >
        <button
          type="button"
          disabled={updatingDraftStatus}
          onClick={() => {
            if (draftFormDirty) {
              setPendingStatusChange({
                status: "approved",
             });
             return;
           }

          void changeDraftStatus("approved");
        }}
        >
          Approve
        </button>
      </div>

      <label>
        <strong>
          Rejection Reason
        </strong>
      </label>

      <textarea
        value={rejectionReason}
        onChange={(event) =>
          setRejectionReason(
            event.target.value,
          )
        }
        rows={3}
        placeholder="Explain why this draft is being rejected."
        style={{
          width: "100%",
          boxSizing: "border-box",
          padding: "10px",
          marginTop: "8px",
          marginBottom: "12px",
        }}
      />

      <button
        type="button"
        disabled={
          updatingDraftStatus ||
          !rejectionReason.trim()
        }
        onClick={() => {
          if (draftFormDirty) {
            setPendingStatusChange({
              status: "rejected",
              rejectionReason,
          });
          return;
        }

        void changeDraftStatus(
          "rejected",
          rejectionReason,
        );
      }}
      >
        {updatingDraftStatus
          ? "Updating..."
          : "Reject"}
      </button>
    </>
  )}

  {selectedDraft.status ===
    "rejected" && (
    <>
      {selectedDraft.rejection_reason && (
        <p>
          <strong>
            Rejection reason:
          </strong>{" "}
          {
            selectedDraft.rejection_reason
          }
        </p>
      )}

      <button
        type="button"
        disabled={updatingDraftStatus}
        onClick={() => {
          if (draftFormDirty) {
            setPendingStatusChange({
              status: "draft",
         });
         return;
       }

       void changeDraftStatus("draft");
     }}
      >
        Return to Draft
      </button>
    </>
  )}

  {selectedDraft.status ===
    "approved" && (
    <p
      style={{
        color: "#047857",
      }}
    >
      This draft has been approved.
    </p>
  )}
</div>
  </>
)}
    </aside>
  </div>
)}
    </main>
  );
}