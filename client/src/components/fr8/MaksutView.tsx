/**
 * FR8 — "Maksut": keikan rahaliikenne YHDESSÄ paikassa, neljänä näkymänä.
 *
 * MIKSI TÄMÄ KIRJOITETTIIN UUSIKSI
 *
 * Vanha versio oli yksi seitsemän osion vieritys, jossa kaikki oli yhtä
 * tärkeää: asiakaslaskutus, johtajien tasaus, tallennustilan mittari,
 * tekijälista, kolme laskuhistoriaa ja kaksi mitätöityjen arkistoa. Se vastasi
 * kaikkeen paitsi siihen mitä johtaja oli tullut tekemään — **kenelle minä
 * siirrän ja paljonko** — ja tuntityö puuttui jokaisesta summasta kokonaan.
 *
 * Nyt sivu on neljä välilehteä, ja ne ovat siinä järjestyksessä missä työ
 * tehdään:
 *
 *   1. **Siirrot** — yksi lista: kuka maksaa kenelle, paljonko ja mistä.
 *      Sama `@shared/transfer-report` jonka server lähettää sähköpostilla
 *      molemmille johtajille kun asiakkaan lasku lähtee, joten ruudulla ja
 *      sähköpostissa ei voi lukea eri lukua.
 *   2. **Tekijät** — per tekijä eriteltynä: punaiset ikkunat, keltaiset ja
 *      tuntityö, ja onko tekijä hyväksynyt oman laskunsa. Maksun luonti.
 *   3. **Minä & Matias** — johtajien keskinäiset siirrot omana näkymänään,
 *      viimeinen erä ensimmäisenä. Se on se luku jota ei näe mistään muualta.
 *   4. **Arkisto** — laskuhistoria ja tositteet. Kaikki tallessa, poissa tieltä.
 *
 * Kaikki summat tulevat jaetuista moduuleista (`shared/worker-payouts`,
 * `shared/transfer-report`) — tässä komponentissa ei ole yhtään rahakaavaa.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { api, type EraInvoiceClient } from "@/lib/api";
import { summarizeEraInvoices, voidedEraInvoicePurgeAt, eraScopeLabel } from "@shared/era-billing";
import {
  computeWorkerSettlements, eraSettlementByWorker, sumWorkerSettlements,
} from "@shared/worker-payouts";
import type { TransferReport, TransferInstruction, WorkerApproval } from "@shared/transfer-report";
import type { ProjectData } from "@shared/project";
import { fmtEurCents } from "@shared/tax";
import { BRAND_BILLERS } from "@shared/billers";
import { buildAttributionAudit, type UnpayableBucket } from "@shared/work-attribution";
import { RefreshCw, Users, Mail, FileDown, Receipt, HandCoins, Scale, Trash2, Archive, ChevronDown, ArrowRight, Clock, CheckCircle2, AlertTriangle } from "lucide-react";
import { T, card as tokenCard, mono, statLabel, subLabel, button as tokenButton, input as tokenInput, chip } from "./tokens";
import SendInvoiceEmailDialog from "./SendInvoiceEmailDialog";
import WorkerEraInvoiceDialog from "./WorkerEraInvoiceDialog";
import TasausView from "./TasausView";

const FONT = T.font;
const MONO = T.mono;

const card: React.CSSProperties = { ...tokenCard, padding: T.space.lg };

function founderName(id: string): string {
  return BRAND_BILLERS.find((b) => b.id === id)?.name || id;
}

function fiDate(iso: string | null | undefined): string {
  return iso ? new Date(iso).toLocaleDateString("fi-FI") : "—";
}

const fmtWin = (n: number) => n.toLocaleString("fi-FI", { maximumFractionDigits: 1 });

const TILA_CHIP: Record<string, { label: string; color: string; bg: string }> = {
  luonnos: { label: "Odottaa tekijää", color: T.tone.warn, bg: T.tone.warnBg },
  "lähetetty": { label: "Lähetetty · lukittu", color: T.tone.good, bg: T.tone.goodBg },
  "hyväksytty": { label: "Tekijä hyväksynyt ✓", color: T.tone.good, bg: T.tone.goodBg },
  "hylätty": { label: "Mitätöity", color: T.tone.bad, bg: T.tone.badBg },
};

function TilaChip({ tila }: { tila: string }) {
  const c = TILA_CHIP[tila] || TILA_CHIP.luonnos;
  return <span style={chip(c.color, c.bg)}>{c.label}</span>;
}

/** Tekijän hyväksyntätila yhtenä merkkinä. Tämä on se portti jonka pitää olla
 *  auki ennen kuin raha liikkuu (kohta 4). */
const APPROVAL_CHIP: Record<WorkerApproval, { label: string; color: string; bg: string }> = {
  hyvaksytty: { label: "hyväksytty ✓", color: T.tone.good, bg: T.tone.goodBg },
  odottaa_tekijaa: { label: "odottaa tekijää", color: T.tone.warn, bg: T.tone.warnBg },
  ei_laskua: { label: "lasku tekemättä", color: T.tone.info, bg: T.tone.infoBg },
  ei_maksettavaa: { label: "ei maksettavaa", color: T.text.faint, bg: "rgba(255,255,255,0.05)" },
};

function SectionTitle({ icon, children, right }: { icon?: React.ReactNode; children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: T.space.sm, margin: `${T.space.xl}px 0 ${T.space.md}px` }}>
      {icon}
      <h2 style={{ margin: 0, fontFamily: FONT, fontSize: T.size.body, fontWeight: 700, color: T.text.primary, letterSpacing: "0.01em" }}>{children}</h2>
      {right && <span style={{ marginLeft: "auto", flexShrink: 0 }}>{right}</span>}
    </div>
  );
}

/** Taittuva osio arkistolle. Otsikkorivi kertoo määrän, joten mitään ei katoa
 *  näkyvistä — se on yhden napautuksen takana. */
function Fold({ icon, title, summary, children }: {
  icon: React.ReactNode; title: string; summary?: string; children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ marginTop: T.space.md }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        style={{
          display: "flex", alignItems: "center", gap: T.space.sm, width: "100%",
          minHeight: 44, padding: `${T.space.sm}px ${T.space.md}px`,
          borderRadius: T.radius.md, border: T.border.subtle,
          background: open ? "rgba(255,255,255,0.04)" : "transparent",
          cursor: "pointer", fontFamily: FONT, textAlign: "left",
        }}
      >
        {icon}
        <span style={{ fontSize: T.size.body, fontWeight: 700, color: T.text.primary }}>{title}</span>
        {summary && (
          <span style={{ marginLeft: "auto", fontSize: T.size.sm, color: T.text.muted, fontVariantNumeric: "tabular-nums" }}>
            {summary}
          </span>
        )}
        <ChevronDown
          style={{
            width: 16, height: 16, flexShrink: 0, color: T.text.faint,
            marginLeft: summary ? 0 : "auto",
            transform: open ? "rotate(180deg)" : "none", transition: "transform .15s",
          }}
        />
      </button>
      {open && <div style={{ marginTop: T.space.md }}>{children}</div>}
    </div>
  );
}

function StatTile({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: string }) {
  return (
    <div style={{ ...card, flex: 1, minWidth: 150 }}>
      <p style={{ ...statLabel, margin: 0 }}>{label}</p>
      <p style={{ margin: `${T.space.xs + 2}px 0 0`, fontFamily: FONT, fontSize: T.size.title, fontWeight: 700, color: tone || T.text.primary }}>{value}</p>
      {sub && <p style={subLabel}>{sub}</p>}
    </div>
  );
}

/**
 * Sovitun vähennyksen (tai lisän) säädin yhdelle tekijälle.
 *
 * Oma pieni lomake eikä `window.prompt`: kotivalikkoon asennetussa iOS-PWA:ssa
 * natiivi prompt on epäluotettava — nappi näyttää siltä ettei se tee mitään.
 *
 * Syöte on SE SUMMA JOKA TEKIJÄLLE MAKSETAAN, ei vähennys. Johtaja katsoo
 * MobilePayn kuittia ja kirjoittaa sen luvun; korjaus taksaan lasketaan siitä.
 * Aiemmin hän laski vähennyksen päässä, ja juuri siinä välivaiheessa luku
 * meni väärin — eikä lisäystä voinut kirjata lainkaan, vaikka sovittu summa
 * olisi taksaa suurempi (esim. iso ikkuna 18 € taksan 17 € sijaan).
 */
