import express, { type Express } from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function serveStatic(app: Express) {
  const distPath = path.resolve(__dirname, "public");

  // Renderissä staattisia tiedostoja ei ole (GitHub Pages hoitaa ne)
  // — skipataan hiljaa jos hakemistoa ei löydy
  if (!fs.existsSync(distPath)) {
    app.use("*", (_req, res) => {
      res.status(404).json({ error: "Static files not available — API only mode" });
    });
    return;
  }

  app.use(express.static(distPath));

  app.use("*", (req, res) => {
    // Puuttuva hashattu koodipalanen EI saa saada index.html:ää tilalleen.
    // Aiemmin kaikki polut vastasivat 200 + HTML, joten julkaisun jälkeen vanhaa
    // palasta pyytänyt selain sai JS:n paikalle HTML-sivun ("Importing a module
    // script failed") — ja service worker tallensi sen pysyvästi välimuistiin
    // JS:n nimellä. 404 kertoo totuuden ja antaa asiakaspuolen itsekorjauksen
    // (client/src/lib/stale-build.ts) tehdä työnsä.
    if (/\.(js|mjs|css|map|json|png|jpe?g|svg|webp|avif|woff2?|ttf|ico|mp4|webm)$/i.test(req.originalUrl.split("?")[0])) {
      res.status(404).type("txt").send("Not found");
      return;
    }
    res.sendFile(path.resolve(distPath, "index.html"));
  });
}
