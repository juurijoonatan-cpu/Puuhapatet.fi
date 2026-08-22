/**
 * PDF → sivukuvat, SELAIMESSA. Käytetään vain adminissa, sopimuksen latauksessa.
 *
 * MIKSI SELAIMESSA: palvelimella ei ole PDF-renderöijää (poppler/pdfium), eikä
 * sitä haluta sinne yhden latauksen takia — renderöijä on iso riippuvuus,
 * turva-altis ja se pitäisi pitää ajan tasalla. Perustaja lataa sopimuksen
 * omalta koneeltaan kertaalleen per keikka, joten työ kuuluu sinne.
 *
 * MIKSI EI ASIAKKAAN SELAIMESSA: sama renderöinti asiakkaan puhelimella olisi
 * satoja kilotavuja JS:ää joka kerta kun sopimus avataan — ja se pitäisi vielä
 * hakea eri originista (CORS). Rasterointi kertaalleen latausvaiheessa ratkaisee
 * saman asian pysyvästi, ja asiakas saa pelkät `<img>`-sivut.
 *
 * KOODI EI OLE PÄÄNITTEESSÄ: tämä moduuli importoidaan dynaamisesti
 * (`await import("@/lib/pdf-raster")`) vasta kun tiedosto on valittu, joten
 * pdf.js latautuu vain silloin kun sitä oikeasti käytetään.
 */

import * as pdfjs from "pdfjs-dist";
// Vite antaa työntekijätiedostolle oman URLin ja kopioi sen julkaisuun.
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { MAX_CONTRACT_PAGES, MAX_CONTRACT_UPLOAD_LEN } from "@shared/gig";

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

export interface RasterResult {
  /** Alkuperäinen tiedosto data URLina — tämä on se jonka asiakas lataa. */
  pdfDataUrl: string;
  /** Sivut JPEG-data URLeina, järjestyksessä. */
  pages: string[];
  /** Mihin leveyteen sivut lopulta piirrettiin (px). */
  renderedWidth: number;
}

/**
 * Laatuportaat. Ensimmäinen on se jota tavoitellaan; jos lataus ei mahdu
 * kattoon, pudotaan seuraavaan. Näin 20-sivuinen skannattu sopimus menee
 * läpi ilman että käyttäjän tarvitsee tietää mitään pakkaamisesta.
 */
const STEPS: { width: number; quality: number }[] = [
  { width: 1400, quality: 0.86 },
  { width: 1150, quality: 0.80 },
  { width: 950,  quality: 0.74 },
  { width: 800,  quality: 0.68 },
];

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onerror = () => reject(new Error("Tiedoston luku epäonnistui"));
    r.onload = () => resolve(String(r.result ?? ""));
    r.readAsDataURL(file);
  });
}

/**
 * Rasteroi PDF sivukuviksi ja palauta ne alkuperäisen tiedoston kanssa.
 *
 * `onProgress` kutsutaan jokaisen sivun jälkeen, jotta latauksesta voi näyttää
 * edistymisen — monisivuinen sopimus kestää sekunteja, ja pelkkä "Ladataan…"
 * on juuri se palaute josta ei tiedä onko mitään tapahtumassa.
 */
