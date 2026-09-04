import express from "express";
import zendeskRoutes from "./zendesk/routes.js";
import analysisRoutes from "./analysis/routes.js";

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true })); // for ZAF JWT POST form data
app.use("/api/analysis-runs", analysisRoutes);

app.get("/health", (_req, res) => {
  res.status(200).json({ status: "ok", service: "helpcenteriq-server" });
});

app.use(zendeskRoutes);

export default app;