import React from "react";
import ReactDOM from "react-dom/client";
import DashboardPage from "./pages/DashboardPage";
import ConnectionBanner from "./components/ConnectionBanner";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ConnectionBanner />
    <DashboardPage />
  </React.StrictMode>
);