import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import {
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import DashboardPage from "../pages/DashboardPage";

const mockFetch = vi.fn();

function jsonResponse(
  body: unknown,
  status = 200,
): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

function dashboardSessionResponse() {
  return jsonResponse({
    authenticated: true,
    zendesk_account_id: 1,
    subdomain: "d3v-astonous-28503",
    zendesk_url:
      "https://d3v-astonous-28503.zendesk.com",
  });
}

function installDefaultFetchMock() {
  mockFetch.mockImplementation(
    (
      input: RequestInfo | URL,
      init?: RequestInit,
    ) => {
      const url = String(input);

      if (
        url ===
        "/api/dashboard/session"
      ) {
        return Promise.resolve(
          dashboardSessionResponse(),
        );
      }

      if (
        url ===
        "/api/dashboard/summary"
      ) {
        return Promise.resolve(
          jsonResponse({
            summary: {
              top_missing_articles: [],
              most_repeated_questions: [],
              estimated_ticket_volume: 0,
              articles_needing_updates: 0,
              potential_deflection_estimate: 0,
              potential_deflection_label:
                "Potential deflection estimate",
              methodology:
                "Volume-based MVP estimate",
            },
          }),
        );
      }

      if (
        url.startsWith(
          "/api/dashboard/gaps?",
        )
      ) {
        return Promise.resolve(
          jsonResponse({
            gaps: [],
          }),
        );
      }

      if (
        url ===
        "/api/analysis-runs/latest"
      ) {
        return Promise.resolve(
          jsonResponse({
            run: null,
          }),
        );
      }

      if (
        url === "/api/analysis-runs" &&
        init?.method === "POST"
      ) {
        return Promise.resolve(
          jsonResponse({
            run: {
              id: 55,
              window_days: 30,
              status: "queued",
              current_stage: null,
              error_stage: null,
              error_message: null,
            },
          }),
        );
      }

      return Promise.resolve(
        jsonResponse({}),
      );
    },
  );
}

describe("DashboardPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    vi.stubGlobal(
      "fetch",
      mockFetch,
    );

    installDefaultFetchMock();
  });

  it(
    "loads and renders the dashboard shell and no-runs-yet state",
    async () => {
      render(<DashboardPage />);

      expect(
        screen.getByText(
          "HelpCenterIQ",
        ),
      ).toBeInTheDocument();

      expect(
        screen.getByText(
          "Run Analysis",
        ),
      ).toBeInTheDocument();

      expect(
        await screen.findByText(
          "Dashboard Overview",
        ),
      ).toBeInTheDocument();

      expect(
        screen.getByText(
          "No analysis runs yet. Start an analysis to identify knowledge gaps.",
        ),
      ).toBeInTheDocument();

      expect(
        mockFetch,
      ).toHaveBeenCalledWith(
        "/api/dashboard/session",
        {
          credentials: "include",
        },
      );

      expect(
        mockFetch,
      ).toHaveBeenCalledWith(
        "/api/dashboard/summary",
        {
          credentials: "include",
        },
      );

      expect(
        mockFetch,
      ).toHaveBeenCalledWith(
        "/api/dashboard/gaps?sort=priority",
        {
          credentials: "include",
        },
      );

      expect(
        mockFetch,
      ).toHaveBeenCalledWith(
        "/api/analysis-runs/latest",
        {
          credentials: "include",
        },
      );
    },
  );

  it(
    "shows the authenticated Zendesk organization in the dashboard header",
    async () => {
      render(<DashboardPage />);

      expect(
        await screen.findByText(
          "✓ Connected Zendesk",
        ),
      ).toBeInTheDocument();

      const zendeskLink =
        screen.getByRole("link", {
          name:
            "d3v-astonous-28503.zendesk.com",
        });

      expect(
        zendeskLink,
      ).toBeInTheDocument();

      expect(
        zendeskLink,
      ).toHaveAttribute(
        "href",
        "https://d3v-astonous-28503.zendesk.com",
      );

      expect(
        screen.getByLabelText(
          "Connected Zendesk account",
        ),
      ).toBeInTheDocument();

      expect(
        mockFetch,
      ).toHaveBeenCalledWith(
        "/api/dashboard/session",
        {
          credentials: "include",
        },
      );
    },
  );

  it(
    "renders summary values returned by the dashboard API",
    async () => {
      mockFetch.mockImplementation(
        (
          input: RequestInfo | URL,
        ) => {
          const url =
            String(input);

          if (
            url ===
            "/api/dashboard/session"
          ) {
            return Promise.resolve(
              dashboardSessionResponse(),
            );
          }

          if (
            url ===
            "/api/dashboard/summary"
          ) {
            return Promise.resolve(
              jsonResponse({
                summary: {
                  top_missing_articles: [
                    {
                      id: 1,
                      topic:
                        "Laptop Hardware",
                      ticket_volume: 8,
                      priority_score:
                        "high",
                    },
                  ],

                  most_repeated_questions:
                    [
                      {
                        id: 2,
                        topic:
                          "Password Reset",
                        ticket_volume: 5,
                        classification:
                          "weak",
                      },
                    ],

                  estimated_ticket_volume:
                    13,

                  articles_needing_updates:
                    2,

                  potential_deflection_estimate:
                    8,

                  potential_deflection_label:
                    "Potential deflection estimate",

                  methodology:
                    "Volume-based MVP estimate",
                },
              }),
            );
          }

          if (
            url.startsWith(
              "/api/dashboard/gaps?",
            )
          ) {
            return Promise.resolve(
              jsonResponse({
                gaps: [],
              }),
            );
          }

          if (
            url ===
            "/api/analysis-runs/latest"
          ) {
            return Promise.resolve(
              jsonResponse({
                run: null,
              }),
            );
          }

          return Promise.resolve(
            jsonResponse({}),
          );
        },
      );

      render(<DashboardPage />);

      expect(
        await screen.findByText(
          "Laptop Hardware",
        ),
      ).toBeInTheDocument();

      expect(
        screen.getByText(
          "Password Reset",
        ),
      ).toBeInTheDocument();

      expect(
        screen.getByText("13"),
      ).toBeInTheDocument();

      expect(
        screen.getByText("2"),
      ).toBeInTheDocument();

      expect(
        screen.getByText("8"),
      ).toBeInTheDocument();
    },
  );

  it(
    "starts a 30-day analysis run and displays its queued status",
    async () => {
      render(<DashboardPage />);

      await screen.findByText(
        "Dashboard Overview",
      );

      fireEvent.click(
        screen.getByRole(
          "button",
          {
            name:
              "Start Analysis",
          },
        ),
      );

      await waitFor(() => {
        expect(
          mockFetch,
        ).toHaveBeenCalledWith(
          "/api/analysis-runs",
          expect.objectContaining({
            method: "POST",
            credentials:
              "include",
            body: JSON.stringify({
              windowDays: 30,
            }),
          }),
        );
      });

      expect(
        await screen.findByText(
          "Analysis Status",
        ),
      ).toBeInTheDocument();

      expect(
        screen.getByText(
          "Analysis is queued and will start shortly.",
        ),
      ).toBeInTheDocument();

      expect(
        screen.getByRole(
          "button",
          {
            name:
              "Run in progress",
          },
        ),
      ).toBeDisabled();
    },
  );

  it(
    "uses the selected 90-day lookback window when starting analysis",
    async () => {
      render(<DashboardPage />);

      await screen.findByText(
        "Dashboard Overview",
      );

      fireEvent.click(
        screen.getByRole(
          "button",
          {
            name: "90 days",
          },
        ),
      );

      fireEvent.click(
        screen.getByRole(
          "button",
          {
            name:
              "Start Analysis",
          },
        ),
      );

      await waitFor(() => {
        expect(
          mockFetch,
        ).toHaveBeenCalledWith(
          "/api/analysis-runs",
          expect.objectContaining({
            method: "POST",
            credentials:
              "include",
            body: JSON.stringify({
              windowDays: 90,
            }),
          }),
        );
      });
    },
  );

  it(
    "restores and displays a failed analysis run after page reload",
    async () => {
      mockFetch.mockImplementation(
        (input: RequestInfo | URL) => {
          const url = String(input);

          if (url === "/api/dashboard/session") {
            return Promise.resolve(dashboardSessionResponse());
          }

          if (url === "/api/dashboard/summary") {
            return Promise.resolve(
              jsonResponse({
                summary: {
                  top_missing_articles: [],
                  most_repeated_questions: [],
                  estimated_ticket_volume: 0,
                  articles_needing_updates: 0,
                  potential_deflection_estimate: 0,
                  potential_deflection_label: "Potential deflection estimate",
                  methodology: "Volume-based MVP estimate",
                },
              }),
            );
          }

          if (url.startsWith("/api/dashboard/gaps?")) {
            return Promise.resolve(jsonResponse({ gaps: [] }));
          }

          if (url === "/api/analysis-runs/latest") {
            return Promise.resolve(
              jsonResponse({
                run: {
                  id: 91,
                  window_days: 30,
                  status: "failed",
                  current_stage: "classification",
                  error_stage: "classification",
                  error_message: "Classification failed",
                },
              }),
            );
          }

          return Promise.resolve(jsonResponse({}));
        },
      );

      render(<DashboardPage />);

      expect(await screen.findByText("Analysis Status")).toBeInTheDocument();
      expect(screen.getByText("Failed stage:")).toBeInTheDocument();
      expect(screen.getByText("Classification failed")).toBeInTheDocument();
      expect(screen.getByText("classification")).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "Start Analysis" }),
      ).toBeEnabled();
    },
  );

  it(
    "polls an active run until completion and refreshes dashboard data",
    async () => {
      vi.useFakeTimers();

      try {
        let summaryCalls = 0;
        let gapCalls = 0;

        mockFetch.mockImplementation((input: RequestInfo | URL) => {
          const url = String(input);

          if (url === "/api/dashboard/session") {
            return Promise.resolve(dashboardSessionResponse());
          }

          if (url === "/api/dashboard/summary") {
            summaryCalls += 1;
            return Promise.resolve(
              jsonResponse({
                summary: {
                  top_missing_articles: [],
                  most_repeated_questions: [],
                  estimated_ticket_volume: 0,
                  articles_needing_updates: 0,
                  potential_deflection_estimate: 0,
                  potential_deflection_label: "Potential deflection estimate",
                  methodology: "Volume-based MVP estimate",
                },
              }),
            );
          }

          if (url.startsWith("/api/dashboard/gaps?")) {
            gapCalls += 1;
            return Promise.resolve(jsonResponse({ gaps: [] }));
          }

          if (url === "/api/analysis-runs/latest") {
            return Promise.resolve(
              jsonResponse({
                run: {
                  id: 77,
                  window_days: 30,
                  status: "running",
                  current_stage: "classification",
                  error_stage: null,
                  error_message: null,
                },
              }),
            );
          }

          if (url === "/api/analysis-runs/77") {
            return Promise.resolve(
              jsonResponse({
                run: {
                  id: 77,
                  window_days: 30,
                  status: "completed",
                  current_stage: null,
                  error_stage: null,
                  error_message: null,
                },
              }),
            );
          }

          return Promise.resolve(jsonResponse({}));
        });

        render(<DashboardPage />);

        await act(async () => {
          await Promise.resolve();
          await Promise.resolve();
        });

        expect(
          screen.getByText("Analysis is currently running..."),
        ).toBeInTheDocument();
        expect(summaryCalls).toBe(1);
        expect(gapCalls).toBe(1);

        await act(async () => {
          await vi.advanceTimersByTimeAsync(3000);
        });

        expect(
          screen.getByText("Analysis completed successfully."),
        ).toBeInTheDocument();
        expect(mockFetch).toHaveBeenCalledWith("/api/analysis-runs/77", {
          credentials: "include",
          signal: expect.any(AbortSignal),
        });
        expect(summaryCalls).toBe(2);
        expect(gapCalls).toBe(2);
      } finally {
        vi.useRealTimers();
      }
    },
  );

  it(
    "opens gap details and generates a draft article",
    async () => {
      mockFetch.mockImplementation(
        (input: RequestInfo | URL, init?: RequestInit) => {
          const url = String(input);

          if (url === "/api/dashboard/session") {
            return Promise.resolve(dashboardSessionResponse());
          }

          if (url === "/api/dashboard/summary") {
            return Promise.resolve(
              jsonResponse({
                summary: {
                  top_missing_articles: [],
                  most_repeated_questions: [],
                  estimated_ticket_volume: 5,
                  articles_needing_updates: 1,
                  potential_deflection_estimate: 5,
                  potential_deflection_label: "Potential deflection estimate",
                  methodology: "Volume-based MVP estimate",
                },
              }),
            );
          }

          if (url === "/api/dashboard/gaps?sort=priority") {
            return Promise.resolve(
              jsonResponse({
                gaps: [
                  {
                    id: 12,
                    analysis_run_id: 5,
                    cluster_id: 3,
                    topic: "Password Reset",
                    classification: "weak",
                    ticket_volume: 5,
                    priority_score: 8,
                    justification:
                      "The existing article is missing important resolution steps.",
                    matched_article_id: 44,
                    matched_article_title: "How to reset your password",
                    matched_article_locale: "en-us",
                    matched_article_url:
                      "https://d3v-astonous-28503.zendesk.com/hc/en-us/articles/44",
                    representative_tickets: [],
                    recommendations: [],
                  },
                ],
              }),
            );
          }

          if (url === "/api/analysis-runs/latest") {
            return Promise.resolve(
              jsonResponse({
                run: {
                  id: 5,
                  window_days: 30,
                  status: "completed",
                  current_stage: null,
                  error_stage: null,
                  error_message: null,
                },
              }),
            );
          }

          if (url === "/api/dashboard/gaps/12" && !init?.method) {
            return Promise.resolve(
              jsonResponse({
                id: 12,
                analysis_run_id: 5,
                cluster_id: 3,
                topic: "Password Reset",
                classification: "weak",
                ticket_volume: 5,
                priority_score: 8,
                justification:
                  "The existing article is missing important resolution steps.",
                matched_article_id: 44,
                matched_article_title: "How to reset your password",
                matched_article_locale: "en-us",
                matched_article_url:
                  "https://d3v-astonous-28503.zendesk.com/hc/en-us/articles/44",
                representative_tickets: [
                  {
                    id: 1,
                    zendesk_ticket_id: "101",
                    subject: "Cannot reset password",
                    description: "Customer cannot complete password reset.",
                    status: "solved",
                    zendesk_url:
                      "https://d3v-astonous-28503.zendesk.com/agent/tickets/101",
                  },
                ],
                recommendations: [
                  {
                    id: 9,
                    recommendation_type: "add_missing_steps",
                    rationale:
                      "Add the missing password reset verification steps.",
                    suggested_keywords: ["password", "reset"],
                    suggested_title: null,
                  },
                ],
              }),
            );
          }

          if (
            url === "/api/dashboard/gaps/12/drafts" &&
            init?.method === "POST"
          ) {
            return Promise.resolve(jsonResponse({ id: 88 }));
          }

          return Promise.resolve(jsonResponse({}));
        },
      );

      render(<DashboardPage />);

      expect(await screen.findByText("Password Reset")).toBeInTheDocument();

      fireEvent.click(screen.getByRole("button", { name: "View Details" }));

      expect(
        await screen.findByText("Classification Justification"),
      ).toBeInTheDocument();
      expect(
        screen.getByText("Cannot reset password", { exact: false }),
      ).toBeInTheDocument();
      expect(screen.getByText("Add Missing Steps")).toBeInTheDocument();
      expect(mockFetch).toHaveBeenCalledWith("/api/dashboard/gaps/12", {
        credentials: "include",
      });

      fireEvent.click(screen.getByRole("button", { name: "Generate Draft" }));

      expect(
        await screen.findByText(
          "Draft article generated successfully. Draft ID: 88",
        ),
      ).toBeInTheDocument();
      expect(mockFetch).toHaveBeenCalledWith(
        "/api/dashboard/gaps/12/drafts",
        expect.objectContaining({
          method: "POST",
          credentials: "include",
        }),
      );
    },
  );

  it(
    "handles a 409 by displaying the already-active analysis run",
    async () => {
      let latestRunCalls = 0;

      mockFetch.mockImplementation(
        (input: RequestInfo | URL, init?: RequestInit) => {
          const url = String(input);

          if (url === "/api/dashboard/session") {
            return Promise.resolve(dashboardSessionResponse());
          }

          if (url === "/api/dashboard/summary") {
            return Promise.resolve(
              jsonResponse({
                summary: {
                  top_missing_articles: [],
                  most_repeated_questions: [],
                  estimated_ticket_volume: 0,
                  articles_needing_updates: 0,
                  potential_deflection_estimate: 0,
                  potential_deflection_label: "Potential deflection estimate",
                  methodology: "Volume-based MVP estimate",
                },
              }),
            );
          }

          if (url.startsWith("/api/dashboard/gaps?")) {
            return Promise.resolve(jsonResponse({ gaps: [] }));
          }

          if (url === "/api/analysis-runs/latest") {
            latestRunCalls += 1;

            if (latestRunCalls === 1) {
              return Promise.resolve(jsonResponse({ run: null }));
            }

            return Promise.resolve(
              jsonResponse({
                run: {
                  id: 73,
                  window_days: 60,
                  status: "running",
                  current_stage: "clustering",
                  error_stage: null,
                  error_message: null,
                },
              }),
            );
          }

          if (url === "/api/analysis-runs" && init?.method === "POST") {
            return Promise.resolve(
              jsonResponse(
                {
                  error:
                    "An analysis run is already active for this account.",
                },
                409,
              ),
            );
          }

          return Promise.resolve(jsonResponse({}));
        },
      );

      render(<DashboardPage />);
      await screen.findByText("Dashboard Overview");

      fireEvent.click(screen.getByRole("button", { name: "Start Analysis" }));

      expect(
        await screen.findByText(
          "An analysis run is already active for this account.",
        ),
      ).toBeInTheDocument();
      expect(await screen.findByText("Analysis Status")).toBeInTheDocument();
      expect(
        screen.getByText("Analysis is currently running..."),
      ).toBeInTheDocument();
      expect(screen.getByText("Clustering")).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "Run in progress" }),
      ).toBeDisabled();
      expect(latestRunCalls).toBe(2);
    },
  );
  it(
  "shows the filter-empty state when a run exists but no gaps match",
  async () => {
    mockFetch.mockImplementation(
      (
        input: RequestInfo | URL,
      ) => {
        const url = String(input);

        if (url === "/api/dashboard/session") {
          return Promise.resolve(
            dashboardSessionResponse(),
          );
        }

        if (url === "/api/dashboard/summary") {
          return Promise.resolve(
            jsonResponse({
              summary: {
                top_missing_articles: [],
                most_repeated_questions: [],
                estimated_ticket_volume: 0,
                articles_needing_updates: 0,
                potential_deflection_estimate: 0,
                potential_deflection_label:
                  "Potential deflection estimate",
                methodology:
                  "Volume-based MVP estimate",
              },
            }),
          );
        }

        if (
          url.startsWith(
            "/api/dashboard/gaps?",
          )
        ) {
          return Promise.resolve(
            jsonResponse({
              gaps: [],
            }),
          );
        }

        if (
          url ===
          "/api/analysis-runs/latest"
        ) {
          return Promise.resolve(
            jsonResponse({
              run: {
                id: 25,
                window_days: 30,
                status: "completed",
                current_stage: null,
                error_stage: null,
                error_message: null,
              },
            }),
          );
        }

        return Promise.resolve(
          jsonResponse({}),
        );
      },
    );

    render(<DashboardPage />);

    expect(
      await screen.findByText(
        "No gaps match this view.",
      ),
    ).toBeInTheDocument();

    expect(
      screen.queryByText(
        "No analysis runs yet. Start an analysis to identify knowledge gaps.",
      ),
    ).not.toBeInTheDocument();
  },
);

