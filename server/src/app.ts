import express from "express";

import zendeskRoutes from "./zendesk/routes.js";
import analysisRoutes from "./analysis/routes.js";
import dashboardRoutes from "./dashboard/routes.js";
import { verifyZafBearer } from "./auth/zafJwt.js";

const app = express();

// Cloud Run proxy ke peeche hai
app.set("trust proxy", true);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use("/api/analysis-runs", analysisRoutes);
app.use("/api/dashboard", dashboardRoutes);

app.get("/health", (_req, res) => {
  res.status(200).json({
    status: "ok",
    service: "helpcenteriq-server",
  });
});
// Proves a Zendesk-signed request reaches the backend (no DB needed).
app.get("/api/zaf/ping", (req, res) => {
  const claims = verifyZafBearer(req);

  if (!claims) {
    return res.status(401).json({ error: "Invalid ZAF JWT" });
  }

  return res.json({
    ok: true,
    subdomain: claims.subdomain,
    database_configured: Boolean(process.env.DATABASE_URL),
  });
});

app.use(zendeskRoutes);

export default app;