/**
 * Evästeetön kävijäseuranta.
 *
 * MIKSI OMA EIKÄ GOOGLE ANALYTICS: kolmannen osapuolen analytiikka tarkoittaa
 * evästeitä, suostumusbanneria ja henkilötietojen siirtoa ETA:n ulkopuolelle.
 * Tämä on ensimmäisen osapuolen mittaus omalle palvelimelle, ilman evästeitä.
 *
 * MITÄ SELAIMEEN TALLENNETAAN: ei mitään. Ei evästettä, ei localStoragea, ei
 * sessionStoragea, ei tunnistetta. Juuri siksi suostumusta ei tarvita:
 * evästesääntö koskee päätelaitteelle TALLENTAMISTA, eikä tässä tallenneta.
 *
 * MITÄ PALVELIMELLE LÄHETETÄÄN: polku, viittaava osoite ja utm_source. Ei
 * IP-osoitetta (palvelin näkee sen väistämättä muttei kirjoita sitä kantaan),
 * ei nimeä, ei mitään henkilötietoa.
 *
 * KUNNIOITETAAN KIELTOA: Do Not Track ja Global Privacy Control estävät
 * mittauksen kokonaan. Ne eivät ole lain vaatimus evästeettömälle
 * mittaukselle, mutta jos kävijä on nähnyt vaivaa kertoakseen kantansa, sitä
 * noudatetaan.
 */

import { API_BASE } from "./api";

/** Sisäiset työkalut eivät ole kävijäliikennettä. Palvelin torjuu nämä myös. */
const PRIVATE_PREFIXES = ["/admin", "/tyo", "/seuranta"];

function optedOut(): boolean {
  if (typeof navigator === "undefined") return true;
  const nav = navigator as Navigator & { globalPrivacyControl?: boolean; msDoNotTrack?: string };
  if (nav.globalPrivacyControl === true) return true;
  const dnt = nav.doNotTrack ?? nav.msDoNotTrack ?? (window as any).doNotTrack;
  return dnt === "1" || dnt === "yes";
}

/** utm_source, tai tyhjä jos sitä ei ole — palvelin päättelee lähteen muuten. */
function utmSource(): string | undefined {
  try {
    const v = new URLSearchParams(window.location.search).get("utm_source");
    return v ? v.slice(0, 60) : undefined;
  } catch { return undefined; }
}

// Sama polku peräkkäin ei ole uusi sivunlataus: wouter voi renderöidä
// uudestaan ilman että käyttäjä siirtyi minnekään.
let lastPath: string | null = null;

export function trackPageView(path: string): void {
  if (typeof window === "undefined" || optedOut()) return;
  if (PRIVATE_PREFIXES.some((p) => path === p || path.startsWith(p + "/"))) return;
  if (path === lastPath) return;
  lastPath = path;

  const body = JSON.stringify({
    path,
    referrer: document.referrer || undefined,
    source: utmSource(),
  });

  // sendBeacon selviää myös sivulta poistuttaessa eikä estä navigointia.
  // Jos se ei ole käytettävissä, fetch keepalivella — ja jos sekin kaatuu,
  // ei tehdä mitään: mittaus ei saa koskaan näkyä kävijälle.
  try {
    const url = `${API_BASE}/api/track`;
    if (navigator.sendBeacon) {
      navigator.sendBeacon(url, new Blob([body], { type: "application/json" }));
    } else {
      void fetch(url, {
        method: "POST", body, keepalive: true,
        headers: { "Content-Type": "application/json" },
      }).catch(() => {});
    }
  } catch { /* hiljaa */ }
}
