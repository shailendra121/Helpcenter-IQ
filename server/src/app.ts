import express from "express";

const app = express();

app.use(express.json());

app.get("/health", (_req, res) => {
  res.status(200).json({ status: "ok", service: "helpcenteriq-server" });
});

export default app;