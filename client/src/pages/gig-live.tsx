/**
 * Public live progress view for a custom gig (read-only, shareable link).
 *
 * Muotoilu: vaalea paperi, iso lihava näyttöluku, pehmeät kortit ja paljon
 * ilmaa — asiakkaan näkymä on tarkoituksella koruton koontinäyttö eikä
 * raportti. Ohjeteksti asuu sivun alaosan taittuvassa osiossa, jotta ruudulle
 * jää se mitä asiakas oikeasti tulee katsomaan. Päivittyy itsestään ~2 min
 * välein, vain kun välilehti on näkyvissä.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRoute } from "wouter";
import { api, type GigPublicView } from "@/lib/api";
import { eur } from "@shared/gig";
import GigContractSign from "@/components/GigContractSign";
import CustomerFloorMap, { type P2CustomerActions } from "@/components/CustomerFloorMap";
import CustomerProgressHero, { type HeroTile } from "@/components/CustomerProgressHero";
import LoadingOrb from "@/components/LoadingOrb";
import { downloadGigContract } from "@/lib/gig-contract-doc";
import { customerProgress } from "@/lib/customer-progress";
import { CT, CFONT, eyebrow } from "@/lib/customer-theme";

const T = CT;
const FONT = CFONT;

/** Valmis Priority 2 -sopimus (FR8 FAFO Oy), bundlattu staattisena assetina.
 *  Näytetään asiakkaalle tilausehtojen hyväksynnän yhteydessä. */
const P2_CONTRACT_PDF_URL = "/fr8/priority2-sopimus-2026.pdf";

