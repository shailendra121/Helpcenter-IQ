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
});
