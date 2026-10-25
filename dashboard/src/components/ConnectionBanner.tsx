import { useEffect, useState } from "react";
import { apiFetch } from "../api";

export default function ConnectionBanner() {
  const [text, setText] = useState("Checking backend connection...");

  useEffect(() => {
    apiFetch("/api/zaf/ping")
      .then(async (response) => {
        if (!response.ok) {
          setText(`Backend check failed (HTTP ${response.status})`);
          return;
        }
        const data = (await response.json()) as { subdomain: string };
        setText(`Backend connected (Zendesk account: ${data.subdomain})`);
      })
      .catch(() => setText("Backend unreachable"));
  }, []);

  return (
    <div style={{ padding: "6px 12px", fontSize: 12, background: "#f0f4f8" }}>
      {text}
    </div>
  );
}