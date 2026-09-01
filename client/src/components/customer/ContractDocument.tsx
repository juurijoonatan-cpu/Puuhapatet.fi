/**
 * SOPIMUSASIAKIRJA asiakkaan näkymässä — ladattu PDF sivukuvina.
 *
 * MIKSI KUVIA EIKÄ `<object type="application/pdf">`: se laatikko on selaimen
 * liitännäinen, eikä se ole lukupinta. iOS Safarissa se näyttää yhden sivun
 * lukittuun kehykseen josta ei pääse eteenpäin; Androidilla se piirtää oman
 * työkalupalkkinsa keskelle asiakkaan sivua. Kumpikaan ei ole "puhdas
 * syvennys". Sivut kuvina piirtyvät joka selaimessa samalla tavalla, ilman
 * JS:ää, ilman CORS-ehtoa ja ilman että asiakkaan puhelimelle lähetetään
 * PDF-renderöijää — rasterointi tehdään kertaluonteisesti latausvaiheessa.
 *
 * MIKSI EI SISÄKKÄISTÄ VIERITYSTÄ: asiakirja luetaan alaspäin ja allekirjoitus
 * on sen alla — juuri niin kuin paperilla. Vieritettävä laatikko sivun sisällä
 * on se yksityiskohta joka saa upotetun dokumentin tuntumaan rikkinäiseltä
 * puhelimella: kaksi vieritystä samassa eleessä. Sivut ovat siis normaalissa
 * virrassa, ja pitkän asiakirjan yli pääsee yhdellä napautuksella
 * ("Siirry allekirjoitukseen").
 *
 * TARKKA LUKEMINEN: sivun napautus avaa sen TÄYDESSÄ tarkkuudessa omaan
 * kerrokseen, jota voi vierittää molempiin suuntiin. Se on oikea zoom eikä
 * elekäsittelyä: kuva on 1400 px leveä, ja sen näyttäminen sellaisenaan on
 * kaikki mitä lukeminen vaatii.
 *
 * SIVUJEN KORKEUS VARATAAN ETUKÄTEEN. Ilman sitä `loading="lazy"` -sivut ovat
 * 0 px korkeita kunnes kuva saapuu, ja sivu hyppii lukijan alta. Suhde
 * mitataan ENSIMMÄISESTÄ sivusta ja sitä käytetään lopuille: yhden PDF:n sivut
 * ovat samankokoisia, joten yksi mittaus riittää.
 */

import { useEffect, useRef, useState } from "react";
import { CFONT, type CustomerTheme } from "@/lib/customer-theme";

/** Letter/A4 osuvat väliin; tätä käytetään kunnes sivu 1 on mitattu. */
const FALLBACK_RATIO = 1.33;

export interface ContractDocumentProps {
  theme: CustomerTheme;
  /** Sivumäärä palvelimelta (`GigPublicView.contractPdf.pages`). */
  pages: number;
  /**
   * Sivun kuvan osoite, 1-pohjainen.
   *
   * VERSIOINTI KUULUU KUTSUJALLE. Tämä komponentti ei muokkaa saamaansa
   * osoitetta: se ei tiedä sen muotoa, ja `?v=` liitettynä esimerkiksi
   * data-URLiin tuottaa kelvottoman osoitteen. Kutsuja tietää muodon ja lisää
   * versiotunnuksen itse — sitä TARVITAAN, koska sivujen osoite on muuten sama
   * merkkijono ennen ja jälkeen sopimuksen korvaamisen, ja
   * `Cache-Control: max-age=300` jättäisi vanhat sivut auki olevaan
   * välilehteen.
   */
  pageUrl: (page: number) => string;
  /** Alkuperäisen PDF:n latausosoite. */
  pdfUrl: string;
  /** Näytetään otsikkorivillä, esim. "PT-2026-04". */
  contractId?: string | null;
  /** Ankkuri johon "Siirry allekirjoitukseen" hyppää. */
  signAnchorId?: string;
}

