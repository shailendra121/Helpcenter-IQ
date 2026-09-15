import {
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
    "loads and renders the dashboard shell and empty gap state",
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
          "No gaps match this view.",
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
});