function AdjustmentControl({ name, cents, currentTotalCents, onSave }: {
  name: string;
  /** Mitä tekijälle nyt siirrettäisiin — korjaus mukaan luettuna. */
  currentTotalCents: number;
  cents: number;
  onSave: (cents: number | null) => Promise<void> | void;
}) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);

  const start = () => {
    // Kenttään NYKYINEN SIIRRETTÄVÄ, ei vähennys: johtaja kirjoittaa sen
    // luvun jonka hän oikeasti maksaa.
    setValue(String(currentTotalCents / 100).replace(".", ","));
    setOpen(true);
  };
  const commit = async (next: number | null) => {
    setBusy(true);
    await onSave(next);
    setBusy(false);
    setOpen(false);
  };
  const parsed = Number(value.trim().replace(",", "."));
  const canSave = value.trim() !== "" && Number.isFinite(parsed) && parsed >= 0;
  /**
   * Syötetystä summasta korjaukseksi: paljonko taksan laskema luku on
   * ohitettava jotta siirrettäväksi tulee juuri tämä. Nykyinen korjaus on jo
   * mukana `currentTotalCents`issa, joten se lisätään erotukseen.
   */
  const nextFixCents = cents + (Math.round(parsed * 100) - currentTotalCents);

  const btn = tokenButton();

  return (
    <div style={{ marginTop: T.space.sm, paddingTop: T.space.sm, borderTop: T.border.divider }}>
      {!open ? (
        <div style={{ display: "flex", alignItems: "center", gap: T.space.sm, flexWrap: "wrap" }}>
          <button onClick={start} style={btn}>
            {cents !== 0 ? "Muuta summaa" : "Korjaa summa"}
          </button>
          {cents !== 0 && (
            <button onClick={() => void commit(null)} disabled={busy} style={{ ...btn, background: "transparent", color: T.text.muted }}>
              Poista
            </button>
          )}
        </div>
      ) : (
        <div>
          <p style={{ margin: `0 0 ${T.space.xs + 2}px`, fontFamily: FONT, fontSize: T.size.xs, color: T.text.muted }}>
            Paljonko {name.split(/\s+/)[0]}lle oikeasti maksetaan?
          </p>
          <div style={{ display: "flex", alignItems: "center", gap: T.space.sm, flexWrap: "wrap" }}>
            <input
              type="text"
              inputMode="decimal"
              autoFocus
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && canSave) void commit(nextFixCents || null); }}
              placeholder="78"
              aria-label={`Siirrettävä summa — ${name}`}
              style={{ ...tokenInput, width: 90, textAlign: "right" }}
            />
            <span style={{ fontFamily: FONT, fontSize: T.size.body, color: T.text.muted }}>€</span>
            <button
              onClick={() => void commit(nextFixCents || null)}
              disabled={!canSave || busy}
              style={canSave ? tokenButton("accent") : { ...btn, opacity: 0.45 }}
            >
              {busy ? "Tallennetaan…" : "Tallenna"}
            </button>
            <button onClick={() => setOpen(false)} disabled={busy} style={{ ...btn, background: "transparent", color: T.text.muted }}>
              Peru
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/** Sähköpostikopioiden tila johtaja-väliselle laskulle. */
function EmailCopies({ inv }: { inv: EraInvoiceClient }) {
  const emails = inv.emails || [];
  return (
    <div style={{ display: "flex", alignItems: "center", gap: T.space.xs + 2, marginTop: T.space.sm }}>
      <Mail style={{ width: 12, height: 12, color: T.text.faint, flexShrink: 0 }} />
      {emails.length === 0 ? (
        <span style={{ fontFamily: FONT, fontSize: T.size.xs, color: T.text.faint }}>
          {inv.tila === "luonnos" ? "Ei vielä lähetetty — odottaa tekijää." : "Ei sähköpostikopioita."}
        </span>
      ) : (
        <span style={{ fontFamily: FONT, fontSize: T.size.xs, color: T.text.muted }}>
          {emails.map((e, i) => (
            <span key={i}>
              {i > 0 && " · "}
              {e.success ? "✓" : "✗"} {e.recipients.join(", ")} ({fiDate(e.sentAt)})
            </span>
          ))}
        </span>
      )}
    </div>
  );
}

/** PDF-lataus — admin-Bearer-autentikoitu, joten haetaan blobina. */
function DownloadPdfButton({ jobId, invoiceId }: { jobId: number; invoiceId: number }) {
  const [busy, setBusy] = useState(false);
  const download = async () => {
    setBusy(true);
    const res = await api.downloadEraInvoicePdf(jobId, invoiceId);
    setBusy(false);
    if (res.ok && res.blob) {
      const url = URL.createObjectURL(res.blob);
      window.open(url, "_blank");
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    }
  };
  return (
    <button onClick={download} disabled={busy}
      style={{ ...tokenButton(), opacity: busy ? 0.5 : 1 }}>
      <FileDown style={{ width: 12, height: 12 }} /> {busy ? "Avataan…" : "Lataa PDF"}
    </button>
  );
}

/**
 * Mitätöi tekijälasku (väärä summa tai väärä maksaja).
 *
 * Tekijä voi hylätä vain LUONNOKSEN omalta linkiltään. Kun johtaja huomaa virheen
 * vasta lähetyksen jälkeen, ilman tätä ei ollut mitään reittiä takaisin.
 */
function VoidInvoiceButton({ jobId, invoiceId, name, onDone }: {
  jobId: number; invoiceId: number; name: string; onDone: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const btn: React.CSSProperties = { ...tokenButton(), background: "transparent", color: T.text.muted };
  if (!confirming) {
    return <button onClick={() => setConfirming(true)} style={btn}>Mitätöi</button>;
  }
  return (
    <span style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: T.space.sm }}>
      <span style={{ fontFamily: FONT, fontSize: T.size.xs, color: "rgba(255,160,160,0.95)" }}>
        Mitätöidäänkö {name}n lasku? Summa palaa siirrettäväksi.
      </span>
      <span style={{ display: "inline-flex", alignItems: "center", gap: T.space.sm, flexWrap: "wrap" }}>
        <button
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            const res = await api.voidEraInvoice(jobId, invoiceId);
            setBusy(false);
            if (!res.ok) { setErr(res.error || "Mitätöinti epäonnistui"); return; }
            setErr(null);
            setConfirming(false);
            onDone();
          }}
          style={tokenButton("danger")}
        >
          {busy ? "Mitätöidään…" : "Kyllä, mitätöi"}
        </button>
        <button disabled={busy} onClick={() => setConfirming(false)} style={btn}>Peru</button>
      </span>
      {err && <span style={{ fontFamily: FONT, fontSize: T.size.xs, color: T.tone.bad }}>{err}</span>}
    </span>
  );
}

/** "katoaa 41 t kuluttua" — mitätöidyn luonnoksen jäljellä oleva säilytysaika. */
function purgeCountdown(inv: { tila: string; invoiceNumber?: string | null; sentAt?: string | null; respondedAt?: string | null }): string {
  const at = voidedEraInvoicePurgeAt(inv as any);
  if (at == null) return "";
  const left = at - Date.now();
  if (left <= 0) return "katoaa seuraavalla päivityksellä";
  const h = Math.ceil(left / 3_600_000);
  return h >= 2 ? `katoaa ${h} t kuluttua` : "katoaa alle tunnissa";
}

/** Yksi siirto-ohje: kuka → kenelle, paljonko, mistä. Tämä on se rivi joka
 *  tehdään pankissa, joten summa on iso ja syy sen alla pienenä. */
