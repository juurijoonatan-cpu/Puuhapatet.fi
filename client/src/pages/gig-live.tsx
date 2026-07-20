/**
 * Public live progress view for a custom gig (read-only, shareable link).
 *
 * Styled to match the Puuhapatet contract document (PT-…): Poppins, airy,
 * minimalist, thin hairlines, tabular numbers. Independent of the admin theme
 * so it always reads like the contract. Auto-refreshes every ~30 s.
 */

import { useCallback, useEffect, useState } from "react";
import { useRoute } from "wouter";
import { api, type GigPublicView } from "@/lib/api";
import { eur } from "@shared/gig";
import GigContractSign from "@/components/GigContractSign";
import CustomerFloorMap, { type P2CustomerActions } from "@/components/CustomerFloorMap";
import LoadingOrb from "@/components/LoadingOrb";
import { downloadGigContract } from "@/lib/gig-contract-doc";

const T = {
  ink: "#1A1A1A",
  paper: "#F6F4EE",
  card: "#FFFFFF",
  hair: "#E4E1D7",
  muted: "#8C8A82",
  navy: "#1F3B57",
};

const FONT = "'Poppins', ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif";

export default function GigLivePage() {
  const [, params] = useRoute("/seuranta/:token");
  const token = params?.token ?? "";
  const [data, setData] = useState<GigPublicView | null>(null);
  const [status, setStatus] = useState<"loading" | "ok" | "error">("loading");
  // P2 (lisäikkunat): kevyt ehtohyväksyntä ennen ensimmäistä hintatoimintoa.
  const [termsOpen, setTermsOpen] = useState(false);
  const [termsName, setTermsName] = useState("");
  const [termsBusy, setTermsBusy] = useState(false);
  const [termsError, setTermsError] = useState<string | null>(null);
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

  useEffect(() => {
    const id = "poppins-font-link";
    if (!document.getElementById(id)) {
      const link = document.createElement("link");
      link.id = id;
      link.rel = "stylesheet";
      link.href = "https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700;800&display=swap";
      document.head.appendChild(link);
    }
    document.title = "Puuhapatet — Edistyminen";
  }, []);

  const reload = useCallback(async () => {
    const res = await api.getGig(token);
    if (res.ok && res.data) { setData(res.data); setStatus("ok"); }
  }, [token]);

  useEffect(() => {
    if (!token) return;
    let active = true;
    const load = async () => {
      const res = await api.getGig(token);
      if (!active) return;
      if (res.ok && res.data) { setData(res.data); setStatus("ok"); }
      else setStatus((s) => (s === "ok" ? "ok" : "error"));
    };
    load();
    const iv = setInterval(load, 30_000);
    return () => { active = false; clearInterval(iv); };
  }, [token]);

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
  // ALWAYS work-based (washed / scope). Never derived from invoices sent, so the
  // view can't claim progress the real work hasn't reached.
  const pct = sectorsTotal > 0
    ? Math.round((sectorsWashed / sectorsTotal) * 100)
    : Math.round(t.percentByCap * 100);
  // Billing milestones (maksuerät) — driven by ACTUAL WORK, not by invoices sent.
  // A contract is billed in 4 equal instalments as the work passes each quarter;
  // this shows which work-quarters are complete (no euro amount, no claim that an
  // invoice has been sent). Deliberately NOT based on paymentsCount, so the
  // customer never sees a milestone the real work hasn't reached.
  const INSTALMENTS = 4;
  const instalmentsDone = Math.min(INSTALMENTS, Math.floor(pct / 25));
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
    setTermsBusy(true); setTermsError(null);
    const res = await api.p2AcceptTerms(token, name);
    setTermsBusy(false);
    if (!res.ok) { setTermsError(res.error ?? "Hyväksyntä epäonnistui — yritä uudelleen"); return; }
    setTermsOpen(false);
    await reload();
  };

  return (
    <div style={{ minHeight: "100vh", background: T.paper, fontFamily: FONT, color: T.ink, padding: "calc(28px + env(safe-area-inset-top)) calc(16px + env(safe-area-inset-right)) calc(48px + env(safe-area-inset-bottom)) calc(16px + env(safe-area-inset-left))" }}>
      <style>{`@keyframes ppPulse{0%,100%{opacity:1}50%{opacity:.3}}`}</style>
      <div style={{ maxWidth: 640, margin: "0 auto" }}>

        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 22 }}>
          <div>
            <p style={{ margin: 0, fontSize: 22, fontWeight: 800, letterSpacing: "-0.3px" }}>Puuhapatet</p>
            <p style={{ margin: "4px 0 0", fontSize: 13, color: T.muted }}>
              {data.contractId ? `${data.contractId} · ` : ""}{data.companyName}
            </p>
          </div>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6 }}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11, fontWeight: 600, color: T.muted, letterSpacing: "0.08em", border: `1px solid ${T.hair}`, borderRadius: 999, padding: "5px 10px", background: T.card }}>
              <span style={{ width: 7, height: 7, borderRadius: 999, background: "#3E7C59", animation: "ppPulse 1.8s ease-in-out infinite" }} />
              LIVE
            </span>
            {data.approved
              ? <StatusBadge color="#1F3B57" label={`Hyväksytty${data.approvedAt ? " " + fmtDate(data.approvedAt) : ""}`} />
              : data.signed
                ? <StatusBadge color="#3E7C59" label={`Allekirjoitettu${data.signedAt ? " " + fmtDate(data.signedAt) : ""}`} />
                : null}
          </div>
        </div>

        {/* Vaihe 2 aktiivinen: 1. vaihe (kiinteä urakka) tiivistyy valmis-kortiksi,
            jotta keltaisten lisäikkunoiden suunnittelu on selkeä pääfokus. */}
        {p2Live && (
          <Panel>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <span style={{ width: 40, height: 40, flexShrink: 0, borderRadius: 999, background: "#EAF6EE", border: "1px solid #BFE3CC", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20 }} aria-hidden>✓</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ margin: 0, fontSize: 13.5, fontWeight: 700 }}>1. vaihe — kiinteä urakka</p>
                <p style={{ margin: "2px 0 0", fontSize: 12.5, color: T.muted, lineHeight: 1.5 }}>
                  {pct >= 100 ? "Valmis 🎉 Kaikki sovitut ikkunat pesty." : `Käynnissä — ${pct} % valmis.`} Nyt suunnitellaan lisäikkunat alla.
                </p>
              </div>
            </div>
          </Panel>
        )}

        {/* Hero: radial gauge + work progress. The customer sees ONLY progress —
            no euro figures and no total contract price. The agreed price lives in
            the signed contract (downloadable below); this live view is about how
            far the work has come and when the next billing milestone lands. */}
        {!p2Live && (
        <Panel>
          <p style={{ margin: "0 0 4px", fontSize: 13, color: T.muted }}>{data.description}</p>
          <div style={{ display: "flex", alignItems: "center", gap: 24, flexWrap: "wrap", marginTop: 8 }}>
            <Gauge sectors={data.sectors} pct={pct} isFixedDeal={data.isFixedDeal} />
            <div style={{ flex: "1 1 200px", minWidth: 180 }}>
              <p style={label}>Työn edistyminen</p>
              <p style={{ margin: "2px 0 0", fontSize: 44, fontWeight: 800, lineHeight: 1.0, fontVariantNumeric: "tabular-nums" }}>{pct} %</p>
              <p style={{ margin: "8px 0 0", fontSize: 13.5, color: T.muted, lineHeight: 1.55 }}>
                Näet reaaliaikaisesti, kuinka suuri osa sovitusta työstä on valmis.
                Työ tehdään sopimuksen mukaisten ehtojen mukaisesti.
              </p>
            </div>
          </div>

          {/* Progress bar — always window-based (actual work done). */}
          <div style={{ height: 10, width: "100%", borderRadius: 999, background: T.paper, overflow: "hidden", display: "flex", marginTop: 20 }}>
            {data.isFixedDeal || sectorsTotal === 0 ? (
              <div style={{ width: `${pct}%`, background: T.navy, height: "100%", borderRadius: 999 }} />
            ) : (
              data.sectors.map((s) => {
                const w = sectorsTotal > 0 ? (s.washed / sectorsTotal) * 100 : 0;
                return <div key={s.id} style={{ width: `${w}%`, background: s.color, height: "100%" }} />;
              })
            )}
          </div>

          {/* Billing milestones — which of the 4 instalments have been sent. No
              amounts shown; just the "next payroll" rhythm so the customer knows
              where things stand. Only meaningful for fixed-price contracts. */}
          {data.isFixedDeal && (
            <div style={{ marginTop: 18, paddingTop: 16, borderTop: `1px solid ${T.hair}` }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 10 }}>
                <p style={label}>Laskutuksen vaihe</p>
                <span style={{ fontSize: 13, fontWeight: 600, color: T.ink, fontVariantNumeric: "tabular-nums" }}>
                  {instalmentsDone} / {INSTALMENTS}
                </span>
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                {Array.from({ length: INSTALMENTS }).map((_, i) => {
                  const done = i < instalmentsDone;
                  return (
                    <div key={i} style={{ flex: 1, height: 8, borderRadius: 999, background: done ? T.navy : T.paper, border: `1px solid ${done ? T.navy : T.hair}` }} />
                  );
                })}
              </div>
              <p style={{ margin: "10px 0 0", fontSize: 11.5, color: T.muted, lineHeight: 1.5 }}>
                {instalmentsDone >= INSTALMENTS
                  ? "Työ on valmis — sopimus laskutetaan loppuun sovitusti."
                  : `Sopimus laskutetaan ${INSTALMENTS} yhtä suuressa erässä työn edetessä. Seuraava erä erääntyy, kun työ etenee seuraavaan neljännekseen.`}
              </p>
            </div>
          )}
        </Panel>
        )}

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

        {/* P2 — Lisäikkunat (2. vaihe): kasvava sovittu summa + avoimet ehdotukset */}
        {p2Live && (
          <Panel>
            {/* Accent header makes phase 2 read as the current main focus */}
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 10.5, fontWeight: 800, letterSpacing: "0.08em", color: "#8A6A00", background: "rgba(224,168,0,0.16)", border: "1px solid rgba(224,168,0,0.4)", borderRadius: 999, padding: "4px 10px" }}>
                <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#E0A800" }} />
                2. VAIHE · LISÄIKKUNAT
              </span>
              {p2!.termsAccepted && (
                <span style={{ marginLeft: "auto", fontSize: 11.5, color: T.muted }}>Ehdot hyväksytty · {p2!.termsAcceptorName}</span>
              )}
            </div>
            <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap", marginTop: 6 }}>
              <span style={{ fontSize: 34, fontWeight: 800, lineHeight: 1, fontVariantNumeric: "tabular-nums" }}>
                {eur(p2!.billing.lockedSumCents)}
              </span>
              <span style={{ fontSize: 13, color: T.muted }}>
                sovittua lisätyötä · {p2!.billing.lockedCount} ikkunaa
              </span>
            </div>
            <p style={{ margin: "10px 0 0", fontSize: 13.5, lineHeight: 1.6 }}>
              Pesty <strong style={{ fontVariantNumeric: "tabular-nums" }}>{p2!.billing.lockedWashedCount} / {p2!.billing.lockedCount}</strong> sovituista lisäikkunoista.
              {p2!.billing.proposedCount > 0 && (
                <> <strong style={{ color: T.navy }}>{p2!.billing.proposedCount} hintaehdotusta odottaa vastaustasi</strong> — napauta keltaista ikkunaa kartalla.</>
              )}
            </p>
            <p style={{ margin: "8px 0 0", fontSize: 12.5, color: T.muted, lineHeight: 1.6 }}>
              Toisin kuin 1. vaiheen kiinteä urakka, lisäikkunat hinnoitellaan ikkunakohtaisesti:
              hyväksyt jokaisen hinnan erikseen (tai teet vastatarjouksen), ja summa kasvaa vain
              hyväksymistäsi ikkunoista. Voit myös ehdottaa uusia ikkunoita mukaan kartalla.
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
            <p style={{ margin: "0 0 4px", ...label }}>Pohjapiirros</p>
            <p style={{ margin: "0 0 16px", fontSize: 13, color: T.muted }}>
              Näet reaaliaikaisesti mitkä ikkunat on pesty. Kartta päivittyy työn edetessä.
            </p>
            <CustomerFloorMap map={data.map} p2={p2} p2Actions={p2Live ? p2Actions : undefined} />
            <p style={{ margin: "14px 0 0", fontSize: 12, color: T.muted, lineHeight: 1.6 }}>
              {p2Live
                ? "Keltaisella merkityt ikkunat ovat lisätyötä: jokainen hinnoitellaan ikkunakohtaisesti. Napauta ikkunaa nähdäksesi hintaehdotuksen ja vastataksesi siihen."
                : "Keltaisella merkityt ikkunat eivät kuulu tähän sopimukseen — niiden tilanne katsotaan seuraavassa sopimuksessa."}
            </p>
          </Panel>
        )}

        {/* Two-way info / contact note — keep it simple: WhatsApp for anything urgent. */}
        <Panel>
          <p style={{ margin: "0 0 4px", ...label }}>Tiedotus</p>
          <p style={{ margin: "0 0 12px", fontSize: 14, lineHeight: 1.7 }}>
            Jos rakennuksessa on jotain työhön vaikuttavaa (esim. kulku, hälytykset, telineet
            tai ajankohtaiset huomiot), laita meille viestiä — vastaamme nopeasti. Ilmoitamme
            myös itse tästä näkymästä, jos jotain huomioitavaa tulee.
          </p>
          <a
            href="https://wa.me/358400389999"
            target="_blank"
            rel="noreferrer"
            style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "10px 16px", borderRadius: 10, border: "none", background: "#25D366", color: "#fff", fontFamily: FONT, fontSize: 14, fontWeight: 700, textDecoration: "none" }}
          >
            💬 Laita WhatsApp-viesti
          </a>
        </Panel>

        {/* Reassurance note */}
        <Panel>
          <p style={{ margin: 0, fontSize: 14, lineHeight: 1.7 }}>
            {data.customerNote || "Tälle sopimukselle on sovittu kiinteä kokonaishinta, ja työ tehdään sopimuksen mukaisten ehtojen mukaisesti. Voit seurata edistymistä reaaliaikaisesti tästä näkymästä."}
          </p>
          {data.vatNote && <p style={{ margin: "10px 0 0", fontSize: 12, color: T.muted }}>{data.vatNote}</p>}
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
              style={{ marginTop: 14, width: "100%", padding: "11px", borderRadius: 10, border: `1px solid ${T.hair}`, background: T.paper, color: T.ink, fontFamily: FONT, fontSize: 13.5, fontWeight: 600, cursor: "pointer" }}
            >
              Lataa allekirjoitettu sopimus
            </button>
          )}
        </Panel>

        <p style={{ textAlign: "center", fontSize: 12, color: T.muted, marginTop: 8 }}>
          Viimeksi päivitetty {updated} · päivittyy automaattisesti · puuhapatet.fi
        </p>
      </div>

      {/* Vaihe 2 -kutsu: ponnahtaa kerran kun keltaisten suunnittelu avataan.
          Muuten linkki toimii täsmälleen kuten ennen. */}
      {p2Live && !p2!.termsAccepted && !p2InviteDismissed && !termsOpen && (
        <>
          <div onClick={dismissP2Invite} style={{ position: "fixed", inset: 0, zIndex: 68, background: "rgba(26,26,26,0.45)" }} />
          <div style={{ position: "fixed", left: "50%", top: "50%", transform: "translate(-50%,-50%)", zIndex: 69, width: "min(440px, calc(100vw - 32px))", background: T.card, borderRadius: 18, border: `1px solid ${T.hair}`, boxShadow: "0 24px 80px rgba(0,0,0,0.35)", padding: 26, fontFamily: FONT, textAlign: "center" }}>
            <div style={{ fontSize: 40, lineHeight: 1 }} aria-hidden>🟡</div>
            <p style={{ margin: "12px 0 0", fontSize: 18, fontWeight: 800, letterSpacing: "-0.02em" }}>
              Toinen vaihe voi alkaa
            </p>
            <p style={{ margin: "10px 0 0", fontSize: 13.5, lineHeight: 1.7, color: T.ink, textAlign: "left" }}>
              Punaiset ikkunat alkavat olla valmiit — seuraavaksi suunnitellaan
              <strong> keltaisella merkityt lisäikkunat</strong>. Toisin kuin 1. vaiheen kiinteä
              urakka, jokainen lisäikkuna hinnoitellaan erikseen:
            </p>
            <ul style={{ margin: "8px 0 0", padding: "0 0 0 20px", fontSize: 13, lineHeight: 1.8, color: T.muted, textAlign: "left" }}>
              <li>Näet hintaehdotukset suoraan kartalla ikkuna kerrallaan</li>
              <li>Hyväksyt hinnan tai teet vastatarjouksen — mikään ei tule työn alle ilman hyväksyntääsi</li>
              <li>Voit myös ehdottaa uusia ikkunoita mukaan napauttamalla karttaa</li>
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
          <div style={{ position: "fixed", left: "50%", top: "50%", transform: "translate(-50%,-50%)", zIndex: 71, width: "min(420px, calc(100vw - 32px))", background: T.card, borderRadius: 16, border: `1px solid ${T.hair}`, boxShadow: "0 24px 80px rgba(0,0,0,0.35)", padding: 22, fontFamily: FONT, maxHeight: "85vh", overflowY: "auto" }}>
            <p style={{ margin: 0, fontSize: 16, fontWeight: 800 }}>Lisäikkunoiden tilausehdot</p>
            <p style={{ margin: "10px 0 0", fontSize: 13.5, lineHeight: 1.65 }}>
              {p2?.termsText?.trim() || (
                "Hyväksymällä ikkunakohtaisen hinnan tilaat kyseisen ikkunan pesun sovittuun " +
                "hintaan. Hinta lukitaan, kun molemmat osapuolet ovat sen hyväksyneet, ja " +
                "lukitut ikkunat laskutetaan toteutuneen työn mukaan erillään 1. vaiheen " +
                "kiinteästä urakasta. Jokainen hyväksyntä kirjataan aikaleimalla."
              )}
            </p>
            <p style={{ margin: "14px 0 6px", fontSize: 12, fontWeight: 600, color: T.muted }}>Nimenselvennys</p>
            <input
              value={termsName}
              onChange={(e) => setTermsName(e.target.value)}
              placeholder="Etunimi Sukunimi"
              autoFocus
              style={{ width: "100%", boxSizing: "border-box", padding: "11px 12px", borderRadius: 10, border: `1px solid ${T.hair}`, fontFamily: FONT, fontSize: 14 }}
            />
            {termsError && <p style={{ margin: "8px 0 0", fontSize: 12.5, color: "#B4231F" }}>{termsError}</p>}
            <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
              <button
                disabled={termsBusy}
                onClick={() => setTermsOpen(false)}
                style={{ flex: 1, padding: "11px", borderRadius: 10, border: `1px solid ${T.hair}`, background: T.paper, color: T.ink, fontFamily: FONT, fontSize: 13.5, fontWeight: 600, cursor: "pointer" }}
              >
                Peruuta
              </button>
              <button
                disabled={termsBusy}
                onClick={() => void acceptTerms()}
                style={{ flex: 2, padding: "11px", borderRadius: 10, border: "none", background: T.navy, color: "#fff", fontFamily: FONT, fontSize: 13.5, fontWeight: 700, cursor: "pointer", opacity: termsBusy ? 0.6 : 1 }}
              >
                {termsBusy ? "Hyväksytään…" : "Hyväksyn ehdot"}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

/** Radial gauge: one arc at the work-progress %, or a multi-segment ring split by
 *  sector (window-based) for open gigs. Never derived from euros. */
function Gauge({ sectors, pct, isFixedDeal }: {
  sectors: GigPublicView["sectors"]; pct: number; isFixedDeal: boolean;
}) {
  const size = 132, stroke = 13, r = (size - stroke) / 2;
  const C = 2 * Math.PI * r;
  const sectorsTotal = sectors.reduce((s, x) => s + x.total, 0);
  let offset = 0;
  const arcs = isFixedDeal || sectorsTotal === 0
    ? [<circle
        key="fixed"
        cx={size / 2} cy={size / 2} r={r}
        fill="none" stroke={T.navy} strokeWidth={stroke}
        strokeDasharray={`${(pct / 100) * C} ${C - (pct / 100) * C}`}
        strokeDashoffset={0}
        strokeLinecap="butt"
      />]
    : sectors.map((s) => {
        const frac = sectorsTotal > 0 ? s.washed / sectorsTotal : 0;
        const len = frac * C;
        const arc = (
          <circle
            key={s.id}
            cx={size / 2} cy={size / 2} r={r}
            fill="none" stroke={s.color} strokeWidth={stroke}
            strokeDasharray={`${len} ${C - len}`}
            strokeDashoffset={-offset}
            strokeLinecap="butt"
          />
        );
        offset += len;
        return arc;
      });
  return (
    <div style={{ position: "relative", width: size, height: size, flex: "0 0 auto" }}>
      <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={T.paper} strokeWidth={stroke} />
        {arcs}
      </svg>
      <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
        <span style={{ fontSize: 30, fontWeight: 800, lineHeight: 1, fontVariantNumeric: "tabular-nums" }}>{pct}%</span>
        <span style={{ fontSize: 11, color: T.muted, marginTop: 2 }}>sovitusta</span>
      </div>
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

const label: React.CSSProperties = {
  margin: 0, fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: T.muted,
};

function Panel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ background: T.card, border: `1px solid ${T.hair}`, borderRadius: 14, padding: 20, marginBottom: 16 }}>
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