it(
  "shows a dedicated error state when knowledge gaps fail to load",
  async () => {
    mockFetch.mockImplementation(
      (
        input: RequestInfo | URL,
      ) => {
        const url = String(input);

        if (url === "/api/dashboard/session") {
          return Promise.resolve(
            dashboardSessionResponse(),
          );
        }

        if (url === "/api/dashboard/summary") {
          return Promise.resolve(
            jsonResponse({
              summary: {
                top_missing_articles: [],
                most_repeated_questions: [],
                estimated_ticket_volume: 0,
                articles_needing_updates: 0,
                potential_deflection_estimate: 0,
                potential_deflection_label:
                  "Potential deflection estimate",
                methodology:
                  "Volume-based MVP estimate",
              },
            }),
          );
        }

        if (
          url.startsWith(
            "/api/dashboard/gaps?",
          )
        ) {
          return Promise.resolve(
            jsonResponse(
              {
                error:
                  "Failed to fetch knowledge gaps.",
              },
              500,
            ),
          );
        }

        if (
          url ===
          "/api/analysis-runs/latest"
        ) {
          return Promise.resolve(
            jsonResponse({
              run: {
                id: 26,
                window_days: 30,
                status: "completed",
                current_stage: null,
                error_stage: null,
                error_message: null,
              },
            }),
          );
        }

        return Promise.resolve(
          jsonResponse({}),
        );
      },
    );

    render(<DashboardPage />);

    expect(
      await screen.findByRole("alert"),
    ).toHaveTextContent(
      "Unable to load knowledge gaps.",
    );

    expect(
      screen.queryByText(
        "No gaps match this view.",
      ),
    ).not.toBeInTheDocument();

    expect(
      screen.queryByText(
        "No analysis runs yet. Start an analysis to identify knowledge gaps.",
      ),
    ).not.toBeInTheDocument();
  },
);
  it("backs off active-run polling and caps the delay at 20 seconds", async () => {
    vi.useFakeTimers();

    try {
      // Keep the existing default responses for other endpoints.
      const defaultFetch = mockFetch.getMockImplementation();

      if (!defaultFetch) {
        throw new Error("Default fetch mock is not installed.");
      }

      const activeRun = {
        id: 77,
        window_days: 30,
        status: "running",
        current_stage: "classification",
        error_stage: null,
        error_message: null,
      };

      mockFetch.mockImplementation(
        (input: RequestInfo | URL, init?: RequestInit) => {
          const url = String(input);

          if (
            url === "/api/analysis-runs/latest" ||
            url === "/api/analysis-runs/77"
          ) {
            return Promise.resolve(
              jsonResponse({ run: activeRun }),
            );
          }

          return defaultFetch(input, init);
        },
      );

      await act(async () => {
        render(<DashboardPage />);
      });

      expect(
        screen.getByText("Analysis is currently running..."),
      ).toBeInTheDocument();

      const countPollRequests = () =>
        mockFetch.mock.calls.filter(
          ([input]) => String(input) === "/api/analysis-runs/77",
        ).length;

      expect(countPollRequests()).toBe(0);

      // Repeated 20s entries verify that the delay stays capped.
      const expectedDelays = [
        3000, 5000, 8000, 13000, 20000, 20000, 20000,
      ];

      for (const [index, delay] of expectedDelays.entries()) {
        await act(async () => {
          await vi.advanceTimersByTimeAsync(delay - 1);
        });

        // No request before the expected delay has elapsed.
        expect(countPollRequests()).toBe(index);

        await act(async () => {
          await vi.advanceTimersByTimeAsync(1);
        });

        // Exactly one request when the delay expires.
        expect(countPollRequests()).toBe(index + 1);
      }
    } finally {
      // Unmount while fake timers are still active.
      cleanup();
      vi.useRealTimers();
    }
  });
    it.each(["completed", "failed"] as const)(
    "stops polling when the run becomes %s",
    async (finalStatus) => {
      vi.useFakeTimers();

      try {
        const defaultFetch = mockFetch.getMockImplementation();

        if (!defaultFetch) {
          throw new Error("Default fetch mock is not installed.");
        }

        const activeRun = {
          id: 77,
          window_days: 30,
          status: "running",
          current_stage: "classification",
          error_stage: null,
          error_message: null,
        };

        mockFetch.mockImplementation(
          (input: RequestInfo | URL, init?: RequestInit) => {
            const url = String(input);

            if (url === "/api/analysis-runs/latest") {
              return Promise.resolve(
                jsonResponse({ run: activeRun }),
              );
            }

            if (url === "/api/analysis-runs/77") {
              return Promise.resolve(
                jsonResponse({
                  run: {
                    ...activeRun,
                    status: finalStatus,
                    current_stage: null,
                    error_stage:
                      finalStatus === "failed"
                        ? "classification"
                        : null,
                    error_message:
                      finalStatus === "failed"
                        ? "Classification failed"
                        : null,
                  },
                }),
              );
            }

            return defaultFetch(input, init);
          },
        );

        await act(async () => {
          render(<DashboardPage />);
        });

        expect(
          screen.getByText("Analysis is currently running..."),
        ).toBeInTheDocument();

        const countPollRequests = () =>
          mockFetch.mock.calls.filter(
            ([input]) =>
              String(input) === "/api/analysis-runs/77",
          ).length;

        await act(async () => {
          await vi.advanceTimersByTimeAsync(3000);
        });

        expect(countPollRequests()).toBe(1);

        expect(
          screen.getByText(
            finalStatus === "completed"
              ? "Analysis completed successfully."
              : "Classification failed",
          ),
        ).toBeInTheDocument();

        // No more polling after either terminal status.
        await act(async () => {
          await vi.advanceTimersByTimeAsync(60000);
        });

        expect(countPollRequests()).toBe(1);
      } finally {
        cleanup();
        vi.useRealTimers();
      }
    },
  );
  it(
  "loads draft review list and opens draft details",
  async () => {
    const defaultFetch =
      mockFetch.getMockImplementation();

    if (!defaultFetch) {
      throw new Error(
        "Default fetch mock is not installed.",
      );
    }

    mockFetch.mockImplementation(
      (
        input: RequestInfo | URL,
        init?: RequestInit,
      ) => {
        const url = String(input);

        if (
          url === "/api/dashboard/drafts"
        ) {
          return Promise.resolve(
            jsonResponse({
              drafts: [
                {
                  id: 101,
                  gap_id: 12,
                  topic: "Password Reset",
                  title:
                    "Reset your password",
                  ai_title:
                    "Reset your password",
                  status: "draft",
                  version: 1,
                  generated_at:
                    "2026-09-25T10:00:00.000Z",
                  reviewer_edited_at: null,
                  status_updated_at: null,
                },
              ],
            }),
          );
        }

        if (
          url ===
          "/api/dashboard/drafts/101"
        ) {
          return Promise.resolve(
            jsonResponse({
              id: 101,
              gap_id: 12,
              status: "draft",
              version: 1,
              generated_at:
                "2026-09-25T10:00:00.000Z",
              reviewer_edited_at: null,
              status_updated_at: null,
              rejection_reason: null,

              ai_original: {
                suggested_title:
                  "Reset your password",
                problem_summary:
                  "Users cannot reset their password.",
                step_by_step_resolution:
                  "Open settings and select Reset Password.",
                faq: [
                  {
                    question:
                      "Where is reset password?",
                    answer:
                      "It is available in account settings.",
                  },
                ],
                related_keywords: [
                  "password",
                  "reset",
                ],
                internal_reviewer_notes:
                  "Verify screenshots.",
              },

              reviewer_revision: {
                suggested_title: null,
                problem_summary: null,
                step_by_step_resolution:
                  null,
                faq: null,
                related_keywords: null,
                internal_reviewer_notes:
                  null,
              },

              versions: [
                {
                  id: 101,
                  version: 1,
                  status: "draft",
                  generated_at:
                    "2026-09-25T10:00:00.000Z",
                },
              ],
            }),
          );
        }

        return defaultFetch(input, init);
      },
    );

    render(<DashboardPage />);

    expect(
      await screen.findByText(
        "Reset your password",
      ),
    ).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", {
        name: "Review",
      }),
    );

    expect(
      await screen.findByText(
        "AI vs Reviewer Comparison",
      ),
    ).toBeInTheDocument();

    expect(
      screen.getAllByText(
       "Users cannot reset their password.",
       { exact: false },
     ).length,
   ).toBeGreaterThan(0);

   expect(
      screen.getAllByText(
        "Where is reset password?",
        { exact: false },
      ).length,
    ).toBeGreaterThan(0);

    expect(
      screen.getAllByText(
        "password, reset",
        { exact: false },
      ).length,
    ).toBeGreaterThan(0);

    expect(
      screen.getAllByText(
        "Verify screenshots.",
        { exact: false },
      ).length,
    ).toBeGreaterThan(0);

    expect(
      mockFetch,
    ).toHaveBeenCalledWith(
      "/api/dashboard/drafts/101",
      {
        credentials: "include",
      },
    );
  },
);
it(
  "edits and saves reviewer draft changes",
  async () => {
    const defaultFetch =
      mockFetch.getMockImplementation();

    if (!defaultFetch) {
      throw new Error(
        "Default fetch mock is not installed.",
      );
    }

    mockFetch.mockImplementation(
      (
        input: RequestInfo | URL,
        init?: RequestInit,
      ) => {
        const url = String(input);

        if (
          url === "/api/dashboard/drafts"
        ) {
          return Promise.resolve(
            jsonResponse({
              drafts: [
                {
                  id: 101,
                  gap_id: 12,
                  topic: "Password Reset",
                  title: "Reset your password",
                  ai_title: "Reset your password",
                  status: "draft",
                  version: 1,
                  generated_at:
                    "2026-09-25T10:00:00.000Z",
                  reviewer_edited_at: null,
                  status_updated_at: null,
                },
              ],
            }),
          );
        }

        if (
          url ===
            "/api/dashboard/drafts/101" &&
          init?.method === "PUT"
        ) {
          return Promise.resolve(
            jsonResponse({
              success: true,
            }),
          );
        }

        if (
          url ===
            "/api/dashboard/drafts/101" &&
          !init?.method
        ) {
          return Promise.resolve(
            jsonResponse({
              id: 101,
              gap_id: 12,
              status: "draft",
              version: 1,
              generated_at:
                "2026-09-25T10:00:00.000Z",
              reviewer_edited_at: null,
              status_updated_at: null,
              rejection_reason: null,

              ai_original: {
                suggested_title:
                  "Reset your password",
                problem_summary:
                  "Original problem summary.",
                step_by_step_resolution:
                  "Original resolution.",
                faq: [],
                related_keywords: [
                  "password",
                ],
                internal_reviewer_notes:
                  "Original notes.",
              },

              reviewer_revision: {
                suggested_title: null,
                problem_summary: null,
                step_by_step_resolution:
                  null,
                faq: null,
                related_keywords: null,
                internal_reviewer_notes:
                  null,
              },

              versions: [
                {
                  id: 101,
                  version: 1,
                  status: "draft",
                  generated_at:
                    "2026-09-25T10:00:00.000Z",
                },
              ],
            }),
          );
        }

        return defaultFetch(input, init);
      },
    );

    render(<DashboardPage />);

    await screen.findByText(
      "Reset your password",
    );

    fireEvent.click(
      screen.getByRole("button", {
        name: "Review",
      }),
    );

    await screen.findByText(
      "Reviewer Revision",
    );

    const titleInput =
      screen.getByDisplayValue(
        "Reset your password",
      );

    fireEvent.change(titleInput, {
      target: {
        value:
          "Updated Password Reset Guide",
      },
    });

    fireEvent.click(
      screen.getByRole("button", {
        name: "Save Changes",
      }),
    );

    await waitFor(() => {
      expect(
        mockFetch,
      ).toHaveBeenCalledWith(
        "/api/dashboard/drafts/101",
        expect.objectContaining({
          method: "PUT",
          credentials: "include",
          headers: {
            "Content-Type":
              "application/json",
          },
          body: expect.any(String),
        }),
      );
    });

    const saveCall =
      mockFetch.mock.calls.find(
        ([input, init]) =>
          String(input) ===
            "/api/dashboard/drafts/101" &&
          init?.method === "PUT",
      );

    expect(saveCall).toBeDefined();

    const requestBody = JSON.parse(
      String(saveCall?.[1]?.body),
    );

    expect(
      requestBody.suggested_title,
    ).toBe(
      "Updated Password Reset Guide",
    );

    expect(
      requestBody.problem_summary,
    ).toBe(
      "Original problem summary.",
    );

    expect(
      requestBody.step_by_step_resolution,
    ).toBe(
      "Original resolution.",
    );

    expect(
      requestBody.related_keywords,
    ).toEqual(["password"]);

    expect(
      requestBody.internal_reviewer_notes,
    ).toBe("Original notes.");
        expect(
      await screen.findByText(
        "Draft edits saved successfully.",
      ),
    ).toBeInTheDocument();
  },
);
it(
  "sends a draft to review",
  async () => {
    const defaultFetch =
      mockFetch.getMockImplementation();

    if (!defaultFetch) {
      throw new Error(
        "Default fetch mock is not installed.",
      );
    }

    mockFetch.mockImplementation(
      (
        input: RequestInfo | URL,
        init?: RequestInit,
      ) => {
        const url = String(input);

        if (
          url === "/api/dashboard/drafts"
        ) {
          return Promise.resolve(
            jsonResponse({
              drafts: [
                {
                  id: 101,
                  gap_id: 12,
                  topic: "Password Reset",
                  title: "Reset your password",
                  ai_title: "Reset your password",
                  status: "draft",
                  version: 1,
                  generated_at:
                    "2026-09-25T10:00:00.000Z",
                  reviewer_edited_at: null,
                  status_updated_at: null,
                },
              ],
            }),
          );
        }

        if (
          url ===
            "/api/dashboard/drafts/101/status" &&
          init?.method === "POST"
        ) {
          return Promise.resolve(
            jsonResponse({
              success: true,
            }),
          );
        }

        if (
          url ===
          "/api/dashboard/drafts/101"
        ) {
          return Promise.resolve(
            jsonResponse({
              id: 101,
              gap_id: 12,
              status: "draft",
              version: 1,
              generated_at:
                "2026-09-25T10:00:00.000Z",
              reviewer_edited_at: null,
              status_updated_at: null,
              rejection_reason: null,

              ai_original: {
                suggested_title:
                  "Reset your password",
                problem_summary:
                  "Password reset issue.",
                step_by_step_resolution:
                  "Reset the password.",
                faq: [],
                related_keywords: [
                  "password",
                ],
                internal_reviewer_notes: "",
              },

              reviewer_revision: {
                suggested_title: null,
                problem_summary: null,
                step_by_step_resolution:
                  null,
                faq: null,
                related_keywords: null,
                internal_reviewer_notes:
                  null,
              },

              versions: [
                {
                  id: 101,
                  version: 1,
                  status: "draft",
                  generated_at:
                    "2026-09-25T10:00:00.000Z",
                },
              ],
            }),
          );
        }

        return defaultFetch(input, init);
      },
    );

    render(<DashboardPage />);

    await screen.findByText(
      "Reset your password",
    );

    fireEvent.click(
      screen.getByRole("button", {
        name: "Review",
      }),
    );

    await screen.findByText(
      "Review Status",
    );

    fireEvent.click(
      screen.getByRole("button", {
        name: "Send to Review",
      }),
    );

    await waitFor(() => {
      expect(
        mockFetch,
      ).toHaveBeenCalledWith(
        "/api/dashboard/drafts/101/status",
        expect.objectContaining({
          method: "POST",
          credentials: "include",
          headers: {
            "Content-Type":
              "application/json",
          },
          body: JSON.stringify({
            status: "in_review",
          }),
        }),
      );
    });
  },
);
it(
  "protects unsaved reviewer edits before sending a draft to review",
  async () => {
    const defaultFetch =
      mockFetch.getMockImplementation();

    if (!defaultFetch) {
      throw new Error(
        "Default fetch mock is not installed.",
      );
    }

    mockFetch.mockImplementation(
      (
        input: RequestInfo | URL,
        init?: RequestInit,
      ) => {
        const url = String(input);

        if (url === "/api/dashboard/drafts") {
          return Promise.resolve(
            jsonResponse({
              drafts: [
                {
                  id: 101,
                  gap_id: 12,
                  topic: "Password Reset",
                  title: "Reset your password",
                  ai_title: "Reset your password",
                  status: "draft",
                  version: 1,
                  generated_at:
                    "2026-09-25T10:00:00.000Z",
                  reviewer_edited_at: null,
                  status_updated_at: null,
                },
              ],
            }),
          );
        }

        if (
          url ===
            "/api/dashboard/drafts/101/status" &&
          init?.method === "POST"
        ) {
          return Promise.resolve(
            jsonResponse({
              success: true,
            }),
          );
        }

        if (
          url === "/api/dashboard/drafts/101"
        ) {
          return Promise.resolve(
            jsonResponse({
              id: 101,
              gap_id: 12,
              status: "draft",
              version: 1,
              generated_at:
                "2026-09-25T10:00:00.000Z",
              reviewer_edited_at: null,
              status_updated_at: null,
              rejection_reason: null,

              ai_original: {
                suggested_title:
                  "Reset your password",
                problem_summary:
                  "Password reset issue.",
                step_by_step_resolution:
                  "Reset the password.",
                faq: [],
                related_keywords: [
                  "password",
                ],
                internal_reviewer_notes: "",
              },

              reviewer_revision: {
                suggested_title: null,
                problem_summary: null,
                step_by_step_resolution: null,
                faq: null,
                related_keywords: null,
                internal_reviewer_notes: null,
              },

              versions: [
                {
                  id: 101,
                  version: 1,
                  status: "draft",
                  generated_at:
                    "2026-09-25T10:00:00.000Z",
                },
              ],
            }),
          );
        }

        return defaultFetch(input, init);
      },
    );

    render(<DashboardPage />);

    await screen.findByText(
      "Reset your password",
    );

    fireEvent.click(
      screen.getByRole("button", {
        name: "Review",
      }),
    );

    await screen.findByText(
      "Reviewer Revision",
    );

    const titleInput =
      screen.getByDisplayValue(
        "Reset your password",
      );

    fireEvent.change(titleInput, {
      target: {
        value:
          "Reset your password UNSAVED",
      },
    });

    fireEvent.click(
      screen.getByRole("button", {
        name: "Send to Review",
      }),
    );

    expect(
      await screen.findByText(
        "You have unsaved changes. Discard them and change the review status?",
      ),
    ).toBeInTheDocument();

    // Status API must NOT run while the warning
    // is waiting for the reviewer.
    expect(
      mockFetch.mock.calls.some(
        ([input, init]) =>
          String(input) ===
            "/api/dashboard/drafts/101/status" &&
          init?.method === "POST",
      ),
    ).toBe(false);

    fireEvent.click(
      screen.getByRole("button", {
        name: "Keep Editing",
      }),
    );

    expect(
      screen.getByDisplayValue(
        "Reset your password UNSAVED",
      ),
    ).toBeInTheDocument();

    expect(
      screen.queryByText(
        "You have unsaved changes. Discard them and change the review status?",
      ),
    ).not.toBeInTheDocument();

    // Try again and explicitly discard.
    fireEvent.click(
      screen.getByRole("button", {
        name: "Send to Review",
      }),
    );

    expect(
      await screen.findByText(
        "You have unsaved changes. Discard them and change the review status?",
      ),
    ).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", {
        name: "Discard & Continue",
      }),
    );

    await waitFor(() => {
      expect(
        mockFetch,
      ).toHaveBeenCalledWith(
        "/api/dashboard/drafts/101/status",
        expect.objectContaining({
          method: "POST",
          credentials: "include",
          body: JSON.stringify({
            status: "in_review",
          }),
        }),
      );
    });
  },
);

