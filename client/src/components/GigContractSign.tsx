/**
 * Customer contract signing intro for the public live link.
 *
 * Shown before the live tracking view opens: the customer reads the contract,
 * fills the pre-questionnaire (tilaajan tiedot), draws a signature and accepts.
 * On success the parent reloads the gig and the live view takes over.
 *
 * Styled to match gig-live.tsx — sama paperi, sama kirjasin, samat poletit
 * (`@/lib/customer-theme`), koska allekirjoitus ja seuranta ovat asiakkaalle
 * yksi ja sama matka.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { api, type GigPublicView, type GigSignPayload } from "@/lib/api";
import { downloadGigContract } from "@/lib/gig-contract-doc";
import { CT, CFONT } from "@/lib/customer-theme";
import ContractDocument from "@/components/customer/ContractDocument";
import { FR8_CONTRACT_ID } from "@shared/gig";

const T = CT;
const FONT = CFONT;

/**
 * SE YKSI FYYSINEN SOPIMUS-PDF joka tässä repossa on: FR8:n PT-2026-02.
 *
 * TÄMÄ OLI TIETOVUOTO. Polku oli moduulitason vakio jota EI sidottu keikkaan
 * lainkaan, ja `gig-live.tsx` ohjaa tähän komponenttiin JOKAISEN keikan jonka
 * sopimus on allekirjoittamatta. Uuden asiakkaan (yhdistys) linkki näytti siis
 * FR8:n allekirjoitetun 8-sivuisen sopimuksen kokonaisuudessaan: tilaajan nimi,
 * Y-tunnus, yhteyshenkilö, osoite, sektorien hinnoittelu. Ympäröivä React-teksti
 * luki oikein keikan omaa blobia, joten vika ei näkynyt kuin dokumentissa.
 *
 * Portti on `contractId`, koska tämä tiedosto ON tuo sopimus. Sama kuvio kuin
 * P2-sopimuksella `gig-live.tsx`:ssä (`data.isFixedDeal`) ja tilaajan
 * esitäytöllä alla.
 *
 * TÄMÄ ON PERINTÖTAPAUS, EI MALLI. Muut keikat saavat sopimuksensa liittämällä
 * PDF:n adminissa (`GigData.contractFile`), jolloin tiedosto on kannassa ja
 * asiakkaan oman tokenin takana. Committattua PDF:ää ei enää tarvita eikä uutta
 * pidä lisätä: `client/public/` on julkinen verkkosivu ja tämä repo on julkinen,
 * eli sinne viety sopimus on kenen tahansa luettavissa ilman mitään linkkiä.
 * Tämä yksi jää siksi, että FR8:n sopimus on jo täällä ja sen pudottaminen
 * näkyvistä olisi vienyt asiakkaalta hänen oman asiakirjansa.
 */
const FR8_CONTRACT_PDF_URL = "/contracts/PT-2026-02.pdf";
const FR8_CONTRACT_PAGES = 8;

/**
 * Sopimustunnus näytettäväksi. Kenttään on kirjoitettu myös pelkkä viiva
 * ("-"), ja se päätyi otsikkoon muodossa "- · Tarjous & sopimus". Viiva
 * tarkoittaa "ei tunnusta", ei tunnusta nimeltä "-".
 */
function displayContractId(raw?: string | null): string | null {
  const t = (raw ?? "").trim();
  if (!t || t === "-" || t === "–" || t === "—") return null;
  return t;
}

interface Props {
  token: string;
  view: GigPublicView;
  onSigned: () => void;
  /**
   * `page`  koko sivu: asiakkaan linkki avautuu tähän eikä seurantaan (portti).
   * `modal` sama sisältö dialogin sisällä, kun seuranta on jo auki ja sopimus
   *         nousee siihen popuppina. Kuori ja otsikko tulevat silloin
   *         dialogilta, joten ne jätetään tästä pois.
   *
   * PINTA PYSYY VAALEANA MYÖS TUMMALLA TEEMALLA, tarkoituksella: tämä on
   * allekirjoitettava asiakirja, ja paperi on oikea metafora sille. Tumman
   * teeman keikalla dialogi on tumman taustan päällä oleva vaalea arkki.
   */
  variant?: "page" | "modal";
}

