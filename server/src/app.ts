import express from "express";

import zendeskRoutes from "./zendesk/routes.js";
import analysisRoutes from "./analysis/routes.js";
import dashboardRoutes from "./dashboard/routes.js";
import { verifyZafBearer } from "./auth/zafJwt.js";

const app = express();

// Runs behind the Cloud Run proxy.
app.set("trust proxy", 1);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use("/api/analysis-runs", analysisRoutes);
app.use("/api/dashboard", dashboardRoutes);

app.get("/", (_req, res) => {
  res.status(200).json({
    status: "ok",
    service: "helpcenteriq-server",
    message: "HelpCenter-IQ Backend is running successfully"
  });
});

app.get("/health", (_req, res) => {
  res.status(200).json({
    status: "ok",
    service: "helpcenteriq-server",
  });
});

// Proves a Zendesk-signed request reaches the backend (no database needed).
app.get("/api/zaf/ping", async (req, res) => {
  const claims = await verifyZafBearer(req);

  if (!claims) {
    return res.status(401).json({ error: "Invalid ZAF JWT" });
  }

  return res.json({
    ok: true,
    subdomain: claims.subdomain,
  });
});

app.use(zendeskRoutes);

export default app;