function TransferRow({ t }: { t: TransferInstruction }) {
  return (
    <div style={{
      display: "flex", alignItems: "center", justifyContent: "space-between",
      gap: T.space.md, flexWrap: "wrap",
      padding: `${T.space.md}px 0`, borderTop: T.border.divider,
    }}>
      <div style={{ minWidth: 0, flex: 1 }}>
        <p style={{ margin: 0, fontFamily: FONT, fontSize: T.size.body, fontWeight: 700, color: T.text.primary, display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
          {t.fromName}
          <ArrowRight style={{ width: 13, height: 13, color: T.text.faint, flexShrink: 0 }} />
          {t.toName}
          {t.status === "valmis" && <span style={chip(T.tone.good, T.tone.goodBg)}>siirrä nyt</span>}
          {t.kind === "founder" && <span style={chip(T.tone.info, T.tone.infoBg)}>johtajien tasaus</span>}
        </p>
        <p style={{ margin: "3px 0 0", fontFamily: FONT, fontSize: T.size.xs, color: T.text.muted, lineHeight: 1.45 }}>{t.why}</p>
        {t.blockedReason && (
          <p style={{
            margin: "3px 0 0", fontFamily: FONT, fontSize: T.size.xs,
            color: t.status === "odottaa_hyvaksyntaa" || t.status === "maksa_tekijat_ensin" ? T.tone.warn : T.tone.info,
            display: "flex", alignItems: "center", gap: 5,
          }}>
            <Clock style={{ width: 11, height: 11, flexShrink: 0 }} /> {t.blockedReason}
          </p>
        )}
      </div>
      <span style={{
        flexShrink: 0, fontFamily: FONT, fontSize: T.size.title, fontWeight: 800,
        fontVariantNumeric: "tabular-nums",
        color: t.status === "valmis" ? T.tone.good
          : t.status === "odottaa_hyvaksyntaa" || t.status === "maksa_tekijat_ensin" ? T.tone.warn
          : T.tone.info,
      }}>
        {fmtEurCents(t.cents)}
      </span>
    </div>
  );
}

/**
 * KOHDENTAMATON TYÖ — pesty työ jolle ei ole maksunsaajaa.
 *
 * Maksulista näyttää vain ne joille voi tehdä laskun. Se on oikein, mutta se
 * teki kolmesta tapauksesta näkymättömiä: poistetun tekijän työ (raha katosi
 * kirjaimellisesti — tasaus vähensi sen kuluna, kukaan ei saanut sitä),
 * harjoittelijan työ (vastuujohtaja tilittää, mutta kukaan ei nähnyt paljonko)
 * ja nimeämätön puolikas (jaettu ikkuna jonka toista tekijää ei ole
 * järjestelmässä). Ne luetaan samasta jaetusta laskennasta kuin
 * sähköpostiraportti, joten ruutu ja posti eivät voi olla eri mieltä.
 */
const UNPAYABLE_LABEL: Record<UnpayableBucket["kind"], string> = {
  unnamed: "nimeämätön tekijä",
  removed: "ei enää tekijälistalla",
  trainee: "harjoittelija",
};

/** Mitä TÄLLE riville pitää tehdä. Varoitus ilman seuraavaa askelta on
 *  varoitus jonka lukija oppii ohittamaan. */
const UNPAYABLE_FIX: Record<UnpayableBucket["kind"], string> = {
  unnamed: "Merkitse pesijä kartalla, niin summa siirtyy hänen maksuunsa.",
  removed: "Palauta tekijä Tiimi-sivulla tai vaihda pesijä kartalla.",
  trainee: "Vastuujohtaja maksaa itse — kirjaa maksu Tiimi-sivulla, niin rivi kuittaantuu.",
};

function UnattributedCard({ buckets, totalCents }: { buckets: UnpayableBucket[]; totalCents: number }) {
  return (
    <div style={{ ...card, marginBottom: T.space.md, borderColor: T.tone.warnBorder, background: T.tone.warnBg }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: T.space.sm, flexWrap: "wrap" }}>
        <p style={{ margin: 0, display: "flex", alignItems: "center", gap: 6, fontFamily: FONT, fontSize: T.size.body, fontWeight: 700, color: T.text.primary }}>
          <AlertTriangle style={{ width: 14, height: 14, flexShrink: 0, color: T.tone.warn }} />
          Kohdentamaton työ
        </p>
        <span style={{ fontFamily: FONT, fontSize: T.size.title, fontWeight: 800, color: T.tone.warn, fontVariantNumeric: "tabular-nums" }}>
          {fmtEurCents(totalCents)}
        </span>
      </div>
      <p style={{ ...subLabel }}>
        Tämä työ on tehty, mutta sille ei ole maksunsaajaa tekijälistalla — se ei ole siirroissa mukana.
      </p>
      <div style={{ marginTop: T.space.sm, display: "flex", flexDirection: "column", gap: T.space.xs }}>
        {buckets.map((b) => (
          <div key={`${b.kind}-${b.id}`} style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: T.space.sm, paddingTop: T.space.xs, borderTop: T.border.divider }}>
            <span style={{ minWidth: 0, fontFamily: FONT, fontSize: T.size.sm, color: T.text.primary }}>
              {b.name}
              <span style={{ color: T.text.muted }}>
                {" · "}{UNPAYABLE_LABEL[b.kind]}
                {b.p1Windows + b.p2Windows > 0 ? ` · ${fmtWin(b.p1Windows + b.p2Windows)} ikkunaa` : ""}
                {b.hours > 0 ? ` · ${fmtWin(b.hours)} h` : ""}
                {/* Harjoittelijalla raha ei ole kadonnut — se on nimetyn
                    johtajan tilitettävä. Se on eri asia kuin "kadonnut", ja
                    rivin pitää sanoa kumpi on kyseessä. */}
                {b.responsibleLeaderName ? ` · tilittää ${b.responsibleLeaderName}` : ""}
                {b.settledCents > 0 ? ` · ansaittu ${fmtEurCents(b.earnedCents)} · maksettu ${fmtEurCents(b.settledCents)}` : ""}
                {b.p2PendingCents > 0 ? ` · odottaa asiakasta ${fmtEurCents(b.p2PendingCents)}` : ""}
              </span>
            </span>
            <span style={{ flexShrink: 0, fontFamily: FONT, fontSize: T.size.body, fontWeight: 700, color: T.text.primary, fontVariantNumeric: "tabular-nums" }}>
              {fmtEurCents(b.totalCents)}
            </span>
          </div>
        ))}
      </div>
      {/* Seuraava askel per syy — samat kolme ohjetta, vain ne jotka koskevat
          tätä keikkaa. */}
      <div style={{ marginTop: T.space.sm, display: "flex", flexDirection: "column", gap: 2 }}>
        {Array.from(new Set(buckets.map((b) => b.kind))).map((kind) => (
          <p key={kind} style={{ margin: 0, fontFamily: FONT, fontSize: T.size.xs, color: T.text.muted, lineHeight: 1.5 }}>
            {UNPAYABLE_FIX[kind]}
          </p>
        ))}
      </div>
    </div>
  );
}

export interface MaksutBilling {
  p1PayCount: number;
  p1InvoicedCents: number;
  p2InvoicedCents: number;
  p2RemainingCents: number;
  agreedTotalCents: number;
  nextInstalmentCents: number;
  hoursInvoicedCents?: number;
  hoursPayments?: number;
  invoicedTotalCents?: number;
}

type MaksutTab = "siirrot" | "tekijat" | "johtajat" | "arkisto";

const TABS: [MaksutTab, string][] = [
  ["siirrot", "Siirrot"],
  ["tekijat", "Tekijät"],
  ["johtajat", "Minä & Matias"],
  ["arkisto", "Arkisto"],
];