/** Drawable signature field (mouse + touch). */
function SignaturePad({ onChange }: { onChange: (dataUrl: string) => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const last = useRef<{ x: number; y: number } | null>(null);
  const [empty, setEmpty] = useState(true);

  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    const ratio = window.devicePixelRatio || 1;
    const rect = c.getBoundingClientRect();
    c.width = rect.width * ratio;
    c.height = rect.height * ratio;
    const g = c.getContext("2d");
    if (g) {
      g.scale(ratio, ratio);
      g.lineCap = "round";
      g.lineJoin = "round";
      g.lineWidth = 2.2;
      g.strokeStyle = T.ink;
    }
  }, []);

  const posOf = (e: React.PointerEvent) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };
  const start = (e: React.PointerEvent) => {
    e.preventDefault();
    drawing.current = true;
    last.current = posOf(e);
    (e.target as Element).setPointerCapture?.(e.pointerId);
  };
  const move = (e: React.PointerEvent) => {
    if (!drawing.current) return;
    const g = canvasRef.current?.getContext("2d");
    if (!g || !last.current) return;
    const p = posOf(e);
    g.beginPath();
    g.moveTo(last.current.x, last.current.y);
    g.lineTo(p.x, p.y);
    g.stroke();
    last.current = p;
    if (empty) setEmpty(false);
  };
  const end = () => {
    if (!drawing.current) return;
    drawing.current = false;
    last.current = null;
    const c = canvasRef.current;
    if (c) onChange(c.toDataURL("image/png"));
  };
  const clear = useCallback(() => {
    const c = canvasRef.current;
    const g = c?.getContext("2d");
    if (c && g) g.clearRect(0, 0, c.width, c.height);
    setEmpty(true);
    onChange("");
  }, [onChange]);

  return (
    <div>
      <div style={{ position: "relative", borderRadius: 12, border: `1px solid ${T.hair}`, background: T.paper, overflow: "hidden" }}>
        <canvas
          ref={canvasRef}
          onPointerDown={start}
          onPointerMove={move}
          onPointerUp={end}
          onPointerLeave={end}
          style={{ display: "block", width: "100%", height: 150, touchAction: "none", cursor: "crosshair" }}
        />
        {empty && (
          <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", pointerEvents: "none", color: T.muted, fontSize: 13 }}>
            Piirrä allekirjoitus tähän
          </div>
        )}
      </div>
      <button type="button" onClick={clear} style={{ marginTop: 8, background: "none", border: "none", color: T.muted, fontSize: 12, cursor: "pointer", textDecoration: "underline", padding: 0 }}>
        Tyhjennä
      </button>
    </div>
  );
}

/** Ankkurin id allekirjoituspaneelille — "Siirry allekirjoitukseen" osoittaa tähän. */
const SIGN_ANCHOR = "pp-allekirjoitus";

function Panel({ children, style, id }: { children: React.ReactNode; style?: React.CSSProperties; id?: string }) {
  return (
    <div id={id} style={{ background: T.card, border: `1px solid ${T.hair}`, borderRadius: 14, padding: 20, marginBottom: 16, ...style }}>
      {children}
    </div>
  );
}

const labelCss: React.CSSProperties = { display: "block", fontSize: 12, color: T.muted, marginBottom: 6 };
const inputCss: React.CSSProperties = {
  width: "100%", padding: "11px 13px", borderRadius: 10, border: `1px solid ${T.hair}`,
  background: T.paper, color: T.ink, fontSize: 14, fontFamily: FONT, outline: "none",
};

