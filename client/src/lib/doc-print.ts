/**
 * Itsenäisten sopimusdokumenttien avaus, lataus ja tulostus.
 *
 * MIKSI OMA MODUULI: sekä keikkasopimus (gig-contract-doc.ts) että
 * alihankkijasopimus (worker-contract-doc.ts) rakentavat itsenäisen HTML-sivun
 * ja avasivat sen täsmälleen samalla kolmella rivillä. Molemmissa oli myös
 * samat kaksi vikaa:
 *
 *   1. `w.document.write(html)` on poistuva rajapinta. Se toimii yhä, mutta
 *      Chrome varoittaa siitä konsolissa ja sen käyttäytyminen on rikki heti
 *      kun sivulla on `<script>`. Blob-URL tekee saman ilman varoitusta ja
 *      antaa selaimelle oikean dokumentin oikealla MIME-tyypillä.
 *
 *   2. Funktion nimi lupasi tulostuksen (`…ForPrint`) mutta se ei koskaan
 *      kutsunut `print()`. Käyttäjä painoi "Tulosta", sai auki välilehden ja
 *      joutui itse etsimään selaimen tulostuskomennon. Nyt tulostusikkuna
 *      aukeaa itse — mutta vasta kun sivu on latautunut, koska allekirjoitus
 *      on data-URL-kuva eikä sitä saa jäädä puuttumaan paperilta.
 */

/** Lataa itsenäinen HTML-dokumentti tiedostona. */
export function downloadHtmlDocument(html: string, filename: string) {
  if (typeof document === "undefined") return;
  const blob = new Blob([html], { type: "text/html;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/**
 * Avaa dokumentin uuteen välilehteen ja käynnistää tulostuksen.
 *
 * Jos ponnahdusikkuna on estetty, tiedosto ladataan sen sijaan — nappi ei jää
 * näyttämään siltä ettei se tee mitään.
 */
export function printHtmlDocument(html: string, fallbackFilename: string) {
  if (typeof window === "undefined") return;
  const blob = new Blob([html], { type: "text/html;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const w = window.open(url, "_blank");
  if (!w) {
    URL.revokeObjectURL(url);
    return downloadHtmlDocument(html, fallbackFilename);
  }
  // Odota kuvien latautumista ennen tulostusta: allekirjoitus on data-URL-kuva,
  // ja liian aikainen print() jättäisi sen tyhjäksi laatikoksi paperille.
  const start = () => {
    try { w.focus(); w.print(); } catch { /* käyttäjä sulki välilehden */ }
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  };
  w.addEventListener?.("load", start, { once: true });
  // Varmistus: jos load ehti tapahtua ennen kuuntelijan kiinnitystä.
  setTimeout(() => { if (!w.closed && w.document?.readyState === "complete") start(); }, 800);
}