it(
  "protects unsaved reviewer edits before closing the draft",
  async () => {
    const defaultFetch =
      mockFetch.getMockImplementation();

    if (!defaultFetch) {
      throw new Error(
        "Default fetch mock is not installed.",
      );
    }

    mockFetch.mockImplementation(
      (
        input: RequestInfo | URL,
        init?: RequestInit,
      ) => {
        const url = String(input);

        if (url === "/api/dashboard/drafts") {
          return Promise.resolve(
            jsonResponse({
              drafts: [
                {
                  id: 101,
                  gap_id: 12,
                  topic: "Password Reset",
                  title: "Reset your password",
                  ai_title: "Reset your password",
                  status: "draft",
                  version: 1,
                  generated_at:
                    "2026-09-25T10:00:00.000Z",
                  reviewer_edited_at: null,
                  status_updated_at: null,
                },
              ],
            }),
          );
        }

        if (
          url === "/api/dashboard/drafts/101" &&
          !init?.method
        ) {
          return Promise.resolve(
            jsonResponse({
              id: 101,
              gap_id: 12,
              status: "draft",
              version: 1,
              generated_at:
                "2026-09-25T10:00:00.000Z",
              reviewer_edited_at: null,
              status_updated_at: null,
              rejection_reason: null,

              ai_original: {
                suggested_title:
                  "Reset your password",
                problem_summary:
                  "Password reset issue.",
                step_by_step_resolution:
                  "Reset the password.",
                faq: [],
                related_keywords: ["password"],
                internal_reviewer_notes: "",
              },

              reviewer_revision: {
                suggested_title: null,
                problem_summary: null,
                step_by_step_resolution: null,
                faq: null,
                related_keywords: null,
                internal_reviewer_notes: null,
              },

              versions: [
                {
                  id: 101,
                  version: 1,
                  status: "draft",
                  generated_at:
                    "2026-09-25T10:00:00.000Z",
                },
              ],
            }),
          );
        }

        return defaultFetch(input, init);
      },
    );

    render(<DashboardPage />);

    await screen.findByText(
      "Reset your password",
    );

    fireEvent.click(
      screen.getByRole("button", {
        name: "Review",
      }),
    );

    await screen.findByText(
      "Reviewer Revision",
    );

    const titleInput =
      screen.getByDisplayValue(
        "Reset your password",
      );

    fireEvent.change(titleInput, {
      target: {
        value:
          "Reset your password UNSAVED CLOSE",
      },
    });

    // First close attempt should be blocked.
    fireEvent.click(
      screen.getByRole("button", {
        name: "Close",
      }),
    );

    expect(
      await screen.findByText(
        "You have unsaved changes. Discard them and close the draft?",
      ),
    ).toBeInTheDocument();

    // Keep Editing must preserve the unsaved value.
    fireEvent.click(
      screen.getByRole("button", {
        name: "Keep Editing",
      }),
    );

    expect(
      screen.getByDisplayValue(
        "Reset your password UNSAVED CLOSE",
      ),
    ).toBeInTheDocument();

    expect(
      screen.getByText(
        "Reviewer Revision",
      ),
    ).toBeInTheDocument();

    // Second close attempt: explicitly discard.
    fireEvent.click(
      screen.getByRole("button", {
        name: "Close",
      }),
    );

    expect(
      await screen.findByText(
        "You have unsaved changes. Discard them and close the draft?",
      ),
    ).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", {
        name: "Discard & Close",
      }),
    );

    // Drawer/editor should now be closed.
    await waitFor(() => {
      expect(
        screen.queryByText(
          "Reviewer Revision",
        ),
      ).not.toBeInTheDocument();
    });

    // Unsaved reviewer changes must never have been saved.
    expect(
      mockFetch.mock.calls.some(
        ([input, init]) =>
          String(input) ===
            "/api/dashboard/drafts/101" &&
          init?.method === "PUT",
      ),
    ).toBe(false);
  },
);

