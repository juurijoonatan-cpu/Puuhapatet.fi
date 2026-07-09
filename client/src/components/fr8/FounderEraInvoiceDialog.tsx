/**
 * FR8 erälaskutus — johtaja-välinen ristiinlasku (kohta 3C).
 *
 * Näkyy VAIN toisen johtajan rivillä (ei omalla) — ks. crew.tsx:n integraatio.
 * Vastaanottaja määräytyy AINA erän numerosta (1-3 → Joonatan, 4 → Matias),
 * ei rivistä jota klikattiin (käyttäjän vahvistama sääntö). Koska tämä dialogi
 * on sidottu yhteen kiinteään vastaanottajaan (`recipient`-propiin), sallittu
 * erävalinta typistyy käytännössä yhteen ainoaan vaihtoehtoon — järjestelmässä
 * ei koskaan tarjota erää, joka reitittäisi lähettäjän laskuttamaan itseään.
 *
 * Lähetys lukitsee laskun heti (ei erillistä hyväksyntää vastaanottajalta).
 * PDF + sähköpostikopiot molemmille toteutetaan vaiheessa 4.
 */
import { useEffect, useState } from "react";
import { api, type EraInvoiceClient } from "@/lib/api";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { computeEraBilling, TEKIJA_HINTA_CENTS } from "@shared/era-billing";
import { fmtEurCents } from "@shared/tax";
import { Wallet, Check } from "lucide-react";

/** Eräpäivän oletusehdotus: 14 vrk tästä hetkestä ("YYYY-MM-DD"). Johtaja voi
 *  aina vaihtaa tämän — ei enää kiinteä oletus laskun lähetyshetkellä. */
function defaultDueDate(): string {
  return new Date(Date.now() + 14 * 24 * 3600 * 1000).toISOString().slice(0, 10);
}