export async function rasterizePdf(
  file: File,
  onProgress?: (done: number, total: number) => void,
): Promise<RasterResult> {
  const pdfDataUrl = await fileToDataUrl(file);
  if (!pdfDataUrl.startsWith("data:application/pdf")) {
    throw new Error("Tiedosto ei ole PDF");
  }
  /**
   * ALKUPERÄINEN TIEDOSTO MITATAAN ENNEN KUIN MITÄÄN PIIRRETÄÄN.
   *
   * PDF kuljetetaan mukana aina, joten se on osa kattoa. Ilman tätä tarkistusta
   * 12 MB skannattu 40-sivuinen sopimus (n. 16 MB data URLina, jo yli katon)
   * piirsi silti 4 × 40 = 160 sivua ennen kuin totesi ettei mikään laatuporras
   * mahdu. Se on minuutteja työtä ja satoja megatavuja muistia vastauksen
   * eteen joka tiedettiin ensimmäisestä tavusta.
   */
  const mb = (n: number) => (n / 1_000_000).toFixed(1);
  if (pdfDataUrl.length >= MAX_CONTRACT_UPLOAD_LEN) {
    throw new Error(
      `PDF on yksinään liian suuri (${mb(pdfDataUrl.length)} MB, katto ${mb(MAX_CONTRACT_UPLOAD_LEN)} MB). `
      + "Pakkaa tiedosto tai jaa se kahteen osaan.",
    );
  }

  /**
   * `getDocument` palauttaa latausoperaation, ja SE omistaa Web Workerin.
   * Aiemmin tässä odotettiin suoraan `.promise`a try/finallyn ULKOPUOLELLA: jos
   * lataus hylkäsi (vioittunut tai salasanasuojattu PDF), `doc`ia ei syntynyt,
   * mikään ei kutsunut `destroy()`a, ja työntekijä jäi elämään koko istunnon
   * ajaksi — jokainen epäonnistunut yritys jätti oman.
   */
  const task = pdfjs.getDocument({ data: await file.arrayBuffer() });
  let doc: Awaited<typeof task.promise> | null = null;
  try {
    doc = await task.promise;
    if (doc.numPages < 1) throw new Error("PDF:ssä ei ole sivuja");
    if (doc.numPages > MAX_CONTRACT_PAGES) {
      throw new Error(`Sopimuksessa on ${doc.numPages} sivua — enintään ${MAX_CONTRACT_PAGES}`);
    }

    let lastTotal = 0;
    for (const step of STEPS) {
      const pages: string[] = [];
      for (let n = 1; n <= doc.numPages; n++) {
        const page = await doc.getPage(n);
        const unit = page.getViewport({ scale: 1 });
        const viewport = page.getViewport({ scale: step.width / unit.width });
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(viewport.width);
        canvas.height = Math.round(viewport.height);
        const ctx = canvas.getContext("2d", { alpha: false });
        if (!ctx) throw new Error("Selain ei osaa piirtää sivua");
        // Valkoinen pohja: PDF-sivu on läpinäkyvä, ja JPEG ei tunne
        // läpinäkyvyyttä — ilman tätä teksti piirtyisi mustalle.
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        await page.render({ canvasContext: ctx, viewport }).promise;
        const url = canvas.toDataURL("image/jpeg", step.quality);
        if (!url.startsWith("data:image/jpeg")) {
          throw new Error("Selain ei osaa tallentaa sivua JPEG-muodossa");
        }
        pages.push(url);
        /**
         * Vapauta muisti heti. Canvasin nollaaminen ei riitä: `getPage` palauttaa
         * välimuistitetun sivuolion, joka pitää kiinni operaatiolistastaan ja
         * sen purkamista kuvista kunnes `cleanup()` kutsutaan. 40 sivua
         * skannattua sopimusta on satoja megatavuja jos ne jäävät roikkumaan
         * — ja neljä laatuporrasta kertoo sen neljällä.
         */
        canvas.width = 0; canvas.height = 0;
        page.cleanup();
        onProgress?.(n, doc.numPages);
      }
      const total = pdfDataUrl.length + pages.reduce((sum, p) => sum + p.length, 0);
      lastTotal = total;
      if (total <= MAX_CONTRACT_UPLOAD_LEN) {
        return { pdfDataUrl, pages, renderedWidth: step.width };
      }
    }
    throw new Error(
      `Sopimus on liian suuri (${mb(lastTotal)} MB pienennettynäkin, katto ${mb(MAX_CONTRACT_UPLOAD_LEN)} MB). ` +
      "Pakkaa PDF tai jaa se kahteen osaan.",
    );
  } finally {
    // Työntekijä pysyy muuten elossa koko istunnon ajan. `task.destroy()`
    // hoitaa sekä dokumentin että työntekijän myös silloin kun `doc`ia ei
    // koskaan syntynyt.
    try { await task.destroy(); } catch { /* jo purettu */ }
  }
}