it(
  "requires a rejection reason before rejecting an in-review draft",
  async () => {
    const defaultFetch =
      mockFetch.getMockImplementation();

    if (!defaultFetch) {
      throw new Error(
        "Default fetch mock is not installed.",
      );
    }

    mockFetch.mockImplementation(
      (
        input: RequestInfo | URL,
        init?: RequestInit,
      ) => {
        const url = String(input);

        if (
          url === "/api/dashboard/drafts"
        ) {
          return Promise.resolve(
            jsonResponse({
              drafts: [
                {
                  id: 101,
                  gap_id: 12,
                  topic: "Password Reset",
                  title: "Reset your password",
                  ai_title: "Reset your password",
                  status: "in_review",
                  version: 1,
                  generated_at:
                    "2026-09-25T10:00:00.000Z",
                  reviewer_edited_at: null,
                  status_updated_at: null,
                },
              ],
            }),
          );
        }

        if (
          url ===
            "/api/dashboard/drafts/101/status" &&
          init?.method === "POST"
        ) {
          return Promise.resolve(
            jsonResponse({
              success: true,
            }),
          );
        }

        if (
          url ===
          "/api/dashboard/drafts/101"
        ) {
          return Promise.resolve(
            jsonResponse({
              id: 101,
              gap_id: 12,
              status: "in_review",
              version: 1,
              generated_at:
                "2026-09-25T10:00:00.000Z",
              reviewer_edited_at: null,
              status_updated_at: null,
              rejection_reason: null,

              ai_original: {
                suggested_title:
                  "Reset your password",
                problem_summary:
                  "Password reset issue.",
                step_by_step_resolution:
                  "Reset the password.",
                faq: [],
                related_keywords: [
                  "password",
                ],
                internal_reviewer_notes: "",
              },

              reviewer_revision: {
                suggested_title: null,
                problem_summary: null,
                step_by_step_resolution:
                  null,
                faq: null,
                related_keywords: null,
                internal_reviewer_notes:
                  null,
              },

              versions: [
                {
                  id: 101,
                  version: 1,
                  status: "in_review",
                  generated_at:
                    "2026-09-25T10:00:00.000Z",
                },
              ],
            }),
          );
        }

        return defaultFetch(input, init);
      },
    );

    render(<DashboardPage />);

    await screen.findByText(
      "Reset your password",
    );

    fireEvent.click(
      screen.getByRole("button", {
        name: "Review",
      }),
    );

    const rejectButton =
      await screen.findByRole(
        "button",
        {
          name: "Reject",
        },
      );

    // No reason yet: rejection must be blocked.
    expect(rejectButton).toBeDisabled();

    const rejectionInput =
      screen.getByPlaceholderText(
        "Explain why this draft is being rejected."
      );

    fireEvent.change(
      rejectionInput,
      {
        target: {
          value:
            "Please add troubleshooting steps.",
        },
      },
    );

    expect(rejectButton).toBeEnabled();

    fireEvent.click(rejectButton);

    await waitFor(() => {
      expect(
        mockFetch,
      ).toHaveBeenCalledWith(
        "/api/dashboard/drafts/101/status",
        expect.objectContaining({
          method: "POST",
          credentials: "include",
          body: JSON.stringify({
            status: "rejected",
            rejection_reason:
              "Please add troubleshooting steps.",
          }),
        }),
      );
    });
  },
);
it(
  "approves an in-review draft",
  async () => {
    const defaultFetch =
      mockFetch.getMockImplementation();

    if (!defaultFetch) {
      throw new Error(
        "Default fetch mock is not installed.",
      );
    }

    mockFetch.mockImplementation(
      (
        input: RequestInfo | URL,
        init?: RequestInit,
      ) => {
        const url = String(input);

        if (
          url === "/api/dashboard/drafts"
        ) {
          return Promise.resolve(
            jsonResponse({
              drafts: [
                {
                  id: 101,
                  gap_id: 12,
                  topic: "Password Reset",
                  title: "Reset your password",
                  ai_title: "Reset your password",
                  status: "in_review",
                  version: 1,
                  generated_at:
                    "2026-09-25T10:00:00.000Z",
                  reviewer_edited_at: null,
                  status_updated_at: null,
                },
              ],
            }),
          );
        }

        if (
          url ===
            "/api/dashboard/drafts/101/status" &&
          init?.method === "POST"
        ) {
          return Promise.resolve(
            jsonResponse({
              success: true,
            }),
          );
        }

        if (
          url ===
          "/api/dashboard/drafts/101"
        ) {
          return Promise.resolve(
            jsonResponse({
              id: 101,
              gap_id: 12,
              status: "in_review",
              version: 1,
              generated_at:
                "2026-09-25T10:00:00.000Z",
              reviewer_edited_at: null,
              status_updated_at: null,
              rejection_reason: null,

              ai_original: {
                suggested_title:
                  "Reset your password",
                problem_summary:
                  "Password reset issue.",
                step_by_step_resolution:
                  "Reset the password.",
                faq: [],
                related_keywords: [
                  "password",
                ],
                internal_reviewer_notes: "",
              },

              reviewer_revision: {
                suggested_title: null,
                problem_summary: null,
                step_by_step_resolution:
                  null,
                faq: null,
                related_keywords: null,
                internal_reviewer_notes:
                  null,
              },

              versions: [
                {
                  id: 101,
                  version: 1,
                  status: "in_review",
                  generated_at:
                    "2026-09-25T10:00:00.000Z",
                },
              ],
            }),
          );
        }

        return defaultFetch(input, init);
      },
    );

    render(<DashboardPage />);

    await screen.findByText(
      "Reset your password",
    );

    fireEvent.click(
      screen.getByRole("button", {
        name: "Review",
      }),
    );

    const approveButton =
      await screen.findByRole(
        "button",
        {
          name: "Approve",
        },
      );

    fireEvent.click(approveButton);

    await waitFor(() => {
      expect(
        mockFetch,
      ).toHaveBeenCalledWith(
        "/api/dashboard/drafts/101/status",
        expect.objectContaining({
          method: "POST",
          credentials: "include",
          body: JSON.stringify({
            status: "approved",
          }),
        }),
      );
    });
  },
);

