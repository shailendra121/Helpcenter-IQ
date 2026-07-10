import "dotenv/config";
import express from "express";

const app = express();
const PORT = process.env.PORT || 4000;

app.use(express.json());

app.get("/health", (_req, res) => {
  res.status(200).json({ status: "ok", service: "helpcenteriq-server" });
});

app.listen(PORT, () => {
  console.log(`HelpCenterIQ server listening on port ${PORT}`);
});