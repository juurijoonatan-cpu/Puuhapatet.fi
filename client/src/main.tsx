import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import { isStaleBuildError, recoverFromStaleBuild } from "./lib/stale-build";

// Uusi julkaisu poistaa vanhat koodipalaset GitHub Pagesista. Nämä kolme
// kuuntelijaa nappaavat "moduulia ei voitu ladata" -virheen ENNEN kuin se
// päätyy ErrorBoundarylle, ja lataavat sivun kertaalleen puhtaalta pöydältä.
// Ks. lib/stale-build.ts — siellä on koko ketju auki kirjoitettuna.

// Viten oma tapahtuma modulepreloadin kaatuessa. Ilman preventDefaultia Vite
// heittää virheen eteenpäin, jolloin näkyy valkoinen virhesivu.
window.addEventListener("vite:preloadError", (e) => {
  e.preventDefault();
  recoverFromStaleBuild();
});

// Dynaaminen import kaatuu myös Suspensen ulkopuolella (esim. reitin esilataus).
window.addEventListener("unhandledrejection", (e) => {
  if (isStaleBuildError(e.reason)) {
    e.preventDefault();
    recoverFromStaleBuild();
  }
});

window.addEventListener("error", (e) => {
  if (isStaleBuildError(e.error ?? e.message)) recoverFromStaleBuild();
});

createRoot(document.getElementById("root")!).render(<App />);

// Remove splash screen after React mounts
const splash = document.getElementById("pp-splash");
if (splash) {
  splash.style.opacity = "0";
  setTimeout(() => splash.remove(), 400);
}

// Register service worker for PWA caching
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {/* silent */});
  });
}