it(
  "protects unsaved reviewer edits before regenerating the draft",
  async () => {
    let regenerateCalls = 0;

    vi.mocked(fetch).mockImplementation(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);

        if (url === "/api/dashboard/session") {
          return jsonResponse({
            authenticated: true,
            zendesk_account_id: 1,
            subdomain: "test",
            zendesk_url: "https://test.zendesk.com",
          });
        }

        if (url === "/api/dashboard/summary") {
          return jsonResponse({
            top_missing_articles: [],
            most_repeated_questions: [],
            estimated_ticket_volume: 0,
            articles_needing_updates: 0,
            potential_deflection: 0,
          });
        }

        if (url === "/api/analysis-runs/latest") {
          return jsonResponse({ run: null });
        }

        if (url.startsWith("/api/dashboard/gaps?")) {
          return jsonResponse({ gaps: [] });
        }

        if (url === "/api/dashboard/drafts") {
          return jsonResponse({
            drafts: [
              {
                id: 102,
                gap_id: 12,
                topic: "Password reset",
                title: "Reset your password",
                ai_title: "Reset your password",
                status: "draft",
                version: 2,
                generated_at: "2026-09-29T08:00:00.000Z",
                reviewer_edited_at: null,
                status_updated_at: null,
              },
            ],
          });
        }

        if (url === "/api/dashboard/drafts/102") {
          return jsonResponse({
            id: 102,
            gap_id: 12,
            status: "draft",
            version: 2,
            generated_at: "2026-09-29T08:00:00.000Z",
            reviewer_edited_at: null,
            status_updated_at: null,
            rejection_reason: null,
            ai_original: {
              suggested_title: "Reset your password",
              problem_summary: "Users cannot reset their password.",
              step_by_step_resolution:
                "Open settings and reset the password.",
              faq: [],
              related_keywords: ["password", "login"],
              internal_reviewer_notes: "",
            },
            reviewer_revision: {
              suggested_title: null,
              problem_summary: null,
              step_by_step_resolution: null,
              faq: null,
              related_keywords: null,
              internal_reviewer_notes: null,
            },
            versions: [
              {
                id: 102,
                version: 2,
                status: "draft",
                generated_at: "2026-09-29T08:00:00.000Z",
              },
            ],
          });
        }

        if (
          url === "/api/dashboard/drafts/102/regenerate" &&
          init?.method === "POST"
        ) {
          regenerateCalls += 1;

          return jsonResponse(
            {
              draft_id: 103,
              gap_id: 12,
            },
            201,
          );
        }

        if (url === "/api/dashboard/drafts/103") {
          return jsonResponse({
            id: 103,
            gap_id: 12,
            status: "draft",
            version: 3,
            generated_at: "2026-09-29T09:00:00.000Z",
            reviewer_edited_at: null,
            status_updated_at: null,
            rejection_reason: null,
            ai_original: {
              suggested_title: "Reset your password V3",
              problem_summary: "Updated password reset guidance.",
              step_by_step_resolution:
                "Open settings and follow the updated reset steps.",
              faq: [],
              related_keywords: ["password", "login"],
              internal_reviewer_notes: "",
            },
            reviewer_revision: {
              suggested_title: null,
              problem_summary: null,
              step_by_step_resolution: null,
              faq: null,
              related_keywords: null,
              internal_reviewer_notes: null,
            },
            versions: [
              {
                id: 102,
                version: 2,
                status: "draft",
                generated_at: "2026-09-29T08:00:00.000Z",
              },
              {
                id: 103,
                version: 3,
                status: "draft",
                generated_at: "2026-09-29T09:00:00.000Z",
              },
            ],
          });
        }

        return jsonResponse({}, 404);
      },
    );

    render(<DashboardPage />);

    fireEvent.click(
      await screen.findByRole("button", {
        name: "Review",
      }),
    );

    const titleInput =
      await screen.findByDisplayValue("Reset your password");

    fireEvent.change(titleInput, {
      target: {
        value: "Reset your password UNSAVED REGENERATE",
      },
    });

    fireEvent.click(
      screen.getByRole("button", {
        name: "Regenerate Draft",
      }),
    );

    expect(
      await screen.findByText(
        "You have unsaved changes. Discard them and regenerate the draft?",
      ),
    ).toBeInTheDocument();

    expect(regenerateCalls).toBe(0);

    fireEvent.click(
      screen.getByRole("button", {
        name: "Keep Editing",
      }),
    );

    expect(
      screen.getByDisplayValue(
        "Reset your password UNSAVED REGENERATE",
      ),
    ).toBeInTheDocument();

    expect(regenerateCalls).toBe(0);

    fireEvent.click(
      screen.getByRole("button", {
        name: "Regenerate Draft",
      }),
    );

    fireEvent.click(
      await screen.findByRole("button", {
        name: "Discard & Regenerate",
      }),
    );

    await waitFor(() => {
      expect(regenerateCalls).toBe(1);
    });

    expect(
      await screen.findByDisplayValue("Reset your password V3"),
    ).toBeInTheDocument();
  },
);