export default function MaksutView({ jobId, project, billing, onOpenGig, onSetAdjustment, canEditTasaus = true }: {
  jobId: number;
  /** Karttatila — tarvitaan tekijöiden maksettavan laskentaan. */
  project: ProjectData | null;
  /** Asiakaslaskutuksen tila serveriltä (GET /project → billing). */
  billing?: MaksutBilling | null;
  /** Hyppy keikkanäkymään, jossa asiakaslaskut lähetetään. */
  onOpenGig?: () => void;
  /** Sovittu vähennys/lisä tekijän punaisten palkkaan (senttiä, etumerkillinen;
   *  null poistaa). Tallentuu crew-riville, joten se pysyy. */
  onSetAdjustment?: (workerId: string, cents: number | null) => Promise<void> | void;
  /** Saako katsoja kirjata tasauksen (vain perustaja). */
  canEditTasaus?: boolean;
}) {
  const [tab, setTab] = useState<MaksutTab>("siirrot");
  const [invoices, setInvoices] = useState<EraInvoiceClient[]>([]);
  const [report, setReport] = useState<TransferReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [mailBusy, setMailBusy] = useState(false);
  const [mailDone, setMailDone] = useState<string | null>(null);

  const load = useCallback(async () => {
    // Kaksi hakua rinnakkain: laskulista (arkisto + tekijärivit) ja
    // siirtoraportti (sama laskenta jonka server sähköpostittaa). Raportin
    // epäonnistuminen ei saa kaataa koko sivua — sen osio kertoo silloin
    // itse ettei sitä saatu.
    const [invRes, repRes] = await Promise.all([
      api.getEraInvoices(jobId),
      api.getTransferReport(jobId),
    ]);
    if (invRes.ok && Array.isArray(invRes.data?.invoices)) { setInvoices(invRes.data.invoices); setErr(null); }
    else if (invRes.ok) { setInvoices([]); setErr(null); }
    else setErr(invRes.error || "Lataus epäonnistui");
    setReport(repRes.ok ? (repRes.data?.report ?? null) : null);
    setLoading(false);
  }, [jobId]);

  useEffect(() => { void load(); }, [load]);

  const s = summarizeEraInvoices(invoices);
  const liveWorkerInvoices = s.workerInvoices.filter((inv) => inv.tila !== "hylätty");

  // Tekijöiden maksettava — yksi jaettu laskenta, KAIKKI KOLME RAHAVIRTAA.
  // `hoursEra` on se joka ennen puuttui: tuntityötä ei tunnistettu lainkaan,
  // joten tuntikeikan maksettava näytti nollaa.
  const settlements = useMemo(
    () => (project ? computeWorkerSettlements(project, {
      era: eraSettlementByWorker(invoices, "p1"),
      p2Era: eraSettlementByWorker(invoices, "p2"),
      hoursEra: eraSettlementByWorker(invoices, "hours"),
    }) : []),
    [project, invoices],
  );
  const payable = useMemo(
    () => settlements.filter((r) => r.active || r.earnedCents > 0 || r.hoursEarnedCents > 0),
    [settlements],
  );
  const totals = useMemo(() => sumWorkerSettlements(payable), [payable]);
  // Sama laskenta kuin siirtoraportissa. Luetaan mieluummin raportista kun se
  // on ladattu, jotta ruutu ja sähköposti näyttävät varmasti saman luvun.
  /**
   * Viimeisin johtajien välinen lasku — uusin ensin, mitätöidyt pois. Sama
   * lista kuin taittuvassa osiossa, mutta tämä yksi rivi näkyy aina.
   */
  const latestFounderInvoice = useMemo(() => {
    const live = s.founderInvoices.filter((inv) => inv.tila !== "hylätty");
    return live.slice().sort((a, b) => b.id - a.id)[0] ?? null;
  }, [s.founderInvoices]);
  const attribution = useMemo(() => {
    if (report?.attribution) return report.attribution;
    // Sama netotus kuin serverin raportissa: jo maksettu ei ole selvitettävää.
    const settledCentsById: Record<string, number> = {};
    for (const scope of ["p1", "p2", "hours"] as const) {
      const m = eraSettlementByWorker(invoices, scope);
      for (const [id, cents] of Object.entries(m.centsByWorker)) settledCentsById[id] = (settledCentsById[id] || 0) + cents;
      for (const [id, cents] of Object.entries(m.pendingCentsByWorker)) settledCentsById[id] = (settledCentsById[id] || 0) + cents;
    }
    return buildAttributionAudit(project, { settledCentsById });
  }, [report, project, invoices]);

  /**
   * Tekijän hyväksyntätila raportista — sama lähde kuin siirtolistalla.
   *
   * Raportti jättää pois tekijät joilla ei ole rahaa missään vaiheessa ketjua,
   * ja se voi jäädä lataamatta kokonaan. Kumpikaan EI tarkoita "lasku
   * tekemättä": oletus johdetaan silloin riviltä itseltään, ettei näkymä
   * merkitse keltaisella tekijää jolle ei olla velkaa mitään.
   */
  const approvalOf = useCallback(
    (row: { workerId: string; openTotalCents: number; pendingTotalCents: number }): WorkerApproval => {
      const fromReport = report?.workers.find((w) => w.workerId === row.workerId)?.approval;
      if (fromReport) return fromReport;
      if (row.pendingTotalCents > 0) return "odottaa_tekijaa";
      return row.openTotalCents > 0 ? "ei_laskua" : "ei_maksettavaa";
    },
    [report],
  );

  const sendReport = async () => {
    setMailBusy(true);
    setMailDone(null);
    const res = await api.sendTransferReport(jobId);
    setMailBusy(false);
    setMailDone(res.ok ? `Lähetetty: ${res.data?.to ?? "johtajille"}` : (res.error || "Lähetys epäonnistui"));
  };

  /**
   * SIIRRETTÄVÄÄ = avoin velka + kuittausta odottavat laskut. Luonnos varaa
   * velan, joten pelkkä avoin summa tippuisi nollaan heti kun laskut on tehty
   * — ennen kuin senttiäkään on liikkunut. Sama luku kuin siirtoraportissa,
   * jotta välilehdet eivät voi olla eri mieltä samasta rahasta.
   */
  const workerToMove = report?.workerOpenTotalCents ?? (totals.openTotalCents + totals.pendingTotalCents);
  const totalToMove = workerToMove + (report?.founderTransfer?.cents ?? 0);

  return (
    <div
      data-fr8-pane
      style={{
        height: "100%", overflowY: "auto", overflowX: "hidden", overscrollBehavior: "contain",
        boxSizing: "border-box",
        padding: `${T.space.lg + 4}px ${T.space.lg}px calc(${T.space.xl}px + env(safe-area-inset-bottom))`,
        maxWidth: 980, margin: "0 auto", width: "100%",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: T.space.sm + 2 }}>
        <h1 style={{ margin: 0, fontFamily: FONT, fontSize: T.size.display, fontWeight: 700, color: T.text.primary, letterSpacing: "-0.01em" }}>Maksut</h1>
        {/* Yläpalkissa vain päivitys. Vapaa sähköpostilähetys on arkiston
            työkalu (vanhan laskun lähetys uudelleen) eikä kuulu siihen riviin
            jolta katsotaan paljonko rahaa liikkuu nyt. */}
        <button onClick={() => { setLoading(true); void load(); }} title="Päivitä" style={{ ...tokenButton(), flexShrink: 0 }}>
          <RefreshCw style={{ width: 13, height: 13 }} /> Päivitä
        </button>
      </div>

      {/* ── Välilehdet. Neljä näkymää, ei yhtä loputonta vieritystä. ────────── */}
      <div style={{ display: "flex", gap: T.space.xs, marginTop: T.space.md, flexWrap: "wrap" }}>
        {TABS.map(([id, label]) => {
          const active = tab === id;
          return (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              aria-current={active}
              style={{
                ...tokenButton(active ? "solid" : "ghost"),
                minHeight: 38, padding: `7px ${T.space.md}px`, fontSize: T.size.sm,
              }}
            >
              {label}
              {id === "siirrot" && totalToMove > 0 && (
                <span style={{ fontVariantNumeric: "tabular-nums", opacity: active ? 0.75 : 0.6 }}>
                  {fmtEurCents(totalToMove)}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {loading && <p style={{ fontFamily: FONT, fontSize: T.size.sm, color: T.text.muted, marginTop: T.space.xl }}>Ladataan…</p>}
      {err && !loading && (
        <div style={{ ...card, marginTop: T.space.lg, borderColor: T.tone.badBorder }}>
          <p style={{ margin: 0, fontFamily: FONT, fontSize: T.size.sm, color: T.tone.bad }}>{err}</p>
        </div>
      )}

      {/* ══ 1. SIIRROT ════════════════════════════════════════════════════════ */}
      {!loading && !err && tab === "siirrot" && (
        <>
          <div style={{ ...card, marginTop: T.space.lg, padding: T.space.xl - 4 }}>
            <div style={{ ...mono, marginBottom: T.space.sm }}>Siirrettävää yhteensä</div>
            <div style={{
              fontFamily: FONT, fontSize: T.size.hero, fontWeight: 800, lineHeight: 1,
              letterSpacing: "-0.02em", fontVariantNumeric: "tabular-nums",
              color: totalToMove > 0 ? T.tone.warn : T.tone.good,
            }}>
              {fmtEurCents(totalToMove)}
            </div>
            {/* Kaksi eri odotusta, kaksi eri tekemistä: hyväksyntää odottava
                lasku on jo tehty, laskuton velka odottaa johtajaa. Yksi
                yhteinen "estetty"-varoitus koko summan päälle ei kertonut
                kummastakaan mitä pitäisi tehdä. */}
            {report && report.awaitingApprovalCents > 0 && (
              <p style={{ margin: `${T.space.sm}px 0 0`, fontFamily: FONT, fontSize: T.size.sm, color: T.tone.warn, display: "flex", alignItems: "center", gap: 6 }}>
                <Clock style={{ width: 13, height: 13, flexShrink: 0 }} />
                {fmtEurCents(report.awaitingApprovalCents)} odottaa tekijän hyväksyntää.
              </p>
            )}
            {report && report.missingInvoiceCents > 0 && (
              <p style={{ margin: `${T.space.xs}px 0 0`, fontFamily: FONT, fontSize: T.size.sm, color: T.tone.info, display: "flex", alignItems: "center", gap: 6 }}>
                <AlertTriangle style={{ width: 13, height: 13, flexShrink: 0 }} />
                {fmtEurCents(report.missingInvoiceCents)} odottaa laskun luontia — "Maksa tekijöille".
              </p>
            )}
            {/* Kohdentamaton työ EI ole tässä summassa — juuri siksi se pitää
                sanoa tässä. Ilman tätä riviä "siirrettävää yhteensä" näytti
                täydelliseltä samalla kun poistetun tekijän tai nimeämättömän
                puoliskon raha oli pudonnut listalta kokonaan. */}
            {attribution.any && (
              <p style={{ margin: `${T.space.xs}px 0 0`, fontFamily: FONT, fontSize: T.size.sm, color: T.tone.warn, display: "flex", alignItems: "center", gap: 6 }}>
                <AlertTriangle style={{ width: 13, height: 13, flexShrink: 0 }} />
                {fmtEurCents(attribution.totalCents)} tehtyä työtä ilman maksunsaajaa — katso "Tekijät".
              </p>
            )}

            {report && report.instructions.length > 0 ? (
              <div style={{ marginTop: T.space.lg }}>
                {report.instructions.map((t, i) => <TransferRow key={`${t.kind}-${t.toId}-${t.status}-${i}`} t={t} />)}
              </div>
            ) : (
              <p style={{ margin: `${T.space.md}px 0 0`, fontFamily: FONT, fontSize: T.size.sm, color: T.text.muted }}>
                {!report
                  ? "Siirtoraporttia ei saatu ladattua. Päivitä sivu."
                  : report.workerSettledTotalCents > 0 || report.invoicedTotalCents > 0
                  ? "Ei siirrettävää — kaikki on maksettu."
                  : "Ei vielä siirrettävää: tälle keikalle ei ole kertynyt palkkaa eikä laskutusta."}
              </p>
            )}

            <div style={{ display: "flex", gap: T.space.sm, flexWrap: "wrap", marginTop: T.space.lg, paddingTop: T.space.md, borderTop: T.border.divider }}>
              {payable.length > 0 && (
                <WorkerEraInvoiceDialog jobId={jobId} workers={payable} variant="button" onSent={() => void load()} />
              )}
              {/* Johtajien siirto kirjataan tasausnäkymässä — vie sinne suoraan
                  eikä jätä riviä listalle jota ei voi kuitata mistään. */}
              {report?.founderTransfer && (
                <button type="button" onClick={() => setTab("johtajat")} style={tokenButton()}>
                  <Scale style={{ width: 13, height: 13 }} /> Kirjaa johtajien siirto
                </button>
              )}
              <button type="button" onClick={() => void sendReport()} disabled={mailBusy} style={tokenButton()}>
                <Mail style={{ width: 13, height: 13 }} /> {mailBusy ? "Lähetetään…" : "Lähetä raportti meille"}
              </button>
              {onOpenGig && (
                <button onClick={onOpenGig} style={{ ...tokenButton(), background: "transparent", color: T.text.muted }}>
                  Lähetä asiakaslasku →
                </button>
              )}
            </div>
            {mailDone && <p style={{ ...subLabel }}>{mailDone}</p>}
            <p style={{ ...subLabel }}>
              Kun tekijä hyväksyy laskunsa, se lukittuu ja lähtee PDF:nä sähköpostilla molemmille johtajille —
              se on merkki siitä että raha voi liikkua, ja rivi siirtyy täältä "hoidettuihin".
            </p>
            <p style={{ ...subLabel }}>
              Sama raportti lähtee automaattisesti sähköpostilla molemmille johtajille aina kun asiakkaan lasku lähtee.
            </p>
          </div>

          {/* Asiakaslaskutus — yksi tilannerivi, ei kolmea tiiltä. Laskun
              lähetys on keikkanäkymässä, joten tässä se on vain tieto. */}
          {billing && (
            <>
              <SectionTitle icon={<Receipt style={{ width: 15, height: 15, color: T.text.secondary }} />}>
                Asiakkaalta laskutettu
              </SectionTitle>
              <div style={{ display: "flex", flexWrap: "wrap", gap: T.space.sm + 2 }}>
                <StatTile
                  label="Yhteensä"
                  value={fmtEurCents(billing.invoicedTotalCents ?? (billing.p1InvoicedCents + billing.p2InvoicedCents + (billing.hoursInvoicedCents ?? 0)))}
                  sub={report?.latestInvoice
                    ? `viimeisin: ${report.latestInvoice.label} ${fmtEurCents(report.latestInvoice.amountCents)}`
                    : "ei vielä laskuja"}
                  tone={T.tone.good}
                />
                {billing.agreedTotalCents > 0 && (
                  <StatTile
                    label="Urakka"
                    value={fmtEurCents(billing.p1InvoicedCents)}
                    sub={`${Math.min(4, billing.p1PayCount)}/4 erää · sopimus ${fmtEurCents(billing.agreedTotalCents)}`}
                  />
                )}
                {(billing.p2InvoicedCents > 0 || billing.p2RemainingCents > 0) && (
                  <StatTile
                    label="Keltaiset"
                    value={fmtEurCents(billing.p2InvoicedCents)}
                    sub={billing.p2RemainingCents > 0 ? `laskuttamatta ${fmtEurCents(billing.p2RemainingCents)}` : "ei laskuttamatonta"}
                    tone={billing.p2RemainingCents > 0 ? T.tone.warn : undefined}
                  />
                )}
                {(billing.hoursInvoicedCents ?? 0) > 0 && (
                  <StatTile
                    label="Tuntityö"
                    value={fmtEurCents(billing.hoursInvoicedCents ?? 0)}
                    sub={`${billing.hoursPayments ?? 0} laskua`}
                  />
                )}
              </div>
            </>
          )}
        </>
      )}

      {/* ══ 2. TEKIJÄT ════════════════════════════════════════════════════════ */}
      {!loading && !err && tab === "tekijat" && (
        <>
          <SectionTitle
            icon={<HandCoins style={{ width: 15, height: 15, color: T.text.secondary }} />}
            right={payable.length > 0 ? <WorkerEraInvoiceDialog jobId={jobId} workers={payable} variant="button" onSent={() => void load()} /> : undefined}
          >
            Tekijöille maksettavaa
          </SectionTitle>
          {payable.length === 0 ? (
            <>
              {attribution.any && (
                <UnattributedCard buckets={attribution.buckets} totalCents={attribution.totalCents} />
              )}
              <div style={card}>
                <p style={{ margin: 0, fontFamily: FONT, fontSize: T.size.sm, color: T.text.muted }}>
                  Ei maksettavia tekijöitä tällä keikalla. Lisää tekijät Tiimi-sivulla.
                </p>
              </div>
            </>
          ) : (
            <>
              <div style={{ display: "flex", flexWrap: "wrap", gap: T.space.sm + 2, marginBottom: T.space.md }}>
                <StatTile
                  label="Siirrettävä yhteensä"
                  value={fmtEurCents(workerToMove)}
                  sub={workerToMove > 0
                    ? (totals.pendingTotalCents > 0
                        ? `punaiset + keltaiset + tunnit · ${fmtEurCents(totals.pendingTotalCents)} odottaa kuittausta`
                        : "punaiset + keltaiset + tunnit")
                    : "kaikki maksettu ✓"}
                  tone={workerToMove > 0 ? T.tone.warn : T.text.muted}
                />
                <StatTile
                  label="Ikkunatyö"
                  value={fmtEurCents(totals.openP1Cents + totals.openP2Cents)}
                  sub={`${fmtWin(totals.p1Washed)} punaista · ${fmtWin(totals.p2Washed)} keltaista`}
                />
                <StatTile
                  label="Tuntityö"
                  value={fmtEurCents(totals.openHoursCents)}
                  sub={totals.hours > 0 ? `${fmtWin(totals.hours)} h kirjattu · ansaittu ${fmtEurCents(totals.hoursEarnedCents)}` : "ei kirjattuja tunteja"}
                />
                <StatTile
                  label="Hoidettu"
                  value={fmtEurCents(totals.settledTotalCents)}
                  sub={totals.pendingTotalCents > 0 ? `+ ${fmtEurCents(totals.pendingTotalCents)} odottaa kuittausta` : "maksut + erälaskut"}
                  tone={T.tone.good}
                />
              </div>
              {attribution.any && (
                <UnattributedCard buckets={attribution.buckets} totalCents={attribution.totalCents} />
              )}
              {totals.p2PendingCents > 0 && (
                <div style={{ ...card, marginBottom: T.space.md, borderColor: T.tone.infoBorder, background: T.tone.infoBg }}>
                  <p style={{ margin: 0, fontFamily: FONT, fontSize: T.size.sm, color: "rgba(190,205,255,0.95)", lineHeight: 1.5 }}>
                    Odottaa asiakkaan hyväksyntää: <strong>{fmtEurCents(totals.p2PendingCents)}</strong> keltaisista.
                  </p>
                </div>
              )}
              <div style={{ display: "flex", flexDirection: "column", gap: T.space.sm }}>
                {payable.map((r) => {
                  // Tuntematon tila EI saa kaataa koko välilehteä: palvelin voi
                  // olla uudempi kuin selaimen buildi. Sama varautuminen kuin
                  // sähköpostiraportin puolella.
                  const a = APPROVAL_CHIP[approvalOf(r)] ?? APPROVAL_CHIP.ei_laskua;
                  return (
                    <div key={r.workerId} style={{ ...card, padding: `${T.space.md}px ${T.space.lg}px` }}>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: T.space.sm + 2, flexWrap: "wrap" }}>
                        <div style={{ minWidth: 0 }}>
                          <p style={{ margin: 0, display: "flex", alignItems: "center", gap: T.space.sm, flexWrap: "wrap", fontFamily: FONT, fontSize: T.size.body, fontWeight: 700, color: T.text.primary }}>
                            {r.name}
                            <span style={chip(a.color, a.bg)}>{a.label}</span>
                          </p>
                          {/* ERITTELY: kolme virtaa omina riveinään. Tuntityö
                              näkyy tässä ensimmäistä kertaa — se on aina ollut
                              kirjattuna, mutta ei koskaan laskettuna. */}
                          <div style={{ marginTop: 4, display: "flex", flexDirection: "column", gap: 2 }}>
                            <p style={{ margin: 0, fontFamily: FONT, fontSize: T.size.xs, color: T.text.muted }}>
                              punaiset {fmtWin(r.p1Washed)} kpl · {fmtEurCents(r.openP1Cents)} siirrettävä
                              {r.p1AdjustmentCents !== 0 && (
                                <span style={{ color: "rgb(255,150,150)" }}>
                                  {" · sovittu "}{r.p1AdjustmentCents < 0 ? "vähennys −" : "lisä +"}{fmtEurCents(Math.abs(r.p1AdjustmentCents))}
                                </span>
                              )}
                            </p>
                            {/* KORJAUS OMALLA RIVILLÄÄN. Se ei kuulu minkään
                                yksittäisen virran perään: ero voi olla missä
                                tahansa niistä, ja sen piilottaminen punaisten
                                jatkoksi väittäisi sen koskevan punaisia. */}
                            {r.payoutFixCents !== 0 && (
                              <p style={{ margin: 0, fontFamily: FONT, fontSize: T.size.xs, color: "rgb(255,190,120)" }}>
                                sovittu summa · korjaus {r.payoutFixCents < 0 ? "−" : "+"}{fmtEurCents(Math.abs(r.payoutFixCents))}
                                {" · taksan mukaan "}{fmtEurCents(Math.max(0, r.openTotalCents + r.pendingTotalCents - r.payoutFixCents))}
                              </p>
                            )}
                            {(r.p2Washed > 0 || r.openP2Cents > 0 || r.p2PendingCents > 0) && (
                              <p style={{ margin: 0, fontFamily: FONT, fontSize: T.size.xs, color: r.openP2Cents > 0 ? T.tone.warn : T.text.muted }}>
                                keltaiset {fmtWin(r.p2Washed)} kpl pesty
                                {r.openP2Cents > 0 ? ` · maksamatta ${fmtWin(r.openP2Windows)} kpl` : ""}
                                {" · "}{fmtEurCents(r.openP2Cents)} siirrettävä
                                {r.p2PendingCents > 0 ? ` · odottaa asiakasta ${fmtEurCents(r.p2PendingCents)}` : ""}
                              </p>
                            )}
                            {(r.hours > 0 || r.openHoursCents > 0) && (
                              <p style={{ margin: 0, fontFamily: FONT, fontSize: T.size.xs, color: r.openHoursCents > 0 ? T.tone.warn : T.text.muted }}>
                                tunnit {fmtWin(r.hours)} h × {fmtEurCents(r.hourRateCents)} · {fmtEurCents(r.openHoursCents)} siirrettävä
                              </p>
                            )}
                            <p style={{ margin: 0, fontFamily: FONT, fontSize: T.size.xs, color: T.text.faint }}>
                              hoidettu {fmtEurCents(r.settledTotalCents)}
                              {r.pendingTotalCents > 0 ? ` · kuittaamatta ${fmtEurCents(r.pendingTotalCents)}` : ""}
                              {r.settledEras.length > 0 ? ` · erät ${r.settledEras.filter((n) => n > 0 && n < 9).join(", ") || "—"}` : ""}
                            </p>
                          </div>
                        </div>
                        <div style={{ textAlign: "right", flexShrink: 0 }}>
                          <p style={{ margin: 0, fontFamily: MONO, fontSize: T.size.label, letterSpacing: "0.1em", color: T.text.faint }}>SIIRRETTÄVÄ</p>
                          {/* Kuittaamaton luonnos on yhä siirrettävää rahaa:
                              se ei ole vielä liikkunut mihinkään. */}
                          <p style={{ margin: "2px 0 0", fontFamily: FONT, fontSize: T.size.title, fontWeight: 800, fontVariantNumeric: "tabular-nums", color: r.openTotalCents + r.pendingTotalCents > 0 ? T.tone.warn : T.text.faint }}>
                            {fmtEurCents(r.openTotalCents + r.pendingTotalCents)}
                          </p>
                        </div>
                      </div>
                      {onSetAdjustment && (
                        <AdjustmentControl
                          name={r.name}
                          cents={r.payoutFixCents}
                          currentTotalCents={r.openTotalCents + r.pendingTotalCents}
                          // Vähennys muuttaa maksettavaa, joten siirtoraportti
                          // haetaan uudelleen: muuten Siirrot-välilehti ja
                          // otsikkosumma jäivät näyttämään vanhaa lukua samalla
                          // kun tämä rivi päivittyi.
                          onSave={async (c) => { await onSetAdjustment(r.workerId, c); await load(); }}
                        />
                      )}
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </>
      )}

      {/* ══ 3. MINÄ & MATIAS ══════════════════════════════════════════════════ */}
      {!loading && !err && tab === "johtajat" && (
        <>
          {/* VIIMEINEN ERÄ ENSIN. Se on se maksu jonka kohdalla tasaus
              ratkaistaan: kumpi johtaja laskutti minkäkin erän Y-tunnuksellaan
              valitaan laskua lähettäessä (ei kiinteä erän mukaan), joten
              tässä ei arvata nimeä — viimeisen erän jälkeen kummankin
              kassassa on raha jota ei enää tule lisää. */}
          {billing && billing.agreedTotalCents > 0 && (
            <div style={{
              ...card, marginTop: T.space.lg,
              borderColor: billing.p1PayCount >= 4 ? T.tone.goodBorder : T.tone.warnBorder,
              background: billing.p1PayCount >= 4 ? T.tone.goodBg : T.tone.warnBg,
            }}>
              <div style={{ ...mono, marginBottom: T.space.xs }}>Viimeinen erä (erä 4)</div>
              <p style={{ margin: 0, fontFamily: FONT, fontSize: T.size.title, fontWeight: 700, color: T.text.primary }}>
                {billing.p1PayCount >= 4
                  ? <>Laskutettu ✓ · {fmtEurCents(billing.p1InvoicedCents)} / {fmtEurCents(billing.agreedTotalCents)}</>
                  : <>Laskuttamatta · seuraava erä {fmtEurCents(billing.nextInstalmentCents)}</>}
              </p>
              <p style={{ ...subLabel }}>
                {billing.p1PayCount >= 4
                  ? "Kaikki neljä erää on laskutettu — tasaus alla on lopullinen."
                  : `${Math.min(4, billing.p1PayCount)}/4 erää lähetetty. Tasaus tarkentuu jokaisen erän jälkeen.`}
              </p>
            </div>
          )}

          <SectionTitle icon={<Scale style={{ width: 15, height: 15, color: T.text.secondary }} />}>
            Keskinäiset siirrot
          </SectionTitle>
          {/* Kirjaus tasauksessa muuttaa siirtolistan lukuja, joten raportti
              haetaan uudelleen samalla — ei kahta eri totuutta välilehtien
              välillä. */}
          <TasausView jobId={jobId} canEdit={canEditTasaus} onChanged={load} />

          {/* VIIMEISIN JOHTAJIEN LASKU HETI NÄKYVIIN.
              Se oli ennen vain taittuvan "Johtajien väliset laskut" -osion
              sisällä, joten juuri lähetetty tasauslasku ei näkynyt tällä
              välilehdellä mitenkään: näkymä kysyi yhä samaa siirtoa jonka
              johtaja oli äsken laskuttanut. */}
          {latestFounderInvoice && (
            <div style={{ ...card, marginTop: T.space.md }}>
              <div style={{ ...mono, marginBottom: T.space.xs }}>Viimeisin johtajien lasku</div>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: T.space.sm + 2, flexWrap: "wrap" }}>
                <div style={{ minWidth: 0 }}>
                  <p style={{ margin: 0, fontFamily: FONT, fontSize: T.size.body, fontWeight: 700, color: T.text.primary, display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                    {founderName(latestFounderInvoice.senderId)}
                    <ArrowRight style={{ width: 13, height: 13, color: T.text.faint, flexShrink: 0 }} />
                    {founderName(latestFounderInvoice.recipientId)}
                    <TilaChip tila={latestFounderInvoice.tila} />
                  </p>
                  <p style={{ margin: "2px 0 0", fontFamily: FONT, fontSize: T.size.sm, color: T.text.muted }}>
                    {eraScopeLabel(latestFounderInvoice.eraNumbers)} · {fiDate(latestFounderInvoice.sentAt)}
                    {latestFounderInvoice.invoiceNumber ? <> · <span style={{ fontFamily: MONO }}>{latestFounderInvoice.invoiceNumber}</span></> : null}
                  </p>
                </div>
                <span style={{ flexShrink: 0, fontFamily: FONT, fontSize: T.size.title, fontWeight: 800, color: T.tone.good, fontVariantNumeric: "tabular-nums" }}>
                  {fmtEurCents(latestFounderInvoice.totalCents)}
                </span>
              </div>
              <div style={{ marginTop: T.space.sm, display: "flex", alignItems: "center", gap: T.space.sm, flexWrap: "wrap" }}>
                <DownloadPdfButton jobId={jobId} invoiceId={latestFounderInvoice.id} />
              </div>
            </div>
          )}

          <Fold
            icon={<Users style={{ width: 15, height: 15, color: T.text.secondary }} />}
            title="Johtajien väliset laskut"
            summary={s.founderInvoices.length > 0 ? `${s.founderInvoices.length} kpl` : "ei vielä"}
          >
            {s.founderInvoices.length === 0 ? (
              <div style={card}>
                <p style={{ margin: 0, fontFamily: FONT, fontSize: T.size.sm, color: T.text.muted }}>
                  Ei vielä johtajien välisiä laskuja.
                </p>
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: T.space.sm + 2 }}>
                {s.founderInvoices.map((inv) => (
                  <div key={inv.id} style={card}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: T.space.sm + 2, flexWrap: "wrap" }}>
                      <div style={{ minWidth: 0 }}>
                        <p style={{ margin: 0, fontFamily: FONT, fontSize: T.size.body, fontWeight: 700, color: T.text.primary }}>
                          {founderName(inv.senderId)} → {founderName(inv.recipientId)}
                        </p>
                        <p style={{ margin: "2px 0 0", fontFamily: FONT, fontSize: T.size.sm, color: T.text.muted }}>
                          {eraScopeLabel(inv.eraNumbers)} · {fiDate(inv.sentAt)}
                          {inv.invoiceNumber ? <> · <span style={{ fontFamily: MONO }}>{inv.invoiceNumber}</span></> : null}
                        </p>
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: T.space.sm + 2 }}>
                        <TilaChip tila={inv.tila} />
                        <span style={{ fontFamily: FONT, fontSize: T.size.title, fontWeight: 700, color: T.tone.good, fontVariantNumeric: "tabular-nums" }}>
                          {fmtEurCents(inv.totalCents)}
                        </span>
                      </div>
                    </div>
                    <EmailCopies inv={inv} />
                    <DownloadPdfButton jobId={jobId} invoiceId={inv.id} />
                  </div>
                ))}
              </div>
            )}
          </Fold>
        </>
      )}

      {/* ══ 4. ARKISTO ════════════════════════════════════════════════════════ */}
      {!loading && !err && tab === "arkisto" && (
        <>
          {/* Vanhan laskun lähetys uudelleen: vapaa vastaanottaja + mikä tahansa
              järjestelmän tuntema lasku-PDF liitteenä. */}
          <div style={{ ...card, marginTop: T.space.lg, display: "flex", alignItems: "center", justifyContent: "space-between", gap: T.space.md, flexWrap: "wrap" }}>
            <div style={{ minWidth: 0 }}>
              <p style={{ margin: 0, fontFamily: FONT, fontSize: T.size.body, fontWeight: 700, color: T.text.primary }}>Lähetä lasku sähköpostilla</p>
              <p style={{ ...subLabel }}>Mikä tahansa aiempi lasku liitteenä — johtajat saavat aina kopion.</p>
            </div>
            <SendInvoiceEmailDialog />
          </div>

          <Fold
            icon={<Users style={{ width: 15, height: 15, color: T.text.secondary }} />}
            title="Tekijöille tehdyt maksut"
            summary={liveWorkerInvoices.length > 0 ? `${liveWorkerInvoices.length} kpl` : "ei vielä"}
          >
            {liveWorkerInvoices.length === 0 ? (
              <div style={card}>
                <p style={{ margin: 0, fontFamily: FONT, fontSize: T.size.sm, color: T.text.muted }}>
                  Ei vielä tekijöille lähetettyjä maksuja.
                </p>
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: T.space.sm }}>
                {liveWorkerInvoices.map((inv) => {
                  const input = inv.rivit?.input || {};
                  const ikkunat = Number(input.pestytIkkunat) || 0;
                  const tunnit = Number(input.tunnit) || 0;
                  const sovittu = Number(input.sovittuMuutosCents) || 0;
                  const ennakko = Number(input.ennakkoCents) || 0;
                  return (
                    <div key={inv.id} style={{ ...card, padding: `${T.space.md}px ${T.space.lg}px` }}>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: T.space.sm + 2, flexWrap: "wrap" }}>
                        <div style={{ minWidth: 0 }}>
                          <p style={{ margin: 0, fontFamily: FONT, fontSize: T.size.sm, fontWeight: 700, color: T.text.primary }}>
                            {input.name || inv.senderId}
                            <span style={{ fontWeight: 500, color: T.text.muted }}> → {founderName(inv.recipientId)}</span>
                          </p>
                          <p style={{ margin: "2px 0 0", fontFamily: FONT, fontSize: T.size.xs, color: T.text.muted }}>
                            {eraScopeLabel(inv.eraNumbers)}
                            {ikkunat > 0 ? ` · ${fmtWin(ikkunat)} ikkunaa` : ""}
                            {tunnit > 0 ? ` · ${fmtWin(tunnit)} h` : ""}
                            {sovittu !== 0 ? ` · sovittu muutos ${sovittu > 0 ? "+" : "−"}${fmtEurCents(Math.abs(sovittu))}` : ""}
                            {ennakko > 0 ? ` · ennakko ${fmtEurCents(ennakko)}` : ""}
                            {" · luotu "}{fiDate(inv.createdAt)}
                          </p>
                        </div>
                        <div style={{ display: "flex", alignItems: "center", gap: T.space.sm + 2 }}>
                          <TilaChip tila={inv.tila} />
                          <span style={{ fontFamily: FONT, fontSize: T.size.lg, fontWeight: 700, color: T.tone.good, fontVariantNumeric: "tabular-nums" }}>
                            {fmtEurCents(inv.totalCents)}
                          </span>
                        </div>
                      </div>
                      <div style={{ marginTop: T.space.sm, paddingTop: T.space.sm, borderTop: T.border.divider, display: "flex", alignItems: "center", gap: T.space.sm + 2, flexWrap: "wrap" }}>
                        {inv.invoiceNumber && <DownloadPdfButton jobId={jobId} invoiceId={inv.id} />}
                        <VoidInvoiceButton jobId={jobId} invoiceId={inv.id} name={input.name || inv.senderId} onDone={load} />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </Fold>

          <Fold
            icon={<CheckCircle2 style={{ width: 15, height: 15, color: T.text.secondary }} />}
            title="Tekijöiden kuittaamat laskut"
            summary={s.workerAccepted.length > 0 ? `${s.workerAccepted.length} kpl` : "ei vielä"}
          >
            {s.workerAccepted.length === 0 ? (
              <div style={card}>
                <p style={{ margin: 0, fontFamily: FONT, fontSize: T.size.sm, color: T.text.muted }}>
                  Yksikään tekijä ei ole vielä lähettänyt laskuaan.
                </p>
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: T.space.sm }}>
                {s.workerAccepted.map((inv) => (
                  <div key={inv.id} style={{ ...card, padding: `${T.space.md}px ${T.space.lg}px` }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: T.space.sm + 2, flexWrap: "wrap" }}>
                      <div style={{ minWidth: 0 }}>
                        <p style={{ margin: 0, fontFamily: FONT, fontSize: T.size.sm, fontWeight: 700, color: T.text.primary }}>
                          {inv.rivit?.input?.name || inv.senderId}
                        </p>
                        <p style={{ margin: "2px 0 0", fontFamily: FONT, fontSize: T.size.xs, color: T.text.muted }}>
                          {eraScopeLabel(inv.eraNumbers)} · lähetetty {fiDate(inv.sentAt)}
                          {inv.invoiceNumber ? <> · <span style={{ fontFamily: MONO }}>{inv.invoiceNumber}</span></> : null}
                        </p>
                      </div>
                      <span style={{ fontFamily: FONT, fontSize: T.size.lg, fontWeight: 700, color: T.tone.good, fontVariantNumeric: "tabular-nums" }}>
                        {fmtEurCents(inv.totalCents)}
                      </span>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: T.space.sm + 2, flexWrap: "wrap" }}>
                      <DownloadPdfButton jobId={jobId} invoiceId={inv.id} />
                      <VoidInvoiceButton jobId={jobId} invoiceId={inv.id} name={inv.rivit?.input?.name || inv.senderId} onDone={load} />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Fold>

          {/* Mitätöidyt LUONNOKSET katoavat itsestään 2 vrk:ssa; mitätöidyt
              LÄHETETYT laskut ovat kirjanpidon tositteita ja säilyvät 6 vuotta. */}
          {(s.workerVoidedTemp.length > 0 || s.workerVoidedKept.length > 0) && (
            <Fold
              icon={<Archive style={{ width: 15, height: 15, color: T.text.muted }} />}
              title="Mitätöidyt"
              summary={`${s.workerVoidedTemp.length + s.workerVoidedKept.length} kpl`}
            >
              <div style={{ display: "flex", flexDirection: "column", gap: T.space.xs }}>
                {s.workerVoidedKept.map((inv) => (
                  <div key={inv.id} style={{ ...card, padding: `${T.space.sm}px ${T.space.lg}px`, opacity: 0.7 }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: T.space.sm, flexWrap: "wrap" }}>
                      <span style={{ fontFamily: FONT, fontSize: T.size.sm, color: T.text.secondary }}>
                        <span style={{ textDecoration: "line-through" }}>
                          {inv.rivit?.input?.name || inv.senderId} · {fmtEurCents(inv.totalCents)}
                        </span>
                        {inv.invoiceNumber ? <span style={{ fontFamily: MONO, marginLeft: 6 }}>{inv.invoiceNumber}</span> : null}
                        <span style={{ color: T.text.faint }}> · tosite säilyy</span>
                      </span>
                      <DownloadPdfButton jobId={jobId} invoiceId={inv.id} />
                    </div>
                  </div>
                ))}
                {s.workerVoidedTemp.map((inv) => (
                  <div key={inv.id} style={{ ...card, padding: `${T.space.sm}px ${T.space.lg}px`, opacity: 0.55 }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: T.space.sm, flexWrap: "wrap" }}>
                      <span style={{ fontFamily: FONT, fontSize: T.size.sm, color: T.text.secondary, textDecoration: "line-through" }}>
                        {inv.rivit?.input?.name || inv.senderId} · {eraScopeLabel(inv.eraNumbers)} · {fmtEurCents(inv.totalCents)}
                      </span>
                      <span style={{ fontFamily: MONO, fontSize: T.size.label, letterSpacing: "0.08em", color: T.text.muted }}>
                        <Trash2 style={{ width: 11, height: 11, display: "inline", verticalAlign: -1, marginRight: 4 }} />
                        {purgeCountdown(inv)}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </Fold>
          )}
        </>
      )}
    </div>
  );
}