/**
 * POISTETTU: FR8:n tilaajan esitäyttö (nimi, Y-tunnus, yhteyshenkilö, osoite,
 * sähköposti kovakoodattuna). Se oli toisen asiakkaan tietoa tässä
 * komponentissa, ja käytännössä kuollutta koodia: palvelin lähettää `company`n
 * aina (`name` putoaa takaisin asiakasrivin nimeen), joten varahaara ei
 * laukennut. Keikan omat tiedot tulevat blobista kuten pitääkin.
 */

/** Pull a clean person name out of a "Nimi, +358…" contact string. */
function cleanSignerName(s?: string | null): string {
  return (s || "").replace(/[·,;|].*$/, "").replace(/\+?\d[\d\s-]{4,}/g, "").trim();
}

export default function GigContractSign({ token, view, onSigned, variant = "page" }: Props) {
  const isModal = variant === "modal";
  const base = view.company;
  const contractNo = displayContractId(view.contractId);
  /**
   * Sopimusasiakirja. Etusija: keikalle LIITETTY PDF → FR8:n vanha staattinen
   * PDF → keikan oma sopimusteksti → ei asiakirjaa. Toisen keikan tiedostoa ei
   * näytetä koskaan.
   *
   * LIITETTY TIEDOSTO VOITTAA STAATTISEN. Jos FR8:lle joskus liitetään sopimus
   * tätä kautta, se on tuoreempi kuin repoon committattu PDF, ja kaksi eri
   * asiakirjaa samasta sopimuksesta on pahempi kuin kumpikaan yksin.
   */
  const fr8PdfUrl = view.contractId === FR8_CONTRACT_ID ? FR8_CONTRACT_PDF_URL : null;
  /**
   * Keikan oma liitetty sopimus. Osoite johdetaan TOKENISTA, joten se ei voi
   * osoittaa toisen keikan tiedostoon — palvelin hakee sen sillä samalla
   * tokenilla jolla asiakas on tällä sivulla.
   */
  const ownPdfUrl = view.contractFile ? api.contractFileUrlForGig(token) : null;
  const pdfUrl = ownPdfUrl ?? fr8PdfUrl;
  /**
   * SIVUT KUVINA, jos sopimus on rasteroitu latausvaiheessa.
   *
   * Tämä korvaa `<object type="application/pdf">` -upotuksen. Upotuksen oma
   * kommentti myöntää ongelman: se on kiinteän korkuinen ruutu, joka on
   * puhelimessa neulansilmä eikä monessa selaimessa vierity lainkaan — ja
   * "Avaa koko näytöllä" luovuttaa asiakkaan selaimen omalle näyttäjälle
   * kesken sopimuksen lukemista. Sivut kuvina ovat sivun normaalissa virrassa:
   * asiakas vierittää sopimuksen läpi ja allekirjoitus on sen alla, kuten
   * paperilla.
   *
   * PUUTTUVA SIVUMÄÄRÄ = ennen rasterointia liitetty sopimus. Silloin näytetään
   * entinen upotus muuttumattomana; uusi lataus tuo sivut mukanaan.
   */
  const pagedDoc = view.contractFile && view.contractFile.pages > 0 ? view.contractFile : null;
  const hasOwnText = !!view.contractText?.trim();
  const [customer, setCustomer] = useState({
    legalName: base?.name ?? "",
    businessId: base?.businessId ?? "",
    billingAddress: base?.address ?? "",
    eInvoice: base?.email ?? "",
    contactPerson: base?.contact ?? "",
  });
  // The signer is the company's authorised representative (the orderer on the
  // physical paper). Prefill from the contact person; the contract party stays
  // the company (legalName).
  const [signerName, setSignerName] = useState(cleanSignerName(base?.contact));
  const [signerTitle, setSignerTitle] = useState(base?.contact ? "Tilaajan edustaja" : "");
  // Allekirjoituspaikka: asiakas kirjoittaa oman. Oletus oli "Helsinki",
  // eli FR8:n kaupunki jokaisen keikan lomakkeella.
  const [place, setPlace] = useState("");
  const [signatureDataUrl, setSignatureDataUrl] = useState("");
  const [agreed, setAgreed] = useState(false);
  const [showContract, setShowContract] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  // Kirjasin tulee index.html:stä — ei ajonaikaista fonttihakua.
  useEffect(() => { document.title = "Puuhapatet — Sopimuksen hyväksyntä"; }, []);

  const set = (k: keyof typeof customer) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setCustomer((v) => ({ ...v, [k]: e.target.value }));

  const submit = async () => {
    setError("");
    if (!customer.legalName.trim()) return setError("Täytä tilaajan virallinen nimi.");
    if (!signerName.trim()) return setError("Täytä allekirjoittajan nimi.");
    if (!signatureDataUrl) return setError("Piirrä allekirjoitus allekirjoituskenttään.");
    if (!agreed) return setError("Vahvista hyväksyntä rastittamalla suostumus.");

    const payload: GigSignPayload = {
      signerName: signerName.trim(),
      signerTitle: signerTitle.trim() || undefined,
      place: place.trim() || undefined,
      signatureDataUrl,
      acceptedSectorIds: view.sectors.map((s) => s.id),
      customer: {
        legalName: customer.legalName.trim(),
        businessId: customer.businessId.trim() || undefined,
        billingAddress: customer.billingAddress.trim() || undefined,
        eInvoice: customer.eInvoice.trim() || undefined,
        contactPerson: customer.contactPerson.trim() || undefined,
      },
    };
    setSubmitting(true);
    const res = await api.signGig(token, payload);
    setSubmitting(false);
    if (res.ok) onSigned();
    else setError(res.error || "Allekirjoituksen tallennus epäonnistui. Yritä uudelleen.");
  };

  return (
    <div style={isModal
      ? { background: T.paper, fontFamily: FONT, color: T.ink }
      : { minHeight: "100vh", background: T.paper, fontFamily: FONT, color: T.ink, padding: "28px 16px 64px" }}>
      <style>{`@keyframes ppRise{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:translateY(0)}}.pp-rise{animation:ppRise .45s ease both}`}</style>
      <div style={{ maxWidth: 640, margin: "0 auto" }}>

        {/* Header — dialogissa otsikko on dialogin oma. */}
        {!isModal && (
        <div className="pp-rise" style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20 }}>
          <div>
            <p style={{ margin: 0, fontSize: 22, fontWeight: 800, letterSpacing: "-0.3px" }}>Puuhapatet</p>
            <p style={{ margin: "4px 0 0", fontSize: 13, color: T.muted }}>
              {contractNo ? `${contractNo} · ` : ""}Tarjous & sopimus
            </p>
          </div>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11, fontWeight: 600, color: T.navy, letterSpacing: "0.06em", border: `1px solid ${T.hair}`, borderRadius: 999, padding: "5px 10px", background: T.card }}>
            ALLEKIRJOITETTAVANA
          </span>
        </div>
        )}

        <Panel style={{ animationDelay: ".04s" }}>
          <p style={{ margin: 0, fontSize: 14, lineHeight: 1.7 }}>
            Tervetuloa.{" "}
            {view.companyName
              ? <>Tämä on <strong>{view.companyName}</strong>:n ja Puuhapatetin välinen ikkunanpesusopimus.</>
              : <>Tämä on Puuhapatetin ikkunanpesusopimus.</>}{" "}
            {isModal
              ? "Työ on jo käynnissä ja näet sen etenemisen tämän ikkunan takana. Lue sopimus, täytä tilaajan tiedot ja allekirjoita alla — seuranta jatkuu koko ajan auki."
              : "Lue sopimus, täytä tilaajan tiedot ja allekirjoita alla. Hyväksynnän jälkeen pääset suoraan reaaliaikaiseen seurantapaneeliin, jossa näet työn etenemisen ja kertyvän summan suhteessa sovittuun kokonaishintaan."}
          </p>
        </Panel>

        {/* ── SOPIMUSASIAKIRJA ────────────────────────────────────────────
            Kolme tapausta, tässä järjestyksessä. Toisen keikan tiedostoa ei
            näytetä koskaan — se oli tämän kohdan vika. */}

        {/* 1a. Liitetty sopimus SIVUINA — puhdas syvennys, ei selaimen
                PDF-laatikkoa. Allekirjoitus on sivujen alla, kuten paperilla. */}
        {pagedDoc && (
          <Panel>
            <ContractDocument
              theme={T}
              pages={pagedDoc.pages}
              // Tiedoston koko versiotunnuksena osoitteessa: se vaihtuu kun
              // sopimus korvataan, joten auki oleva välilehti ei jää näyttämään
              // vanhoja sivuja välimuistista (`max-age=300`).
              pageUrl={(n) => `${api.contractPageUrlForGig(token, n)}?v=${pagedDoc.bytes}`}
              pdfUrl={api.contractFileUrlForGig(token, { download: true })}
              contractId={contractNo}
              signAnchorId={SIGN_ANCHOR}
            />
          </Panel>
        )}

        {/* 1b. Vanha upotus: FR8:n staattinen PDF, tai ennen rasterointia
                liitetty sopimus. */}
        {!pagedDoc && pdfUrl && (
          <Panel>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 12, flexWrap: "wrap" }}>
              <div>
                <p style={mono}>SOPIMUSASIAKIRJA</p>
                <p style={{ margin: "4px 0 0", fontSize: 13, color: T.muted }}>
                  {contractNo ? `${contractNo} · ` : ""}Ikkunanpesusopimus
                  {/* Sivumäärä vain siitä yhdestä tiedostosta jonka sivumäärän
                      tiedämme. Liitetystä PDF:stä kerrotaan koko: sivumäärää ei
                      lueta tiedostosta, eikä arvattu luku kuulu sopimuksen
                      viereen. */}
                  {ownPdfUrl
                    ? view.contractFile!.bytes > 0 ? ` (${fmtBytes(view.contractFile!.bytes)})` : ""
                    : ` (${FR8_CONTRACT_PAGES} sivua)`}
                </p>
              </div>
              <a
                // Liitetty tiedosto: lataus kulkee palvelimen kautta (`dl=1`),
                // koska `download`-attribuutti ei toimi originin yli — nimi
                // tulee `Content-Disposition`ista. Staattinen FR8:n PDF on
                // samassa originissa, joten siellä attribuutti riittää.
                href={ownPdfUrl ? api.contractFileUrlForGig(token, { download: true }) : pdfUrl}
                // Tiedostonimi keikan mukaan: yleisnimellä "Puuhapatet-sopimus.pdf"
                // asiakas tallensi sopimuksen josta ei näe kenen se on.
                download={ownPdfUrl ? undefined : `Puuhapatet-sopimus-${contractNo ?? view.companyName ?? "keikka"}.pdf`}
                style={{ display: "inline-flex", alignItems: "center", gap: 7, padding: "9px 14px", borderRadius: 10, border: `1px solid ${T.hair}`, background: T.paper, color: T.ink, fontFamily: FONT, fontSize: 13, fontWeight: 600, textDecoration: "none", whiteSpace: "nowrap" }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={T.navy} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg>
                Lataa PDF
              </a>
            </div>
            <object
              data={`${pdfUrl}#view=FitH`}
              type="application/pdf"
              style={{ width: "100%", height: 520, borderRadius: 10, border: `1px solid ${T.hair}`, background: T.paper, display: "block" }}
            >
              <div style={{ padding: 24, textAlign: "center", fontSize: 13.5, color: T.muted }}>
                Selaimesi ei näytä PDF:ää suoraan.{" "}
                <a href={pdfUrl} target="_blank" rel="noreferrer" style={{ color: T.navy, fontWeight: 600 }}>Avaa sopimus tästä</a>.
              </div>
            </object>
            {/* KOKO NÄYTÖLLE. Upotus on 520 px korkea ruutu, ja puhelimessa
                monisivuinen sopimus on siinä neulansilmä — moni selain ei
                myöskään vieritä upotettua PDF:ää lainkaan. Linkki avaa saman
                tiedoston selaimen omaan näyttäjään, jossa sivut selaa
                normaalisti. Ei korvaa upotusta: sopimus näkyy heti, tämä on
                lisätie sille joka haluaa lukea sen kunnolla. */}
            <p style={{ margin: "10px 0 0", fontSize: 12.5 }}>
              <a href={pdfUrl} target="_blank" rel="noreferrer" style={{ color: T.navy, fontWeight: 600, textDecoration: "none" }}>
                Avaa koko näytöllä →
              </a>
            </p>
            <p style={{ margin: "10px 0 0", fontSize: 12, color: T.muted, lineHeight: 1.6 }}>
              Lue sopimus huolellisesti. Allekirjoittamalla alla vahvistat hyväksyväsi tämän asiakirjan ehdot.
            </p>
          </Panel>
        )}

        {/* 2. Ei PDF:ää, mutta keikan oma sopimusteksti — se ON tässä
               tapauksessa asiakirja, joten se näytetään auki eikä
               pudotusvalikon takana, ja siitä saa oman kopion. */}
        {!pdfUrl && hasOwnText && (
          <Panel>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 12, flexWrap: "wrap" }}>
              <div>
                <p style={mono}>SOPIMUSASIAKIRJA</p>
                <p style={{ margin: "4px 0 0", fontSize: 13, color: T.muted }}>
                  {contractNo ? `${contractNo} · ` : ""}Ikkunanpesusopimus
                </p>
              </div>
              <button
                type="button"
                onClick={() => downloadGigContract({
                  contractId: contractNo,
                  companyName: view.companyName,
                  description: view.description,
                  vatNote: view.vatNote,
                  customerNote: view.customerNote,
                  contractText: view.contractText,
                  sectors: view.sectors.map((x) => ({ name: x.name, unitLabel: x.unitLabel, total: x.total, unitPriceCents: x.unitPriceCents })),
                  capCents: view.sectors.reduce((sum, x) => sum + x.total * x.unitPriceCents, 0),
                })}
                style={{ display: "inline-flex", alignItems: "center", gap: 7, padding: "9px 14px", borderRadius: 10, border: `1px solid ${T.hair}`, background: T.paper, color: T.ink, fontFamily: FONT, fontSize: 13, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap" }}
              >
                Lataa sopimus
              </button>
            </div>
            <pre style={{ margin: 0, whiteSpace: "pre-wrap", fontFamily: FONT, fontSize: 13.5, lineHeight: 1.7, color: T.ink, maxHeight: 520, overflowY: "auto" }}>
              {view.contractText}
            </pre>
            <p style={{ margin: "10px 0 0", fontSize: 12, color: T.muted, lineHeight: 1.6 }}>
              Lue sopimus huolellisesti. Allekirjoittamalla alla vahvistat hyväksyväsi nämä ehdot.
            </p>
          </Panel>
        )}

        {/* 3. Ei asiakirjaa lainkaan. Sanotaan se suoraan sen sijaan että
               näytettäisiin jonkun toisen paperi. */}
        {!pdfUrl && !hasOwnText && (
          <Panel>
            <p style={mono}>SOPIMUSASIAKIRJA</p>
            <p style={{ margin: "8px 0 0", fontSize: 13.5, color: T.muted, lineHeight: 1.7 }}>
              Sopimusasiakirja toimitetaan erikseen. Alla hyväksyt työn tehtäväksi tässä
              näkymässä esitetyillä ehdoilla.
            </p>
          </Panel>
        )}

        {/* Koko sopimusteksti — vain kun asiakirja on PDF. Tapauksessa 2 teksti
            ON asiakirja ja se näkyy jo yllä, joten sitä ei toisteta. */}
        {(pagedDoc || pdfUrl) && view.contractText && (
          <Panel>
            <button
              type="button"
              onClick={() => setShowContract((v) => !v)}
              style={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%", background: "none", border: "none", padding: 0, cursor: "pointer", color: T.ink, fontFamily: FONT }}
            >
              <span style={mono}>KOKO SOPIMUSTEKSTI</span>
              <span style={{ fontSize: 13, color: T.muted }}>{showContract ? "Piilota ▲" : "Näytä ▼"}</span>
            </button>
            {showContract && (
              <pre style={{ margin: "12px 0 0", whiteSpace: "pre-wrap", fontFamily: FONT, fontSize: 13.5, lineHeight: 1.7, color: T.ink, maxHeight: 360, overflowY: "auto" }}>
                {view.contractText}
              </pre>
            )}
          </Panel>
        )}

        {/* Pre-questionnaire */}
        <Panel>
          <p style={mono}>TILAAJAN TIEDOT</p>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 14, marginTop: 12 }}>
            <div style={{ gridColumn: "1 / -1" }}>
              <label style={labelCss}>Tilaajan virallinen nimi *</label>
              <input style={inputCss} value={customer.legalName} onChange={set("legalName")} placeholder="Yrityksen tai yhdistyksen virallinen nimi" />
            </div>
            <div>
              <label style={labelCss}>Y-tunnus</label>
              <input style={inputCss} value={customer.businessId} onChange={set("businessId")} placeholder="0000000-0" />
            </div>
            <div>
              <label style={labelCss}>Yhteyshenkilö ja puhelin</label>
              <input style={inputCss} value={customer.contactPerson} onChange={set("contactPerson")} placeholder="Nimi, +358…" />
            </div>
            <div style={{ gridColumn: "1 / -1" }}>
              <label style={labelCss}>Laskutusosoite</label>
              <input style={inputCss} value={customer.billingAddress} onChange={set("billingAddress")} placeholder="Katuosoite, postinumero ja -toimipaikka" />
            </div>
            <div style={{ gridColumn: "1 / -1" }}>
              <label style={labelCss}>Verkkolaskuosoite / sähköposti</label>
              <input style={inputCss} value={customer.eInvoice} onChange={set("eInvoice")} placeholder="verkkolaskuosoite tai lasku@…" />
            </div>
          </div>
        </Panel>

        {/* Signature. Ankkuri, jotta pitkän asiakirjan yli pääsee yhdellä
            napautuksella — upotettu monisivuinen sopimus on korkea, ja
            sisäkkäinen vieritys olisi ollut väärä ratkaisu siihen. */}
        <Panel id={SIGN_ANCHOR}>
          <p style={mono}>ALLEKIRJOITUS</p>
          {customer.legalName && (
            <p style={{ margin: "10px 0 0", fontSize: 13, color: T.ink, lineHeight: 1.6 }}>
              Sopimus tehdään tilaajan <strong>{customer.legalName}</strong>{customer.businessId ? ` (Y-tunnus ${customer.businessId})` : ""} ja Puuhapatetin välillä.
              Allekirjoitat sen tilaajan puolesta sen valtuutettuna edustajana.
            </p>
          )}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 14, margin: "12px 0 14px" }}>
            <div>
              <label style={labelCss}>Nimenselvennys (allekirjoittaja) *</label>
              <input style={inputCss} value={signerName} onChange={(e) => setSignerName(e.target.value)} placeholder="Allekirjoittajan nimi" />
            </div>
            <div>
              <label style={labelCss}>Asema tilaajassa</label>
              <input style={inputCss} value={signerTitle} onChange={(e) => setSignerTitle(e.target.value)} placeholder="Esim. edustaja, toimitusjohtaja" />
            </div>
            <div>
              <label style={labelCss}>Paikka</label>
              <input style={inputCss} value={place} onChange={(e) => setPlace(e.target.value)} />
            </div>
          </div>
          <label style={labelCss}>Allekirjoitus *</label>
          <SignaturePad onChange={setSignatureDataUrl} />
          <div style={{ fontSize: 12, color: T.muted, marginTop: 10 }}>
            Aika: {new Date().toLocaleDateString("fi-FI")} · Palveluntarjoaja: Puuhapatet
          </div>

          {/* What the signature means — separate places for tilaajan tiedot and
              allekirjoitus, but a single, legally binding signing made at once. */}
          <div style={{ marginTop: 14, padding: "12px 14px", borderRadius: 10, border: `1px solid ${T.hair}`, background: T.paper, fontSize: 12.5, color: T.muted, lineHeight: 1.6 }}>
            Tässä asiakirjassa on omat paikkansa tilaajan tiedoille ja allekirjoitukselle.
            Allekirjoituksesi tallentuu kertaluonteisesti aikaleimalla varustettuna, ja yhdessä
            yllä olevan sopimusasiakirjan kanssa se muodostaa yhden kerralla tehdyn, juridisesti
            pätevän allekirjoituksen — samalla tavalla kuin fyysisesti allekirjoitettu sopimus.
          </div>

          <label style={{ display: "flex", gap: 11, alignItems: "flex-start", fontSize: 13.5, color: T.ink, cursor: "pointer", marginTop: 16, lineHeight: 1.5 }}>
            <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} style={{ marginTop: 2, width: 16, height: 16, accentColor: T.green, flexShrink: 0 }} />
            <span>
              Vahvistan tilaajan tiedot oikeiksi ja hyväksyn tämän tarjouksen ja sopimuksen{contractNo ? ` (${contractNo})` : ""} sisällön.
              Allekirjoitan {customer.legalName ? <>tilaajan <strong>{customer.legalName}</strong> puolesta</> : "tilaajan puolesta"} sen
              valtuutettuna edustajana. Hyväksyntä vastaa fyysistä allekirjoitusta, muodostaa tilaajan ja Puuhapatetin
              välisen sitovan sopimuksen ja valtuuttaa Puuhapatetin tekemään työn tämän asiakirjan mukaisesti.
            </span>
          </label>
        </Panel>

        {error && (
          <Panel style={{ border: "1px solid #E2B4B4", background: "#FBEFEF" }}>
            <p style={{ margin: 0, fontSize: 13.5, color: "#9B2C2C" }}>{error}</p>
          </Panel>
        )}

        <button
          type="button"
          onClick={submit}
          disabled={submitting}
          style={{
            width: "100%", padding: 16, borderRadius: 14, border: "none", cursor: submitting ? "default" : "pointer",
            background: T.ink, color: "#fff", fontSize: 16, fontWeight: 700, fontFamily: FONT,
            opacity: submitting ? 0.7 : 1, transition: "opacity .15s",
          }}
        >
          {submitting ? "Tallennetaan…" : "Hyväksy ja allekirjoita → avaa seurantapaneeli"}
        </button>
        <p style={{ textAlign: "center", fontSize: 12, color: T.muted, marginTop: 12 }}>
          Allekirjoitus tallentuu Puuhapatetille aikaleimoineen. puuhapatet.fi
        </p>
      </div>
    </div>
  );
}

/** Tiedostokoko luettavana: "0,5 MB", "96 kB". */
function fmtBytes(b: number): string {
  if (b >= 1_000_000) return `${(b / 1_000_000).toLocaleString("fi-FI", { maximumFractionDigits: 1 })} MB`;
  return `${Math.max(1, Math.round(b / 1000))} kB`;
}

const mono: React.CSSProperties = {
  margin: 0, fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: T.muted, fontWeight: 600,
};
