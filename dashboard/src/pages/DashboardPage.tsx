import { useCallback, useEffect, useState } from "react";

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
    </main>
  );
}