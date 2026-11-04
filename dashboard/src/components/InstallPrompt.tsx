import { getInstallUrl } from "../api";

export default function InstallPrompt() {
  const connect = async () => {
    const url = await getInstallUrl();

    if (url) {
      window.open(url, "_blank", "noopener");
    }
  };

  return (
    <main
      style={{
        padding: "32px",
        fontFamily: "Arial, sans-serif",
        color: "#1f2937",
      }}
    >
      <h2>HelpCenterIQ is not connected yet</h2>
      <p>Connect your Zendesk account so HelpCenterIQ can analyze your tickets.</p>
      <button type="button" onClick={connect}>
        Connect Zendesk
      </button>
      <p>After you approve access in the new tab, reload this page.</p>
    </main>
  );
}