export default function FounderEraInvoiceDialog({ jobId, senderId, senderName, recipient, onSent }: {
  jobId: number;
  senderId: string;
  senderName: string;
  recipient: { id: string; name: string };
  onSent?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [itsepestyt, setItsepestyt] = useState("");
  const [kokonaisikkunat, setKokonaisikkunat] = useState("");
  const [totalEur, setTotalEur] = useState("");
  const [manualEur, setManualEur] = useState("");
  const [dueDate, setDueDate] = useState(defaultDueDate);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sentInvoice, setSentInvoice] = useState<EraInvoiceClient | null>(null);
  const [tekijatSum, setTekijatSum] = useState<{ ikkunat: number; ansaittuCents: number }>({ ikkunat: 0, ansaittuCents: 0 });

  // Tämä lasku laskutetaan aina samasta erästä, koska recipient on kiinteä.
  const eraNumbers = recipient.id === "matias" ? [4] : [1, 2, 3];

  useEffect(() => {
    if (!open) return;
    setError(null);
    setSentInvoice(null);
    setDueDate(defaultDueDate());
    void (async () => {
      const res = await api.getEraInvoices(jobId);
      if (!res.ok || !res.data) return;
      const matching = res.data.invoices.filter((inv) =>
        inv.kind === "tekija" && inv.tila !== "hylätty" && inv.eraNumbers.some((n) => eraNumbers.includes(n)));
      const ikkunat = matching.reduce((s, inv) => s + (inv.rivit?.input?.pestytIkkunat || 0), 0);
      const ansaittuCents = matching.reduce((s, inv) => s + (inv.rivit?.computed?.ansaittuCents || 0), 0);
      setTekijatSum({ ikkunat, ansaittuCents });
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const itsepestytN = Math.max(0, parseFloat(itsepestyt.replace(",", ".")) || 0);
  const kokonaisikkunatN = Math.max(0, parseFloat(kokonaisikkunat.replace(",", ".")) || 0);
  const totalCents = Math.round((parseFloat(totalEur.replace(",", ".")) || 0) * 100);
  const manualAdjustmentCents = Math.round((parseFloat(manualEur.replace(",", ".")) || 0) * 100);
  const recipientPestyt = kokonaisikkunatN - tekijatSum.ikkunat - itsepestytN;
  const windowMismatch = recipientPestyt < -0.001;

  const syntheticWorkers = tekijatSum.ikkunat > 0 || tekijatSum.ansaittuCents !== 0
    ? [{
        workerId: "_tekijat_yht", name: "Tekijät yhteensä", pestytIkkunat: tekijatSum.ikkunat,
        sovittuMuutosCents: tekijatSum.ansaittuCents - Math.round(tekijatSum.ikkunat * TEKIJA_HINTA_CENTS),
        ennakkoCents: 0,
      }]
    : [];
  const preview = totalCents > 0 && kokonaisikkunatN > 0 && !windowMismatch
    ? computeEraBilling(totalCents, syntheticWorkers, [
        { founderId: senderId, name: senderName, pestytIkkunat: itsepestytN },
        { founderId: recipient.id, name: recipient.name, pestytIkkunat: recipientPestyt },
      ])
    : null;
  const senderRow = preview?.founders.find((f) => f.founderId === senderId) || null;
  const yhteensaCents = (senderRow?.loppusummaCents || 0) + manualAdjustmentCents;

  const send = async () => {
    if (windowMismatch) { setError("Ikkunamäärä ei täsmää — kokonaisikkunat on pienempi kuin tekijät + omat."); return; }
    if (totalCents <= 0) { setError("Kokonaissumma puuttuu."); return; }
    setBusy(true);
    setError(null);
    const res = await api.sendFounderEraInvoice(jobId, {
      eraNumbers, senderId, itsepestytIkkunat: itsepestytN, kokonaisikkunat: kokonaisikkunatN,
      totalCents, manualAdjustmentCents: manualAdjustmentCents || undefined, dueDate,
    });
    setBusy(false);
    if (res.ok && res.data) {
      setSentInvoice(res.data.invoice);
      onSent?.();
    } else {
      setError(res.error || "Lähetys epäonnistui");
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button className="inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] font-semibold hover:bg-muted/40 transition-colors">
          <Wallet className="h-3.5 w-3.5" /> Maksut
        </button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-1.5"><Wallet className="h-4 w-4" /> Lasku {recipient.name}lle</DialogTitle>
          <DialogDescription>
            Erä {eraNumbers.join("-")} · tekijät tähän mennessä {tekijatSum.ikkunat} ikkunaa, {fmtEurCents(tekijatSum.ansaittuCents)}
          </DialogDescription>
        </DialogHeader>

        {sentInvoice ? (
          <div className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 p-4 text-sm">
            <p className="font-semibold flex items-center gap-1.5"><Check className="h-4 w-4" /> Lasku lähetetty ja lukittu</p>
            <p className="mt-1 text-muted-foreground">
              {sentInvoice.invoiceNumber} · {fmtEurCents(sentInvoice.totalCents)} → {recipient.name}
            </p>
          </div>
        ) : (
          <>
            <div className="space-y-3">
              <label className="block text-[11px] text-muted-foreground">
                Itsepestyt ikkunat ({senderName})
                <Input type="text" inputMode="decimal" value={itsepestyt} onChange={(e) => setItsepestyt(e.target.value)} className="h-9 mt-0.5 tabular-nums" />
              </label>
              <label className="block text-[11px] text-muted-foreground">
                Erän ikkunamäärä yhteensä (tekijät + molemmat johtajat)
                <Input type="text" inputMode="decimal" value={kokonaisikkunat} onChange={(e) => setKokonaisikkunat(e.target.value)} className="h-9 mt-0.5 tabular-nums" />
              </label>
              <label className="block text-[11px] text-muted-foreground">
                Erän kokonaissumma S (€)
                <Input type="text" inputMode="decimal" value={totalEur} onChange={(e) => setTotalEur(e.target.value)} className="h-9 mt-0.5 tabular-nums" />
              </label>
              <label className="block text-[11px] text-muted-foreground">
                Vapaa muokkaus (€, +/-)
                <Input type="text" inputMode="decimal" value={manualEur} onChange={(e) => setManualEur(e.target.value)} className="h-9 mt-0.5 tabular-nums" />
              </label>
              <label className="block text-[11px] text-muted-foreground">
                Eräpäivä
                <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className="h-9 mt-0.5" />
              </label>
            </div>

            {windowMismatch && (
              <p className="text-xs text-destructive mt-3">
                Ikkunamäärä ei täsmää: kokonaisikkunat pienempi kuin tekijät ({tekijatSum.ikkunat}) + omat ({itsepestytN}).
              </p>
            )}

            {preview && senderRow && !windowMismatch && (
              <div className="mt-4 pt-3 border-t border-border space-y-1 text-xs">
                <div className="flex justify-between"><span className="text-muted-foreground">x (€/ikkuna)</span><span className="tabular-nums">{fmtEurCents(preview.xCents)}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Omat ansiot</span><span className="tabular-nums">{fmtEurCents(senderRow.omatCents)}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Kate</span><span className="tabular-nums">{fmtEurCents(preview.kateCents)}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Kate / 2</span><span className="tabular-nums">{fmtEurCents(senderRow.katePerJohtajaCents)}</span></div>
                <div className="flex justify-between font-semibold pt-1 border-t border-border/60">
                  <span>Yhteensä (ennen vapaata muokkausta)</span><span className="tabular-nums">{fmtEurCents(senderRow.loppusummaCents)}</span>
                </div>
                <div className="flex justify-between font-bold text-sm">
                  <span>Lasketaan {recipient.name}lle</span><span className="tabular-nums text-emerald-600">{fmtEurCents(yhteensaCents)}</span>
                </div>
              </div>
            )}

            <div className="flex justify-end mt-4">
              <button onClick={send} disabled={busy}
                className="inline-flex items-center gap-1.5 rounded-lg bg-foreground px-4 py-2 text-xs font-semibold text-background disabled:opacity-40">
                {busy ? "Lähetetään…" : "Lähetä lasku"}
              </button>
            </div>
            {error && <p className="text-xs text-destructive mt-2">{error}</p>}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