export default function GigLivePage() {
  const [, params] = useRoute("/seuranta/:token");
  const token = params?.token ?? "";
  const [data, setData] = useState<GigPublicView | null>(null);
  const [status, setStatus] = useState<"loading" | "ok" | "error">("loading");
  // P2 (lisäikkunat): kevyt ehtohyväksyntä ennen ensimmäistä hintatoimintoa.
  const [termsOpen, setTermsOpen] = useState(false);
  const [termsName, setTermsName] = useState("");
  const [termsChecked, setTermsChecked] = useState(false);
  const [termsBusy, setTermsBusy] = useState(false);
  const [termsError, setTermsError] = useState<string | null>(null);
  // Sulje ehto-/kutsumodaali Escapella (a11y + tuttu käyttötapa).
  useEffect(() => {
    if (!termsOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !termsBusy) setTermsOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [termsOpen, termsBusy]);
  // Vaihe 2 -kutsu: kun vaihe avataan, linkki on muuten ennallaan mutta
  // asiakkaalle popuppaa kerran kutsu suunnitella keltaiset ikkunat + hinnat.
  // Kuittaus muistetaan per linkki, ettei se ponnahda joka käynnillä.
  const [p2InviteDismissed, setP2InviteDismissed] = useState(() => {
    try { return localStorage.getItem(`pp.p2invite.${token}`) === "1"; } catch { return true; }
  });
  const dismissP2Invite = () => {
    setP2InviteDismissed(true);
    try { localStorage.setItem(`pp.p2invite.${token}`, "1"); } catch { /* private mode */ }
  };

  // Kirjasin (Onest 400–800) tulee index.html:stä, joten sitä ei haeta täällä
  // ajonaikaisesti — yksi renderöintiä estävä pyyntö vähemmän puhelimella.
  useEffect(() => { document.title = "Puuhapatet — Edistyminen"; }, []);

  const reload = useCallback(async () => {
    const res = await api.getGig(token);
    if (res.ok && res.data) { setData(res.data); setStatus("ok"); }
  }, [token]);

  // Havaintokuva haetaan vasta kun asiakas avaa kuplan. Tämä sivu pollaa
  // itseään, joten kuvat eivät saa olla mukana joka kierroksella.
  const loadObservationImage = useCallback(async (key: string) => {
    const res = await api.gigObservationImage(token, key);
    return res.ok ? res.data?.imageDataUrl : undefined;
  }, [token]);

  /**
   * Asiakkaan seurantanäkymän päivitys.
   *
   * Tämä oli `setInterval(load, 30_000)` ilman mitään ehtoa: jokainen auki
   * jätetty seurantavälilehti haki koko keikan tilan — karttablobin
   * havaintokuvineen ja allekirjoituksineen — kaksi kertaa minuutissa,
   * loputtomiin, myös taustalla ja yön yli. Yksi unohtunut välilehti riitti
   * polttamaan tietokannan siirtokiintiön.
   *
   * Nyt: 2 min välein, vain kun välilehti on näkyvissä, ja heti kun se
   * palaa näkyviin (silloin luku on tuore juuri kun sitä katsotaan).
   */
  useEffect(() => {
    if (!token) return;
    let active = true;
    let iv: ReturnType<typeof setInterval> | null = null;

    const load = async () => {
      const res = await api.getGig(token);
      if (!active) return;
      if (res.ok && res.data) { setData(res.data); setStatus("ok"); }
      else setStatus((s) => (s === "ok" ? "ok" : "error"));
    };

    const start = () => {
      if (iv) return;
      iv = setInterval(() => { if (!document.hidden) void load(); }, 120_000);
    };
    const stop = () => { if (iv) { clearInterval(iv); iv = null; } };

    const onVisibility = () => {
      if (document.hidden) { stop(); return; }
      void load();
      start();
    };

    void load();
    if (!document.hidden) start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      active = false;
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [token]);

  // Kokonaisedistyminen lasketaan kartasta (kaikki pisteet, hylätyt keltaiset
  // pois) — sama funktio jota kartta itse käyttää, jotta luvut eivät voi olla
  // eri mieltä. useMemo on tässä, ennen varhaisia paluita, jotta hook-järjestys
  // pysyy samana joka renderillä.
  const mapProgress = useMemo(() => customerProgress(data?.map, data?.p2), [data]);

  if (status === "loading") return <LoadingOrb label="Ladataan seurantaa" theme="light" />;
  if (status === "error" || !data) return <Centered>Seurantaa ei löytynyt.</Centered>;

  // The intro is the signing: gate the live view until the contract is signed.
  if (data.requireSignature && !data.signed) {
    return <GigContractSign token={token} view={data} onSigned={reload} />;
  }

  const t = data.totals;
  // Customer view shows ACTUAL work progress (washed windows / scope), never euros.
  // This is the real, honest progress — and it matches the team dashboard's
  // window-based figure, so the two views never disagree. (Previously the
  // customer % was derived from invoices sent, which drifted from real work.)
  const sectorsWashed = data.sectors.reduce((s, x) => s + x.washed, 0);
  const sectorsTotal = data.sectors.reduce((s, x) => s + x.total, 0);
  // SOPIMUKSEN edistyminen: vain sovittu työ (Priority 1). Tämä ohjaa
  // laskutuseriä, joten se ei saa liikkua lisätöiden mukana.
  const contractPct = sectorsTotal > 0
    ? Math.round((sectorsWashed / sectorsTotal) * 100)
    : Math.round(t.percentByCap * 100);
  // KOKONAISEDISTYMINEN: mitä asiakas näkee isona lukuna. Kartta on tarkempi
  // (se tuntee myös lisätyöikkunat), joten sitä käytetään aina kun se on
  // olemassa; ilman karttaa palataan sopimuksen lukuun.
  const hasMapProgress = mapProgress.total > 0;
  const pct = hasMapProgress ? mapProgress.pct : contractPct;
  // LASKUTUS. Tämä luki ennen työn edistymisestä johdettuna ("työ on 100 %,
  // siis 4/4 erää") — ja se väitti asiakkaalle neljää lähetettyä laskua vaikka
  // yhtäkään ei olisi lähetetty.
  //
  // Nimittäjä on nyt poissa kokonaan. "4 / 4" luetaan niin että kaikki on
  // laskutettu ja urakka kuitattu loppuun, ja se on eri väite kuin mitä luku
  // tietää: montako laskua on lähetetty tähän mennessä. Juokseva määrä ei voi
  // luvata mitään sellaista.
  const INSTALMENTS = 4;
  const invoicesSent = data.paymentsCount;
  const updated = new Date(data.updatedAt).toLocaleString("fi-FI", {
    day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit",
  });

  // ── P2 (lisäikkunat): asiakkaan neuvottelutoiminnot ─────────────────────────
  const p2 = data.p2;
  const p2Live = !!p2?.enabled;
  const p2Actions: P2CustomerActions = {
    accept: async (items) => {
      const res = await api.p2Accept(token, items);
      await reload();
      if (!res.ok) return res.error ?? "Hyväksyntä epäonnistui — yritä uudelleen";
      if (res.data && res.data.conflicts.length > 0 && res.data.locked.length === 0) {
        return res.data.conflicts[0]?.error ?? "Hinta ehti muuttua — päivitä näkymä";
      }
      return null;
    },
    counter: async (key, counterCents, version) => {
      const res = await api.p2Counter(token, key, counterCents, version);
      await reload();
      return res.ok ? null : (res.error ?? "Vastatarjous epäonnistui — yritä uudelleen");
    },
    decline: async (key, version) => {
      const res = await api.p2Decline(token, key, version);
      await reload();
      return res.ok ? null : (res.error ?? "Toiminto epäonnistui — yritä uudelleen");
    },
    addPoint: async (floor, x, y) => {
      const res = await api.p2AddPoint(token, floor, x, y);
      await reload();
      return res.ok ? null : (res.error ?? "Ikkunan lisäys epäonnistui — yritä uudelleen");
    },
    removePoint: async (key) => {
      const res = await api.p2RemovePoint(token, key);
      await reload();
      return res.ok ? null : (res.error ?? "Poisto epäonnistui — yritä uudelleen");
    },
    requireTerms: () => { setTermsError(null); setTermsOpen(true); },
  };

  const acceptTerms = async () => {
    const name = termsName.trim();
    if (!name) { setTermsError("Kirjoita nimesi (nimenselvennys)."); return; }
    if (!termsChecked) { setTermsError("Vahvista, että olet lukenut ja hyväksyt tilausehdot."); return; }
    setTermsBusy(true); setTermsError(null);
    const res = await api.p2AcceptTerms(token, name);
    setTermsBusy(false);
    if (!res.ok) { setTermsError(res.error ?? "Hyväksyntä epäonnistui — yritä uudelleen"); return; }
    setTermsOpen(false);
    await reload();
  };

  // Pääkortin ruudut. Vain ne joilla on jotain sanottavaa — tyhjää ruutua ei
  // piirretä, jolloin yhden keikan näkymä voi olla pelkkä luku ja palkki.
  const zone = data.map?.activeZone ?? null;
  const heroTiles: HeroTile[] = [];
  if (p2Live && p2!.billing.proposedCount > 0) {
    heroTiles.push({ label: "Odottaa sinua", value: `${p2!.billing.proposedCount} ikkunaa`, tone: "amber" });
  }
  // "Kertynyt" on nimensä mukaisesti kertynyt: vain ne lisätyöikkunat jotka on
  // sekä pesty ETTÄ hinnaltaan sovittu. Sovittu kokonaissumma (myös vielä
  // pesemättömät) näkyy omana lukunaan Priority 2 -kortissa.
  if (p2Live && mapProgress.p2AccruedCents > 0) {
    heroTiles.push({ label: "Kertynyt", value: eur(mapProgress.p2AccruedCents), tone: "green" });
  }
  if (zone) {
    heroTiles.push({ label: "Työn alla", value: zone.floor === "K" ? "Kellari" : `${zone.floor}. kerros`, tone: "green" });
  }
  if (data.isFixedDeal && invoicesSent > 0) {
    heroTiles.push({ label: "Laskuja lähetetty", value: `${invoicesSent} kpl` });
  }

  return (
    <div style={{ minHeight: "100vh", background: T.paper, fontFamily: FONT, color: T.ink, padding: "calc(34px + env(safe-area-inset-top)) calc(18px + env(safe-area-inset-right)) calc(56px + env(safe-area-inset-bottom)) calc(18px + env(safe-area-inset-left))" }}>
      <style>{`@keyframes ppPulse{0%,100%{opacity:1}50%{opacity:.3}}`}</style>
      <div style={{ maxWidth: 660, margin: "0 auto" }}>

        {/* Header. Nimi ja LIVE ylärivillä, tunnistetiedot ja tilamerkki
            alarivillä samassa virrassa — kapealla puhelimella merkki kiertyy
            omalle rivilleen sen sijaan että puskisi yrityksen nimen rikki. */}
        <div style={{ marginBottom: 26 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
            <p style={{ margin: 0, fontSize: 27, fontWeight: 800, letterSpacing: "-0.035em" }}>Puuhapatet</p>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6, flexShrink: 0, fontSize: 11, fontWeight: 600, color: T.muted, letterSpacing: "0.08em", border: `1px solid ${T.hair}`, borderRadius: 999, padding: "5px 10px", background: T.card }}>
              <span style={{ width: 7, height: 7, borderRadius: 999, background: "#3E7C59", animation: "ppPulse 1.8s ease-in-out infinite" }} />
              LIVE
            </span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "6px 12px", flexWrap: "wrap", marginTop: 7 }}>
            <span style={{ fontSize: 13.5, color: T.muted, overflowWrap: "anywhere" }}>
              {data.contractId ? `${data.contractId} · ` : ""}{data.companyName}
            </span>
            {data.approved
              ? <StatusBadge color="#1F3B57" label={`Hyväksytty${data.approvedAt ? " " + fmtDate(data.approvedAt) : ""}`} />
              : data.signed
                ? <StatusBadge color="#3E7C59" label={`Allekirjoitettu${data.signedAt ? " " + fmtDate(data.signedAt) : ""}`} />
                : null}
          </div>
        </div>

        {/* PÄÄKORTTI. Yksi luku, yksi palkki, muutama ruutu. Ei euroja
            urakkahinnasta — sovittu hinta asuu allekirjoitetussa sopimuksessa.
            Kaikki selittävä teksti on siirretty sivun alaosan taittuvaan
            osioon, jotta tämä näkymä on koontinäyttö eikä saate. */}
        <CustomerProgressHero
          pct={pct}
          done={hasMapProgress ? mapProgress.done : undefined}
          total={hasMapProgress ? mapProgress.total : undefined}
          awaiting={mapProgress.awaiting}
          chip={
            p2Live ? { text: "Priority 2", tone: "amber" }
            : pct >= 100 ? { text: "Valmis", tone: "green" }
            : null
          }
          note={p2Live && contractPct >= 100
            ? "Priority 1 -urakka on valmis. Nyt suunnitellaan Priority 2 -ikkunat alla."
            : undefined}
          tiles={heroTiles}
        />

        {/* Sector cards — hidden for fixed-price deals (flat rate, no per-sector billing). */}
        {!data.isFixedDeal && data.sectors.map((s) => {
          const accrued = s.washed * s.unitPriceCents;
          const cap = s.total * s.unitPriceCents;
          const credit = s.skipped * s.unitPriceCents;
          const sp = s.total > 0 ? Math.round((s.washed / s.total) * 100) : 0;
          return (
            <Panel key={s.id}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                <span style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 600 }}>
                  <span style={{ width: 12, height: 12, borderRadius: 999, background: s.color, display: "inline-block" }} />
                  {s.name}
                </span>
                <span style={{ fontSize: 14, color: T.muted, fontVariantNumeric: "tabular-nums" }}>
                  {eur(accrued)} <span style={{ opacity: 0.6 }}>/ {eur(cap)}</span>
                </span>
              </div>
              <div style={{ height: 8, width: "100%", borderRadius: 999, background: T.paper, overflow: "hidden", marginBottom: 12 }}>
                <div style={{ height: "100%", borderRadius: 999, width: `${sp}%`, background: s.color }} />
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 14, alignItems: "center", flexWrap: "wrap", gap: 4 }}>
                <span>Pesty <strong style={{ fontVariantNumeric: "tabular-nums" }}>{sp} %</strong></span>
                {s.skipped > 0 && (
                  <span style={{ color: T.muted, fontSize: 13 }}>Kuntovaraus {s.skipped} kpl · hyvitys −{eur(credit)}</span>
                )}
              </div>
            </Panel>
          );
        })}

        {/* Priority 2 -vaihe: kasvava sovittu summa + avoimet hintaehdotukset */}
        {p2Live && (
          <Panel>
            {/* Accent header makes phase 2 read as the current main focus */}
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 10.5, fontWeight: 800, letterSpacing: "0.08em", color: "#8A6A00", background: "rgba(224,168,0,0.16)", border: "1px solid rgba(224,168,0,0.4)", borderRadius: 999, padding: "4px 10px" }}>
                <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#E0A800" }} />
                PRIORITY 2
              </span>
              {/* Hyväksynnän koko kirjaus (nimi + aikaleima) näkyy ehtodialogissa
                  yhden napautuksen päässä — tässä riittää tieto että ehdot ovat
                  kunnossa, jottei kortin yläreuna täyty tekstillä. */}
              {p2!.termsAccepted && (
                <button
                  onClick={() => { setTermsError(null); setTermsOpen(true); }}
                  title={`Ehdot hyväksytty${p2!.termsAcceptorName ? ` · ${p2!.termsAcceptorName}` : ""}${p2!.termsAcceptedAt ? ` · ${fmtDate(p2!.termsAcceptedAt)}` : ""}`}
                  style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11.5, fontWeight: 700, color: "#3E7C59", background: "rgba(62,124,89,0.1)", border: "1px solid rgba(62,124,89,0.3)", borderRadius: 999, padding: "4px 11px", fontFamily: FONT, cursor: "pointer" }}
                >
                  ✓ Ehdot hyväksytty
                </button>
              )}
            </div>
            <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap", marginTop: 6 }}>
              <span style={{ fontSize: 38, fontWeight: 800, lineHeight: 1, letterSpacing: "-0.035em", fontVariantNumeric: "tabular-nums" }}>
                {eur(p2!.billing.lockedSumCents)}
              </span>
              <span style={{ fontSize: 13, color: T.muted }}>
                sovittu · {p2!.billing.lockedCount} ikkunaa
              </span>
            </div>
            <p style={{ margin: "12px 0 0", fontSize: 13.5, lineHeight: 1.6 }}>
              Pesty <strong style={{ fontVariantNumeric: "tabular-nums" }}>{p2!.billing.lockedWashedCount} / {p2!.billing.lockedCount}</strong> sovituista.
              {p2!.billing.proposedCount > 0 && (
                <> <strong style={{ color: T.navy }}>{p2!.billing.proposedCount} hintaehdotusta odottaa sinua</strong> alla.</>
              )}
            </p>
            {!p2!.termsAccepted && (
              <button
                onClick={() => { setTermsError(null); setTermsOpen(true); }}
                style={{ marginTop: 12, padding: "10px 16px", borderRadius: 10, border: "none", background: T.navy, color: "#fff", fontFamily: FONT, fontSize: 13.5, fontWeight: 700, cursor: "pointer" }}
              >
                Hyväksy tilausehdot ja aloita
              </button>
            )}
          </Panel>
        )}

        {/* Read-only floor-plan map — customer watches washed windows live. */}
        {data.map && (
          <Panel>
            <p style={{ margin: "0 0 14px", ...label }}>Pohjapiirros</p>
            <CustomerFloorMap map={data.map} p2={p2} p2Actions={p2Live ? p2Actions : undefined} onLoadObservationImage={loadObservationImage} />
          </Panel>
        )}

        {/* TIEDOTTEET JA OHJEET — kaikki selittävä teksti yhdessä taittuvassa
            osiossa. Se on luettavissa kun sitä tarvitsee, muttei joka kerta
            ensimmäisenä ruudulla. Yhteydenotto jää näkyviin, koska se on
            toiminto eikä selitys. */}
        <Panel>
          <details>
            <summary style={{ cursor: "pointer", listStyle: "none", display: "flex", alignItems: "center", gap: 8, fontSize: 14, fontWeight: 600 }}>
              <span aria-hidden style={{ color: T.muted, fontSize: 12 }}>▸</span>
              Tiedotteet ja ohjeet
            </summary>
            <div style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 12, fontSize: 13.5, lineHeight: 1.7, color: T.ink }}>
              <p style={{ margin: 0 }}>{data.description}</p>
              <p style={{ margin: 0 }}>
                {data.customerNote || "Tälle sopimukselle on sovittu kiinteä kokonaishinta, ja työ tehdään sopimuksen mukaisten ehtojen mukaisesti. Voit seurata edistymistä reaaliaikaisesti tästä näkymästä."}
              </p>
              {data.map && (
                <p style={{ margin: 0, color: T.muted }}>
                  {p2Live
                    ? "Kartalla keltaisella merkityt ovat Priority 2 -ikkunoita: jokainen hinnoitellaan ikkunakohtaisesti. Vastaa ehdotuksiin listasta tai napauta ikkunaa kartalta."
                    : "Kartalla keltaisella merkityt ikkunat eivät kuulu tähän sopimukseen — niiden tilanne katsotaan seuraavassa sopimuksessa."}
                </p>
              )}
              {p2Live && (
                <p style={{ margin: 0, color: T.muted }}>
                  Toisin kuin Priority 1 -urakan kiinteä hinta, Priority 2 -ikkunat hinnoitellaan
                  ikkunakohtaisesti: hyväksyt jokaisen hinnan erikseen (tai teet vastatarjouksen), ja
                  summa kasvaa vain hyväksymistäsi ikkunoista. Voit myös lisätä uusia ikkunoita kartalla.
                </p>
              )}
              {data.isFixedDeal && (
                <p style={{ margin: 0, color: T.muted }}>
                  Sopimus laskutetaan {INSTALMENTS} yhtä suuressa erässä työn edetessä.
                  “Laskuja lähetetty” kertoo, montako laskua olemme tähän mennessä lähettäneet.
                </p>
              )}
              <p style={{ margin: 0, color: T.muted }}>
                Jos rakennuksessa on jotain työhön vaikuttavaa (kulku, hälytykset, telineet tai muu
                huomio), laita meille viestiä — vastaamme nopeasti. Ilmoitamme myös itse tästä
                näkymästä, jos jotain huomioitavaa tulee.
              </p>
              {data.vatNote && <p style={{ margin: 0, fontSize: 12, color: T.muted }}>{data.vatNote}</p>}
            </div>
          </details>

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 18 }}>
            <a
              href="https://wa.me/358400389999"
              target="_blank"
              rel="noreferrer"
              style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "11px 17px", borderRadius: 12, border: "none", background: "#25D366", color: "#fff", fontFamily: FONT, fontSize: 14, fontWeight: 700, textDecoration: "none" }}
            >
              💬 Laita viesti
            </a>
          {data.signature && (
            <button
              type="button"
              onClick={() => downloadGigContract({
                contractId: data.contractId,
                companyName: data.companyName,
                description: data.description,
                vatNote: data.vatNote,
                customerNote: data.customerNote,
                contractText: data.contractText,
                sectors: data.sectors,
                capCents: data.totals.capCents,
                signature: {
                  signerName: data.signature!.signerName,
                  place: data.signature!.place ?? undefined,
                  signedAt: data.signature!.signedAt,
                  customer: data.signature!.customer,
                  signatureDataUrl: data.signature!.signatureDataUrl,
                },
                approvedAt: data.approvedAt,
              })}
              style={{ padding: "11px 17px", borderRadius: 12, border: `1px solid ${T.hair}`, background: T.fill, color: T.ink, fontFamily: FONT, fontSize: 14, fontWeight: 600, cursor: "pointer" }}
            >
              Lataa sopimus
            </button>
          )}
          </div>
        </Panel>

        <p style={{ textAlign: "center", fontSize: 12, color: T.muted, marginTop: 10 }}>
          Viimeksi päivitetty {updated} · päivittyy automaattisesti · puuhapatet.fi
        </p>
      </div>

      {/* Vaihe 2 -kutsu: ponnahtaa kerran kun keltaisten suunnittelu avataan.
          Muuten linkki toimii täsmälleen kuten ennen. */}
      {p2Live && !p2!.termsAccepted && !p2InviteDismissed && !termsOpen && (
        <>
          <div onClick={dismissP2Invite} style={{ position: "fixed", inset: 0, zIndex: 68, background: "rgba(26,26,26,0.45)" }} />
          <div role="dialog" aria-modal="true" aria-label="Priority 2 voi alkaa" style={{ position: "fixed", left: "50%", top: "50%", transform: "translate(-50%,-50%)", zIndex: 69, width: "min(440px, calc(100vw - 32px))", background: T.card, borderRadius: 16, border: `1px solid ${T.hair}`, boxShadow: "0 24px 80px rgba(0,0,0,0.35)", padding: 26, fontFamily: FONT }}>
            <button onClick={dismissP2Invite} aria-label="Sulje" style={{ position: "absolute", top: 14, right: 14, width: 28, height: 28, borderRadius: "50%", border: "none", background: T.paper, color: T.muted, fontSize: 14, cursor: "pointer", lineHeight: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>✕</button>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11, fontWeight: 800, letterSpacing: "0.08em", color: "#8A6A00", background: "rgba(224,168,0,0.16)", border: "1px solid rgba(224,168,0,0.4)", borderRadius: 999, padding: "5px 11px" }}>
              <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#E0A800" }} /> PRIORITY 2
            </span>
            <p style={{ margin: "14px 0 0", fontSize: 19, fontWeight: 800, letterSpacing: "-0.02em" }}>
              Priority 2 voi alkaa
            </p>
            <p style={{ margin: "10px 0 0", fontSize: 13.5, lineHeight: 1.7, color: T.ink }}>
              Priority 1 (punaiset) alkaa olla valmis — seuraavaksi suunnitellaan
              <strong> keltaisella merkityt Priority 2 -ikkunat</strong>. Toisin kuin Priority 1 -urakan
              kiinteä hinta, jokainen Priority 2 -ikkuna hinnoitellaan erikseen:
            </p>
            <ul style={{ margin: "8px 0 0", padding: "0 0 0 20px", fontSize: 13, lineHeight: 1.8, color: T.muted }}>
              <li>Näet hintaehdotukset selkeänä listana ja kartalla — ikkuna kerrallaan</li>
              <li>Hyväksyt hinnan tai teet vastatarjouksen — mikään ei tule työn alle ilman hyväksyntääsi</li>
              <li>Voit lisätä uusia ikkunoita Priority 2:seen napauttamalla karttaa</li>
            </ul>
            <div style={{ display: "flex", gap: 8, marginTop: 18 }}>
              <button
                onClick={dismissP2Invite}
                style={{ flex: 1, padding: "12px", borderRadius: 11, border: `1px solid ${T.hair}`, background: T.paper, color: T.ink, fontFamily: FONT, fontSize: 13.5, fontWeight: 600, cursor: "pointer" }}
              >
                Katselen ensin
              </button>
              <button
                onClick={() => { dismissP2Invite(); setTermsError(null); setTermsOpen(true); }}
                style={{ flex: 2, padding: "12px", borderRadius: 11, border: "none", background: T.navy, color: "#fff", fontFamily: FONT, fontSize: 13.5, fontWeight: 700, cursor: "pointer" }}
              >
                Aloitetaan — näytä ehdot
              </button>
            </div>
          </div>
        </>
      )}

      {/* P2 terms dialog — a lightweight click-to-accept (nimi + aikaleima).
          Every price acceptance after this is logged per window, and together
          they form the phase-2 agreement. */}
      {termsOpen && (
        <>
          <div onClick={() => !termsBusy && setTermsOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 70, background: "rgba(26,26,26,0.45)" }} />
          {/* Yksi vierityskehys: otsikko + toiminnot pysyvät, vain sopimusteksti
              vierittyy (ei kahta päällekkäistä vierityspalkkia). */}
          <div role="dialog" aria-modal="true" aria-label="Priority 2 -tilausehdot" style={{ position: "fixed", left: "50%", top: "50%", transform: "translate(-50%,-50%)", zIndex: 71, width: "min(440px, calc(100vw - 32px))", maxHeight: "88vh", display: "flex", flexDirection: "column", background: T.card, borderRadius: 16, border: `1px solid ${T.hair}`, boxShadow: "0 24px 80px rgba(0,0,0,0.35)", padding: 22, fontFamily: FONT }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 10.5, fontWeight: 800, letterSpacing: "0.08em", color: "#8A6A00", background: "rgba(224,168,0,0.16)", border: "1px solid rgba(224,168,0,0.4)", borderRadius: 999, padding: "4px 9px" }}>
                <span style={{ width: 7, height: 7, borderRadius: "50%", background: "#E0A800" }} /> PRIORITY 2
              </span>
              <p style={{ margin: 0, fontSize: 16, fontWeight: 800 }}>Tilausehdot</p>
              <button onClick={() => !termsBusy && setTermsOpen(false)} aria-label="Sulje" style={{ marginLeft: "auto", width: 26, height: 26, borderRadius: "50%", border: "none", background: T.paper, color: T.muted, fontSize: 13, cursor: "pointer", lineHeight: 1, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>✕</button>
            </div>

            {/* Liitetty sopimusteksti pre-wrap -tyylillä: monirivinen soppari
                säilyttää kappaleet ja rivinvaihdot. Ainoa vierittyvä alue. */}
            {p2?.termsText?.trim() ? (
              <div style={{ margin: "12px 0 0", flex: "1 1 auto", minHeight: 60, overflowY: "auto", padding: "12px 14px", borderRadius: 12, background: T.paper, border: `1px solid ${T.hair}`, fontSize: 13.5, lineHeight: 1.65, color: T.ink, whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
                {p2.termsText.trim()}
              </div>
            ) : (
              <p style={{ margin: "12px 0 0", fontSize: 13.5, lineHeight: 1.65, flexShrink: 0 }}>
                Hyväksymällä ikkunakohtaisen hinnan tilaat kyseisen ikkunan pesun sovittuun
                hintaan. Hinta lukitaan, kun molemmat osapuolet ovat sen hyväksyneet, ja
                lukitut ikkunat laskutetaan toteutuneen työn mukaan erillään Priority 1
                -urakan kiinteästä hinnasta. Jokainen hyväksyntä kirjataan aikaleimalla.
              </p>
            )}

            {/* Valmis Priority 2 -sopimus (PDF) — luettavissa ennen hyväksyntää. */}
            <a
              href={P2_CONTRACT_PDF_URL}
              target="_blank"
              rel="noopener noreferrer"
              style={{ display: "inline-flex", alignItems: "center", gap: 7, marginTop: 12, padding: "9px 12px", borderRadius: 10, border: `1px solid ${T.hair}`, background: T.paper, color: T.ink, fontFamily: FONT, fontSize: 12.5, fontWeight: 600, textDecoration: "none", flexShrink: 0 }}
            >
              <span aria-hidden style={{ fontSize: 15 }}>📄</span>
              Lue koko sopimus (PDF) <span style={{ color: T.muted, fontWeight: 500 }}>· avautuu uuteen välilehteen</span>
            </a>

            {/* Jos ehdot on jo hyväksytty, dialogi on VAIN katselua varten: näytä
                hyväksynnän leima (nimi + aikaleima) eikä uutta lomaketta. */}
            {p2?.termsAccepted ? (
              <>
                <div style={{ margin: "14px 0 0", padding: "11px 13px", borderRadius: 10, background: "rgba(62,124,89,0.08)", border: "1px solid rgba(62,124,89,0.28)", fontSize: 13, color: "#2f6a45", lineHeight: 1.55, flexShrink: 0 }}>
                  ✓ Tilausehdot hyväksytty{p2.termsAcceptorName ? ` — ${p2.termsAcceptorName}` : ""}{p2.termsAcceptedAt ? `, ${fmtDate(p2.termsAcceptedAt)}` : ""}. Jokainen ikkunakohtainen hinnan hyväksyntä kirjataan lisäksi erikseen.
                </div>
                <button
                  onClick={() => setTermsOpen(false)}
                  style={{ marginTop: 14, width: "100%", padding: "11px", borderRadius: 10, border: `1px solid ${T.hair}`, background: T.paper, color: T.ink, fontFamily: FONT, fontSize: 13.5, fontWeight: 600, cursor: "pointer", flexShrink: 0 }}
                >
                  Sulje
                </button>
              </>
            ) : (
              <>
                <label htmlFor="p2-terms-name" style={{ display: "block", margin: "14px 0 6px", fontSize: 12, fontWeight: 600, color: T.muted, flexShrink: 0 }}>Nimenselvennys</label>
                <input
                  id="p2-terms-name"
                  value={termsName}
                  onChange={(e) => setTermsName(e.target.value)}
                  placeholder="Etunimi Sukunimi"
                  autoFocus
                  style={{ width: "100%", boxSizing: "border-box", padding: "11px 12px", borderRadius: 10, border: `1px solid ${T.hair}`, fontFamily: FONT, fontSize: 14, flexShrink: 0 }}
                />

                {/* Selkeä suostumus: rasti + selite että hyväksyntä kirjataan. */}
                <label style={{ display: "flex", alignItems: "flex-start", gap: 9, marginTop: 12, fontSize: 12.5, lineHeight: 1.5, color: T.ink, cursor: "pointer", flexShrink: 0 }}>
                  <input type="checkbox" checked={termsChecked} onChange={(e) => setTermsChecked(e.target.checked)} style={{ width: 17, height: 17, marginTop: 1, accentColor: T.navy, flexShrink: 0, cursor: "pointer" }} />
                  <span>Olen lukenut ja hyväksyn Priority 2 -tilausehdot. Hyväksyntä kirjataan nimelläni ja aikaleimalla.</span>
                </label>

                {termsError && <p style={{ margin: "10px 0 0", fontSize: 12.5, color: "#B4231F", flexShrink: 0 }}>{termsError}</p>}
                <div style={{ display: "flex", gap: 8, marginTop: 16, flexShrink: 0 }}>
                  <button
                    disabled={termsBusy}
                    onClick={() => setTermsOpen(false)}
                    style={{ flex: 1, padding: "11px", borderRadius: 10, border: `1px solid ${T.hair}`, background: T.paper, color: T.ink, fontFamily: FONT, fontSize: 13.5, fontWeight: 600, cursor: "pointer" }}
                  >
                    Peruuta
                  </button>
                  <button
                    disabled={termsBusy || !termsName.trim() || !termsChecked}
                    onClick={() => void acceptTerms()}
                    style={{ flex: 2, padding: "11px", borderRadius: 10, border: "none", background: T.navy, color: "#fff", fontFamily: FONT, fontSize: 13.5, fontWeight: 700, cursor: (termsBusy || !termsName.trim() || !termsChecked) ? "not-allowed" : "pointer", opacity: (termsBusy || !termsName.trim() || !termsChecked) ? 0.5 : 1 }}
                  >
                    {termsBusy ? "Hyväksytään…" : "Hyväksyn ehdot"}
                  </button>
                </div>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function fmtDate(ts: number) {
  return new Date(ts).toLocaleDateString("fi-FI", { day: "numeric", month: "numeric", year: "numeric" });
}

/** Signed / approved marking shown in the header. */
function StatusBadge({ color, label }: { color: string; label: string }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11, fontWeight: 600, color, letterSpacing: "0.04em", border: `1px solid ${color}33`, borderRadius: 999, padding: "5px 10px", background: `${color}12`, whiteSpace: "nowrap" }}>
      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
      {label}
    </span>
  );
}

const label: React.CSSProperties = eyebrow;

function Panel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ background: T.card, border: `1px solid ${T.hair}`, borderRadius: 22, padding: 22, marginBottom: 16 }}>
      {children}
    </div>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ minHeight: "100vh", background: T.paper, fontFamily: FONT, color: T.muted, display: "flex", alignItems: "center", justifyContent: "center", padding: 24, textAlign: "center" }}>
      {children}
    </div>
  );
}