it(
  "regenerates a draft and reloads the existing draft",
  async () => {
    const defaultFetch =
      mockFetch.getMockImplementation();

    if (!defaultFetch) {
      throw new Error(
        "Default fetch mock is not installed.",
      );
    }
    let draftRegenerated = false;
    mockFetch.mockImplementation(
      (
        input: RequestInfo | URL,
        init?: RequestInit,
      ) => {
        const url = String(input);

        if (url === "/api/dashboard/drafts") {
          return Promise.resolve(
            jsonResponse({
              drafts: [
                {
                  id: 101,
                  gap_id: 12,
                  topic: "Password Reset",
                  title: "Reset your password",
                  ai_title: "Reset your password",
                  status: "draft",
                  version: 1,
                  generated_at:
                    "2026-09-25T10:00:00.000Z",
                  reviewer_edited_at: null,
                  status_updated_at: null,
                },
              ],
            }),
          );
        }

        if (
          url ===
            "/api/dashboard/drafts/101/regenerate" &&
          init?.method === "POST"
        ) {
          draftRegenerated = true;
          return Promise.resolve(
            jsonResponse(
              {
                draft_id: 101,
                gap_id: 12,
              },
              200,
            ),
          );
        }

        if (
          url === "/api/dashboard/drafts/101" &&
          !init?.method
        ) {
          if (draftRegenerated) {
  return Promise.resolve(
    jsonResponse({
      id: 101,
      gap_id: 12,
      status: "draft",
      generated_at:
        "2026-09-25T11:00:00.000Z",
      reviewer_edited_at: null,
      status_updated_at: null,
      rejection_reason: null,

      ai_original: {
        suggested_title:
          "Improved Password Reset Guide",
        problem_summary:
          "Regenerated password reset guidance.",
        step_by_step_resolution:
          "Updated resolution steps.",
        faq: [],
        related_keywords: [
          "password",
          "reset",
        ],
        internal_reviewer_notes: "",
      },

      reviewer_revision: {
        suggested_title: null,
        problem_summary: null,
        step_by_step_resolution: null,
        faq: null,
        related_keywords: null,
        internal_reviewer_notes: null,
      },
    }),
  );
}
          return Promise.resolve(
            jsonResponse({
              id: 101,
              gap_id: 12,
              status: "draft",
              generated_at:
                "2026-09-25T10:00:00.000Z",
              reviewer_edited_at: null,
              status_updated_at: null,
              rejection_reason: null,

              ai_original: {
                suggested_title:
                  "Reset your password",
                problem_summary:
                  "Original password reset issue.",
                step_by_step_resolution:
                  "Original resolution.",
                faq: [],
                related_keywords: ["password"],
                internal_reviewer_notes: "",
              },

              reviewer_revision: {
                suggested_title: null,
                problem_summary: null,
                step_by_step_resolution: null,
                faq: null,
                related_keywords: null,
                internal_reviewer_notes: null,
              },
            }),
          );
        }
     return defaultFetch(input, init);
      },
    );

    render(<DashboardPage />);

    await screen.findByText(
      "Reset your password",
    );

    fireEvent.click(
      screen.getByRole("button", {
        name: "Review",
      }),
    );

    await screen.findByText(
      "AI vs Reviewer Comparison",
    );

    fireEvent.click(
      screen.getByRole("button", {
        name: "Regenerate Draft",
      }),
    );

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        "/api/dashboard/drafts/101/regenerate",
        expect.objectContaining({
          method: "POST",
          credentials: "include",
        }),
      );
    });

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        "/api/dashboard/drafts/101",
        {
          credentials: "include",
        },
      );
    });

    expect(
      (
       await screen.findAllByText(
         "Improved Password Reset Guide",
         { exact: false },
       )
     ).length,
   ).toBeGreaterThan(0);

