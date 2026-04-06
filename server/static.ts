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

  app.use("*", (_req, res) => {
    res.sendFile(path.resolve(distPath, "index.html"));
  });
}
