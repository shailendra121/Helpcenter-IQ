import express from "express";
import zendeskRoutes from "./zendesk/routes.js";

const app = express();
app.use(express.json());

app.get("/health", (_req, res) => {
  res.status(200).json({ status: "ok", service: "helpcenteriq-server" });
});

app.use(zendeskRoutes);
app.use(express.urlencoded({ extended: true })); // for ZAF JWT POST form data

export default app;
