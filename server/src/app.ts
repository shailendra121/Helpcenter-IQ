import express from "express";
import path from "path";

import zendeskRoutes from "./zendesk/routes.js";
import analysisRoutes from "./analysis/routes.js";
import dashboardRoutes from "./dashboard/routes.js";

const app = express();

// The app runs behind a reverse proxy (for example Cloudflare in
// development and the production hosting proxy). Trust the first proxy
// so req.protocol respects X-Forwarded-Proto and HTTPS callback URLs are
// generated correctly.
app.set("trust proxy", 1);

const dashboardDistPath = path.resolve(
  __dirname,
  "../../dashboard/dist",
);

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

app.use(zendeskRoutes);

app.use(express.static(dashboardDistPath));

export default app;