export default function ContractDocument({
  theme, pages, pageUrl, pdfUrl, contractId, signAnchorId,
}: ContractDocumentProps) {
  const [ratio, setRatio] = useState<number | null>(null);
  /**
   * Sivut jotka eivät latautuneet.
   *
   * Aiemmin vain sivu 1 reagoi virheeseen. Sivu 2 jonka kuva ei tullut piirtyi
   * siis oikean kokoisena TYHJÄNÄ VALKOISENA arkkina — asiakas ei voi erottaa
   * sitä sopimuksen tyhjästä sivusta, ja pahimmillaan hän allekirjoittaa
   * asiakirjan jonka yhtä sivua hän ei nähnyt.
   */
  const [failedPages, setFailedPages] = useState<Record<number, true>>({});
  const [failed, setFailed] = useState(false);
  const [zoom, setZoom] = useState<number | null>(null);
  /**
   * Lukukerroksen koko. "fit" = sivu mahtuu leveyteen, "full" = alkuperäinen
   * 1400 px.
   *
   * MIKSI OLETUS ON "fit": 1:1 avautui puhelimella noin neljäsosaan sivun
   * leveydestä, ilman mitään vihjettä siitä että sivua voi vierittää
   * sivusuunnassa — se luki rikkinäiseltä. Nyt kerros avautuu koko sivuna, ja
   * lukukoko on yhden napautuksen päässä. Kaksi selvää tilaa, ei elekäsittelyä:
   * nipistyszoom toimii silti selaimen omana toimintona.
   */
  const [zoomFull, setZoomFull] = useState(false);
  const count = Math.max(0, Math.min(60, Math.floor(pages)));
  /**
   * Avoin sivu rajataan sivumäärään JOKA RENDERISSÄ eikä efektillä.
   *
   * Sivumäärä voi kutistua kesken lukemisen: sivu pollaa itseään kahden
   * minuutin välein, ja perustaja voi korvata nelisivuisen sopimuksen
   * kaksisivuisella. Ilman rajausta otsikossa luki "Sivu 4 / 2" ja kuva osoitti
   * sivuun jota ei ole.
   */
  const openPage = zoom == null ? null : Math.max(1, Math.min(count, zoom));

  // Esc sulkee tarkan lukukerroksen, kuten muutkin tämän matkan dialogit.
  useEffect(() => {
    if (zoom == null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setZoom(null);
      if (e.key === "ArrowRight") setZoom((p) => (p != null && p < count ? p + 1 : p));
      if (e.key === "ArrowLeft") setZoom((p) => (p != null && p > 1 ? p - 1 : p));
    };
    window.addEventListener("keydown", onKey);
    // Taustan vieritys pois, jotta zoom-kerroksen vieritys ei valu sivulle.
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [zoom, count]);

  const mono: React.CSSProperties = {
    margin: 0,
    fontFamily: "var(--font-jetbrains-mono, ui-monospace, SFMono-Regular, Menlo, monospace)",
    fontSize: 10, letterSpacing: "0.16em", textTransform: "uppercase", color: theme.muted,
  };

  if (count === 0 || failed) {
    // Metatieto sanoo että asiakirja on, mutta sivu ei piirtynyt. Ei jätetä
    // tyhjää laatikkoa: alkuperäinen tiedosto on aina saatavilla.
    return (
      <div style={{ fontFamily: CFONT }}>
        <p style={mono}>Sopimusasiakirja</p>
        <p style={{ margin: "8px 0 12px", fontSize: 13.5, color: theme.muted, lineHeight: 1.7 }}>
          Asiakirjan esikatselu ei latautunut. Voit avata sopimuksen tiedostona.
        </p>
        <DownloadButton theme={theme} href={pdfUrl} />
      </div>
    );
  }

  return (
    <div style={{ fontFamily: CFONT }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap", marginBottom: 12 }}>
        <div>
          <p style={mono}>Sopimusasiakirja</p>
          <p style={{ margin: "4px 0 0", fontSize: 13, color: theme.muted }}>
            {contractId ? `${contractId} · ` : ""}Ikkunanpesusopimus ({count} {count === 1 ? "sivu" : "sivua"})
          </p>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <DownloadButton theme={theme} href={pdfUrl} />
          {signAnchorId && (
            <a
              href={`#${signAnchorId}`}
              style={{
                display: "inline-flex", alignItems: "center", gap: 6, padding: "9px 14px",
                borderRadius: 10, border: "none", background: theme.navy,
                color: theme.onAccent,
                fontFamily: CFONT, fontSize: 13, fontWeight: 700, textDecoration: "none", whiteSpace: "nowrap",
              }}
            >
              Siirry allekirjoitukseen ↓
            </a>
          )}
        </div>
      </div>

      {/* SYVENNYS. Upotettu pinta on tummempi/hillitympi kuin kortti sen
          ympärillä, ja sisävarjo tekee siitä syvennyksen eikä toisen kortin —
          sivut lepäävät siinä kuin kansiossa. */}
      <div
        style={{
          background: theme.fill,
          borderRadius: 14,
          padding: 10,
          boxShadow: theme.wellShadow,
          display: "flex", flexDirection: "column", gap: 10,
        }}
      >
        {Array.from({ length: count }, (_, i) => i + 1).map((n) => (
          <button
            key={n}
            type="button"
            onClick={() => { setZoom(n); setZoomFull(false); }}
            aria-label={`Avaa sivu ${n} tarkemmin`}
            style={{
              display: "block", width: "100%", padding: 0, border: "none", cursor: "zoom-in",
              background: "#fff", borderRadius: 8, overflow: "hidden", position: "relative",
              boxShadow: "0 1px 4px rgba(0,0,0,0.18)",
              // Korkeus varataan ennen kuvan saapumista, jottei sivu hyppi.
              aspectRatio: `1 / ${ratio ?? FALLBACK_RATIO}`,
            }}
          >
            <img
              src={pageUrl(n)}
              alt={`Sopimuksen sivu ${n} / ${count}`}
              // Ensimmäinen sivu heti, loput vasta kun niitä lähestytään:
              // nelisivuinen sopimus on satoja kilotavuja kuvina.
              loading={n === 1 ? "eager" : "lazy"}
              decoding="async"
              onLoad={(e) => {
                if (n !== 1) return;
                const el = e.currentTarget;
                if (el.naturalWidth > 0) setRatio(el.naturalHeight / el.naturalWidth);
              }}
              // Sivu 1 pettäessä koko asiakirja on tavoittamattomissa; yksi
              // keskimmäinen sivu on eri asia, ja se merkitään erikseen.
              onError={() => (n === 1 ? setFailed(true) : setFailedPages((f) => ({ ...f, [n]: true })))}
              style={{ display: "block", width: "100%", height: "auto", opacity: failedPages[n] ? 0 : 1 }}
            />
            {failedPages[n] && (
              <span
                style={{
                  position: "absolute", inset: 0, display: "flex", flexDirection: "column",
                  alignItems: "center", justifyContent: "center", gap: 6, padding: 16,
                  textAlign: "center", color: "#8C8A82", fontSize: 12.5, lineHeight: 1.5,
                }}
              >
                <strong style={{ color: "#1A1A1A", fontSize: 13 }}>Sivu {n} ei latautunut</strong>
                Avaa sopimus tiedostona — koko asiakirja on siinä.
              </span>
            )}
          </button>
        ))}
      </div>

      <p style={{ margin: "10px 0 0", fontSize: 12, color: theme.muted, lineHeight: 1.6 }}>
        Napauta sivua nähdäksesi sen tarkemmin. Lue sopimus huolellisesti — allekirjoittamalla
        alla vahvistat hyväksyväsi tämän asiakirjan ehdot.
      </p>

      {/* TARKKA LUKUKERROS. Kuva sellaisenaan (1400 px), vieritettävissä
          molempiin suuntiin. Ei elekäsittelyä: selaimen oma vieritys ja
          nipistyszoom tekevät työn, ja ne toimivat joka laitteella. */}
      {openPage != null && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`Sopimuksen sivu ${openPage}`}
          style={{
            position: "fixed", inset: 0, zIndex: 90,
            background: "rgba(12,12,14,0.92)", overflow: "auto",
            WebkitOverflowScrolling: "touch",
          }}
        >
          <div style={{ minWidth: "100%", display: "inline-block", padding: "56px 12px 24px" }}>
            <img
              src={pageUrl(openPage)}
              alt={`Sopimuksen sivu ${openPage} / ${count}`}
              style={{
                display: "block", height: "auto", background: "#fff", borderRadius: 4,
                ...(zoomFull
                  ? { width: 1400, maxWidth: "none" }
                  // "fit": leveys ruudun mukaan, mutta ei koskaan yli
                  // alkuperäisen — venytetty rasterikuva on sumea.
                  : { width: "100%", maxWidth: 1400 }),
              }}
            />
          </div>
          {/* Ohjaimet pysyvät paikallaan vieritettäessä. */}
          <div
            style={{
              position: "fixed", top: "max(10px, env(safe-area-inset-top))", left: 12, right: 12,
              display: "flex", alignItems: "center", gap: 8,
            }}
          >
            <span style={{ fontFamily: CFONT, fontSize: 12.5, fontWeight: 700, color: "#fff", background: "rgba(0,0,0,0.55)", borderRadius: 999, padding: "6px 12px", whiteSpace: "nowrap" }}>
              Sivu {openPage} / {count}
            </span>
            <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
              <OverlayButton
                onClick={() => setZoomFull((v) => !v)}
                label={zoomFull ? "Sovita ruudulle" : "Suurenna lukukokoon"}
              >
                {zoomFull ? "⤡" : "⤢"}
              </OverlayButton>
              <OverlayButton disabled={openPage <= 1} onClick={() => { setZoom((p) => (p ?? 1) - 1); setZoomFull(false); }} label="Edellinen sivu">‹</OverlayButton>
              <OverlayButton disabled={openPage >= count} onClick={() => { setZoom((p) => (p ?? 1) + 1); setZoomFull(false); }} label="Seuraava sivu">›</OverlayButton>
              <OverlayButton onClick={() => setZoom(null)} label="Sulje">✕</OverlayButton>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function DownloadButton({ theme, href }: { theme: CustomerTheme; href: string }) {
  return (
    <a
      href={href}
      style={{
        display: "inline-flex", alignItems: "center", gap: 7, padding: "9px 14px",
        borderRadius: 10, border: `1px solid ${theme.hair}`, background: theme.card,
        color: theme.ink, fontFamily: CFONT, fontSize: 13, fontWeight: 600,
        textDecoration: "none", whiteSpace: "nowrap",
      }}
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={theme.navy} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" />
      </svg>
      Lataa PDF
    </a>
  );
}

function OverlayButton({
  onClick, label, disabled, children,
}: { onClick: () => void; label: string; disabled?: boolean; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      style={{
        width: 38, height: 38, borderRadius: 999, border: "none", cursor: disabled ? "default" : "pointer",
        background: "rgba(255,255,255,0.16)", color: "#fff", fontSize: 18, lineHeight: 1,
        display: "flex", alignItems: "center", justifyContent: "center",
        opacity: disabled ? 0.35 : 1,
      }}
    >
      {children}
    </button>
  );
}
