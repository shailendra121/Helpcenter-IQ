import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import DashboardPage from "../pages/DashboardPage";

const mockFetch = vi.fn();

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

describe("DashboardPage when the account has not installed the app", () => {
  beforeEach(() => {
    mockFetch.mockReset();
    vi.stubGlobal("fetch", mockFetch);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("shows the Connect Zendesk screen when the session returns 404", async () => {
    mockFetch.mockResolvedValue(
      jsonResponse({ error: "not_installed", subdomain: "ghost" }, 404),
    );

    render(<DashboardPage />);

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Connect Zendesk" }),
      ).toBeTruthy();
    });

    expect(screen.getByText("HelpCenterIQ is not connected yet")).toBeTruthy();
  });
});