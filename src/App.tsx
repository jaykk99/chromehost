import { useEffect, useState } from "react";
import SitesPanel from "./components/SitesPanel";
import PreviewPage from "./components/PreviewPage";
import ChromeHostPanel from "./components/ChromeHostPanel";
import SelfContainedBanner from "./SelfContainedBanner";

/**
 * ChromeHost — self-hosted app platform (forked from Monico Labs).
 *
 * Hash routing keeps every route working on ANY static host with zero
 * server configuration. `#/chromehost` renders the ChromeHost control
 * panel (API keys, app deploys, remote management).
 */
function useHashRoute(): string {
  const [hash, setHash] = useState(() => window.location.hash);
  useEffect(() => {
    const onChange = () => setHash(window.location.hash);
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  return hash;
}

function App() {
  const hash = useHashRoute();
  if (hash.startsWith("#/preview/")) {
    return (
      <>
        <SelfContainedBanner />
        <PreviewPage deploymentId={hash.slice("#/preview/".length)} />
      </>
    );
  }
  if (hash.startsWith("#/chromehost")) {
    return (
      <>
        <SelfContainedBanner />
        <ChromeHostPanel />
      </>
    );
  }
  return (
    <>
      <SelfContainedBanner />
      <SitesPanel />
    </>
  );
}

export default App;