expect(
  (
    await screen.findAllByText(
      "Improved Password Reset Guide",
    )
  ).length,
).toBeGreaterThan(0);

expect(
  screen.getByDisplayValue(
    "Improved Password Reset Guide",
  ),
).toBeInTheDocument();
  },
);
it(
  "copies the reviewed draft as Markdown",
  async () => {
    const defaultFetch =
      mockFetch.getMockImplementation();

    if (!defaultFetch) {
      throw new Error(
        "Default fetch mock is not installed.",
      );
    }

    const writeText = vi.fn().mockResolvedValue(
      undefined,
    );

    Object.defineProperty(
      navigator,
      "clipboard",
      {
        value: { writeText },
        configurable: true,
      },
    );

    mockFetch.mockImplementation(
      (
        input: RequestInfo | URL,
        init?: RequestInit,
      ) => {
        const url = String(input);

        if (url === "/api/dashboard/drafts") {
          return Promise.resolve(
            jsonResponse({
              drafts: [
                {
                  id: 101,
                  gap_id: 12,
                  topic: "Password Reset",
                  title:
                    "Updated Password Reset Guide",
                  ai_title:
                    "Reset your password",
                  status: "in_review",
                  generated_at:
                    "2026-09-25T10:00:00.000Z",
                  reviewer_edited_at:
                    "2026-09-25T10:30:00.000Z",
                  status_updated_at: null,
                },
              ],
            }),
          );
        }

        if (
          url ===
          "/api/dashboard/drafts/101"
        ) {
          return Promise.resolve(
            jsonResponse({
              id: 101,
              gap_id: 12,
              status: "in_review",
              generated_at:
                "2026-09-25T10:00:00.000Z",
              reviewer_edited_at:
                "2026-09-25T10:30:00.000Z",
              status_updated_at: null,
              rejection_reason: null,

              ai_original: {
                suggested_title:
                  "Reset your password",
                problem_summary:
                  "Original summary.",
                step_by_step_resolution:
                  "Original steps.",
                faq: [],
                related_keywords: [
                  "password",
                ],
                internal_reviewer_notes: "",
              },

              reviewer_revision: {
                suggested_title:
                  "Updated Password Reset Guide",
                problem_summary:
                  "Reviewed summary.",
                step_by_step_resolution:
                  "1. Open settings.\n2. Reset password.",
                faq: [
                  {
                    question:
                      "What if the link expires?",
                    answer:
                      "Request a new reset link.",
                  },
                ],
                related_keywords: [
                  "password",
                  "reset",
                ],
                internal_reviewer_notes:
                  "Reviewed by knowledge manager.",
              },
            }),
          );
        }

        return defaultFetch(input, init);
      },
    );

    render(<DashboardPage />);

    await screen.findByText(
      "Updated Password Reset Guide",
    );

    fireEvent.click(
      screen.getByRole("button", {
        name: "Review",
      }),
    );

    await screen.findByText(
      "AI vs Reviewer Comparison",
    );

    fireEvent.click(
      screen.getByRole("button", {
        name: "Copy Markdown",
      }),
    );

    await waitFor(() => {
      expect(writeText).toHaveBeenCalledTimes(
        1,
      );
    });

    const copiedMarkdown =
      writeText.mock.calls[0][0];

    expect(copiedMarkdown).toContain(
      "# Updated Password Reset Guide",
    );
    expect(copiedMarkdown).toContain(
      "Reviewed summary.",
    );
    expect(copiedMarkdown).toContain(
      "What if the link expires?",
    );
    expect(copiedMarkdown).toContain(
      "password",
    );
  },
);
it(
  "copies the reviewed draft as HTML",
  async () => {
    const defaultFetch =
      mockFetch.getMockImplementation();

    if (!defaultFetch) {
      throw new Error(
        "Default fetch mock is not installed.",
      );
    }

    const writeText = vi.fn().mockResolvedValue(
      undefined,
    );

    Object.defineProperty(
      navigator,
      "clipboard",
      {
        value: { writeText },
        configurable: true,
      },
    );

    mockFetch.mockImplementation(
      (
        input: RequestInfo | URL,
        init?: RequestInit,
      ) => {
        const url = String(input);

        if (url === "/api/dashboard/drafts") {
          return Promise.resolve(
            jsonResponse({
              drafts: [
                {
                  id: 101,
                  gap_id: 12,
                  topic: "Password Reset",
                  title:
                    "Updated Password Reset Guide",
                  ai_title:
                    "Reset your password",
                  status: "approved",
                  generated_at:
                    "2026-09-25T10:00:00.000Z",
                  reviewer_edited_at:
                    "2026-09-25T10:30:00.000Z",
                  status_updated_at:
                    "2026-09-25T10:45:00.000Z",
                },
              ],
            }),
          );
        }

        if (
          url ===
          "/api/dashboard/drafts/101"
        ) {
          return Promise.resolve(
            jsonResponse({
              id: 101,
              gap_id: 12,
              status: "approved",
              generated_at:
                "2026-09-25T10:00:00.000Z",
              reviewer_edited_at:
                "2026-09-25T10:30:00.000Z",
              status_updated_at:
                "2026-09-25T10:45:00.000Z",
              rejection_reason: null,

              ai_original: {
                suggested_title:
                  "Reset your password",
                problem_summary:
                  "Original summary.",
                step_by_step_resolution:
                  "Original steps.",
                faq: [],
                related_keywords: [
                  "password",
                ],
                internal_reviewer_notes: "",
              },

              reviewer_revision: {
                suggested_title:
                  "Updated Password Reset Guide",
                problem_summary:
                  "Reviewed summary.",
                step_by_step_resolution:
                  "Open settings and reset password.",
                faq: [
                  {
                    question:
                      "What if the link expires?",
                    answer:
                      "Request a new reset link.",
                  },
                ],
                related_keywords: [
                  "password",
                  "reset",
                ],
                internal_reviewer_notes:
                  "Reviewed by knowledge manager.",
              },
            }),
          );
        }

        return defaultFetch(input, init);
      },
    );

    render(<DashboardPage />);

    await screen.findByText(
      "Updated Password Reset Guide",
    );

    fireEvent.click(
      screen.getByRole("button", {
        name: "Review",
      }),
    );

    await screen.findByText(
      "AI vs Reviewer Comparison",
    );

    fireEvent.click(
      screen.getByRole("button", {
        name: "Copy HTML",
      }),
    );

    await waitFor(() => {
      expect(writeText).toHaveBeenCalledTimes(
        1,
      );
    });

    const copiedHtml =
      writeText.mock.calls[0][0];

    expect(copiedHtml).toContain(
      "<h1>Updated Password Reset Guide</h1>",
    );
    expect(copiedHtml).toContain(
      "Reviewed summary.",
    );
    expect(copiedHtml).toContain(
      "What if the link expires?",
    );
    expect(copiedHtml).toContain(
      "password",
    );
  },
);
it(
  "adds and saves a reviewer FAQ",
  async () => {
    const defaultFetch =
      mockFetch.getMockImplementation();

    if (!defaultFetch) {
      throw new Error(
        "Default fetch mock is not installed.",
      );
    }

    mockFetch.mockImplementation(
      (
        input: RequestInfo | URL,
        init?: RequestInit,
      ) => {
        const url = String(input);

        if (url === "/api/dashboard/drafts") {
          return Promise.resolve(
            jsonResponse({
              drafts: [
                {
                  id: 101,
                  gap_id: 12,
                  topic: "Password Reset",
                  title: "Reset your password",
                  ai_title: "Reset your password",
                  status: "draft",
                  version: 1,
                  generated_at:
                    "2026-09-25T10:00:00.000Z",
                  reviewer_edited_at: null,
                  status_updated_at: null,
                },
              ],
            }),
          );
        }

        if (
          url === "/api/dashboard/drafts/101" &&
          init?.method === "PUT"
        ) {
          return Promise.resolve(
            jsonResponse({
              success: true,
            }),
          );
        }

        if (
          url === "/api/dashboard/drafts/101"
        ) {
          return Promise.resolve(
            jsonResponse({
              id: 101,
              gap_id: 12,
              status: "draft",
              version: 1,
              generated_at:
                "2026-09-25T10:00:00.000Z",
              reviewer_edited_at: null,
              status_updated_at: null,
              rejection_reason: null,

              ai_original: {
                suggested_title:
                  "Reset your password",
                problem_summary:
                  "Password reset issue.",
                step_by_step_resolution:
                  "Reset the password.",
                faq: [],
                related_keywords: [
                  "password",
                ],
                internal_reviewer_notes: "",
              },

              reviewer_revision: {
                suggested_title: null,
                problem_summary: null,
                step_by_step_resolution: null,
                faq: null,
                related_keywords: null,
                internal_reviewer_notes: null,
              },

              versions: [
                {
                  id: 101,
                  version: 1,
                  status: "draft",
                  generated_at:
                    "2026-09-25T10:00:00.000Z",
                },
              ],
            }),
          );
        }

        return defaultFetch(input, init);
      },
    );

    render(<DashboardPage />);

    await screen.findByText(
      "Reset your password",
    );

    fireEvent.click(
      screen.getByRole("button", {
        name: "Review",
      }),
    );

    await screen.findByText(
      "AI vs Reviewer Comparison",
    );

    fireEvent.click(
      screen.getByRole("button", {
        name: "Add FAQ",
      }),
    );

    fireEvent.change(
      screen.getByPlaceholderText("Question"),
      {
        target: {
          value:
            "What if my reset link expires?",
        },
      },
    );

    fireEvent.change(
      screen.getByPlaceholderText("Answer"),
      {
        target: {
          value:
            "Request a new password reset link.",
        },
      },
    );

    fireEvent.click(
      screen.getByRole("button", {
        name: "Save Changes",
      }),
    );

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        "/api/dashboard/drafts/101",
        expect.objectContaining({
          method: "PUT",
          credentials: "include",
          headers: {
            "Content-Type":
              "application/json",
          },
        }),
      );
    });

    const saveCall =
      mockFetch.mock.calls.find(
        ([input, init]) =>
          String(input) ===
            "/api/dashboard/drafts/101" &&
          init?.method === "PUT",
      );

    expect(saveCall).toBeDefined();

    const requestBody = JSON.parse(
      String(saveCall?.[1]?.body),
    );

    expect(requestBody.faq).toEqual([
      {
        question:
          "What if my reset link expires?",
        answer:
          "Request a new password reset link.",
      },
    ]);
  },
);
});
