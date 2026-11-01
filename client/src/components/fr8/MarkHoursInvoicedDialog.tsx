/**
 * "LASKU LÄHETETTY" — tuntilaskut kirjataan lähetetyiksi käsin annetuilla summilla.
 *
 * Kun lasku (tai kaksi) on lähtenyt järjestelmän ulkopuolta, johtaja kertoo tässä
 * montako laskua lähti ja minkä suuruinen kukin oli. Vahvistusruudun jälkeen:
 *   · jokainen lasku tallentuu omana maksurivinään kirjatulla summallaan, joten
 *     keikan tulot, johtajien tasaus ja kirjanpito päivittyvät kaikki yhdestä
 *     paikasta (`gig.payments`) — mitään ei tarvitse päivittää erikseen;
 *   · kaikki tähän mennessä kirjatut tunnit ja kulut menevät laskutetuiksi, ja
 *     "seuraavalle laskulle" alkaa nollasta.
 *
 * Ei lähetä sähköpostia eikä koske asiakkaaseen. Palvelin tekee kirjauksen
 * (`POST /gig/hours-invoice-record`); tämä vain kerää luvut ja näyttää mitä
 * tapahtuu ennen kuin mitään kirjataan.
 *
 * Toimii sekä FR8:n tummassa kuoressa että adminin vaalealla puolella: käyttää
 * shadcn-komponentteja ja teemamuuttujia (kuten WorkerEraInvoiceDialog), ei
 * kovakoodattuja värejä. Laukaisin tulee kutsujalta (`trigger`).
 */
import { useMemo, useState } from "react";
import { api } from "@/lib/api";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { BRAND_BILLERS } from "@shared/billers";
import { parseEuroInput, reconcileManualInvoices, MAX_MANUAL_INVOICES } from "@shared/manual-hours-invoice";
import { fmtEurCents } from "@shared/tax";
import { fmtShiftHours } from "@shared/project";
import { Check, Plus, X, AlertTriangle } from "lucide-react";

interface Row { key: number; amount: string; billerId: string; ref: string }

interface Props {
  jobId: number;
  /** Tuntilaskujen lukumäärä jonka näkymä näkee — palvelin kieltäytyy jos se on ehtinyt muuttua. */
  invoiceCount: number;
  /** Mitä seuraava lasku järjestelmän mukaan perii nyt. */
  expectedCents: number;
  /** Avoimet tunnit — näytetään, jotta näkee mitä nollautuu. */
  openHours: number;
  /** Painike joka avaa dialogin (kutsuja tyylittelee oman kuorensa mukaan). */
  trigger: React.ReactNode;
  /** Kutsutaan onnistuneen kirjauksen jälkeen: päivitä keikan laskutustila. */
  onRecorded: () => void;
  /** Kerro avaukset/sulkemiset, jos kutsuja haluaa esim. pysäyttää päivityksen. */
  onOpenChange?: (open: boolean) => void;
}

const today = () => new Date().toISOString().slice(0, 10);
let seq = 0;
const newRow = (billerId = ""): Row => ({ key: (seq += 1), amount: "", billerId, ref: "" });

export default function MarkHoursInvoicedDialog({ jobId, invoiceCount, expectedCents, openHours, trigger, onRecorded, onOpenChange }: Props) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<"form" | "confirm" | "done">("form");
  const [rows, setRows] = useState<Row[]>(() => [newRow(), newRow()]);
  const [sentOn, setSentOn] = useState(today);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [doneInfo, setDoneInfo] = useState<{ total: number; count: number; next: number } | null>(null);

  const parsed = useMemo(() => rows.map((r) => ({ ...r, cents: parseEuroInput(r.amount) })), [rows]);
  const rowOk = (r: (typeof parsed)[number]) => r.cents !== null && r.cents > 0 && !!r.billerId;
  // Tyhjiä rivejä ei vaadita: kaksi riviä on oletus, mutta yksi lasku riittää.
  const filled = parsed.filter((r) => r.amount.trim() !== "" || r.billerId !== "" || r.ref.trim() !== "");
  const valid = filled.length > 0 && filled.every(rowOk);
  const total = filled.reduce((s, r) => s + (r.cents ?? 0), 0);
  const rec = reconcileManualInvoices(expectedCents, total);
  const nameOf = (id: string) => BRAND_BILLERS.find((b) => b.id === id)?.name ?? id;

  const reset = () => {
    setStep("form"); setRows([newRow(), newRow()]); setSentOn(today()); setBusy(false); setError(null); setDoneInfo(null);
  };
  const changeOpen = (v: boolean) => {
    setOpen(v);
    onOpenChange?.(v);
    if (!v) reset();
  };
  const setRow = (key: number, patch: Partial<Row>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  const submit = async () => {
    setBusy(true); setError(null);
    const res = await api.recordHoursInvoices(jobId, {
      invoices: filled.map((r) => ({ amountCents: r.cents!, billerId: r.billerId, ...(r.ref.trim() ? { ref: r.ref.trim() } : {}) })),
      expectInvoiceCount: invoiceCount,
      sentOn: sentOn && sentOn !== today() ? sentOn : undefined,
    });
    setBusy(false);
    if (res.ok && res.data) {
      setDoneInfo({ total: res.data.recordedCents, count: res.data.count, next: res.data.nextRemainingCents });
      setStep("done");
      onRecorded(); // päivitä keikan luvut heti (nollautuu jo taustalla)
    } else {
      setError(res.error || "Kirjaus epäonnistui — mitään ei kirjattu.");
      setStep("form");
    }
  };

  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-w-lg max-h-[88vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-1.5">
            <Check className="h-4 w-4" /> Lasku lähetetty
          </DialogTitle>
          <DialogDescription>
            {step === "form" && "Kirjaa lähteneet laskut: yksi rivi per lasku, summa sellaisena kuin se laskulle kirjoitettiin."}
            {step === "confirm" && "Tarkista vielä — kirjauksen jälkeen laskut näkyvät tuloissa ja kirjanpidossa."}
            {step === "done" && "Valmis."}
          </DialogDescription>
        </DialogHeader>

        {step === "form" && (
          <div className="space-y-3">
            <div className="rounded-xl bg-muted/40 p-2.5 text-xs text-muted-foreground">
              Järjestelmän mukaan seuraava lasku olisi <b className="text-foreground tabular-nums">{fmtEurCents(expectedCents)}</b>
              {" "}({fmtShiftHours(openHours)} h avoimia tunteja). Annetut summat tallennetaan sellaisenaan.
            </div>

            {rows.map((r, i) => {
              const p = parsed[i];
              const bad = r.amount.trim() !== "" && p.cents === null;
              return (
                <div key={r.key} className="rounded-xl border p-2.5 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-semibold">Lasku {i + 1}</span>
                    {rows.length > 1 && (
                      <button type="button" onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))} aria-label={`Poista lasku ${i + 1}`}
                        className="shrink-0 rounded-full p-0.5 text-muted-foreground hover:bg-muted/60 hover:text-foreground transition-colors">
                        <X className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <Input
                      inputMode="decimal" placeholder="Summa €" value={r.amount}
                      onChange={(e) => setRow(r.key, { amount: e.target.value })}
                      aria-label={`Laskun ${i + 1} summa`} aria-invalid={bad}
                      className={`tabular-nums ${bad ? "border-destructive" : ""}`}
                    />
                    <Input
                      placeholder="Laskun nro (valinn.)" value={r.ref}
                      onChange={(e) => setRow(r.key, { ref: e.target.value })}
                      aria-label={`Laskun ${i + 1} numero`} maxLength={60}
                    />
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-xs text-muted-foreground">Laskuttaja:</span>
                    {BRAND_BILLERS.map((b) => {
                      const active = r.billerId === b.id;
                      return (
                        <button key={b.id} type="button" onClick={() => setRow(r.key, { billerId: b.id })} aria-pressed={active}
                          className={`rounded-full border px-3 py-1 text-xs font-semibold transition-colors ${active ? "border-primary bg-primary/10" : "border-border text-muted-foreground hover:bg-muted/40"}`}>
                          {active ? "✓ " : ""}{b.name.split(" ")[0]}
                        </button>
                      );
                    })}
                  </div>
                  {bad && <p className="text-xs text-destructive">Summa ei ole selvä luku (esim. 4620,50).</p>}
                </div>
              );
            })}

            {rows.length < MAX_MANUAL_INVOICES && (
              <button type="button" onClick={() => setRows((rs) => [...rs, newRow()])}
                className="flex items-center gap-1 text-xs font-semibold text-muted-foreground hover:text-foreground transition-colors">
                <Plus className="h-3.5 w-3.5" /> Lisää lasku
              </button>
            )}

            <div className="flex items-center gap-2">
              <label htmlFor="mhi-date" className="text-xs text-muted-foreground">Lähetyspäivä</label>
              <Input id="mhi-date" type="date" value={sentOn} max={today()} onChange={(e) => setSentOn(e.target.value || today())} className="w-auto" />
            </div>

            <div className="flex items-center justify-between rounded-xl border p-2.5">
              <span className="text-sm font-semibold">Yhteensä</span>
              <span className="text-base font-bold tabular-nums">{fmtEurCents(total)}</span>
            </div>
            {total > 0 && rec.diffCents !== 0 && (
              <p className="flex gap-1.5 text-xs text-amber-600 dark:text-amber-400">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>
                  {rec.diffCents < 0
                    ? `${fmtEurCents(-rec.diffCents)} vähemmän kuin järjestelmän laskema. Erotus jää seuraavalle laskulle.`
                    : `${fmtEurCents(rec.diffCents)} enemmän kuin järjestelmän laskema. Seuraava lasku pienenee vastaavasti myöhemmin kertyvästä työstä.`}
                </span>
              </p>
            )}
            {error && <p className="text-xs text-destructive" role="alert">{error}</p>}
            <Button className="w-full" disabled={!valid} onClick={() => { setError(null); setStep("confirm"); }}>
              Jatka
            </Button>
          </div>
        )}

        {step === "confirm" && (
          <div className="space-y-3">
            <div className="rounded-xl border divide-y">
              {filled.map((r, i) => (
                <div key={r.key} className="flex items-center justify-between gap-3 p-2.5">
                  <div className="min-w-0">
                    <div className="text-sm font-semibold">Lasku {i + 1}{r.ref.trim() ? ` · ${r.ref.trim()}` : ""}</div>
                    <div className="text-xs text-muted-foreground">{nameOf(r.billerId)}</div>
                  </div>
                  <span className="text-sm font-bold tabular-nums">{fmtEurCents(r.cents!)}</span>
                </div>
              ))}
              <div className="flex items-center justify-between p-2.5">
                <span className="text-sm font-semibold">Yhteensä</span>
                <span className="text-base font-bold tabular-nums">{fmtEurCents(total)}</span>
              </div>
            </div>
            <ul className="space-y-1 text-xs text-muted-foreground list-disc pl-4">
              <li>Lähetyspäivä {new Date(`${sentOn}T12:00:00`).toLocaleDateString("fi-FI")}.</li>
              <li>Kaikki tähän mennessä kirjatut tunnit ({fmtShiftHours(openHours)} h) ja kulut merkitään laskutetuiksi.</li>
              <li>
                Seuraavalle laskulle jää <b className="text-foreground tabular-nums">{fmtEurCents(rec.nextRemainingCents)}</b>
                {rec.nextRemainingCents === 0 ? " — se nollautuu." : " (ero järjestelmän laskemaan)."}
              </li>
              <li>Summat päivittyvät keikan tuloihin, johtajien yhteenvetoon ja kirjanpitoon.</li>
              <li>Asiakkaalle ei lähde mitään — tämä vain kirjaa jo lähteneet laskut.</li>
            </ul>
            {error && <p className="text-xs text-destructive" role="alert">{error}</p>}
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" disabled={busy} onClick={() => setStep("form")}>Takaisin</Button>
              <Button className="flex-1" disabled={busy} onClick={submit}>
                {busy ? "Kirjataan…" : `Kyllä, ${filled.length === 1 ? "lasku on" : "laskut on"} lähetetty`}
              </Button>
            </div>
          </div>
        )}

        {step === "done" && doneInfo && (
          <div className="space-y-3">
            <p className="flex items-start gap-1.5 text-sm">
              <Check className="mt-0.5 h-4 w-4 shrink-0 text-green-600" />
              <span>
                {doneInfo.count === 1 ? "1 lasku" : `${doneInfo.count} laskua`} kirjattu, yhteensä{" "}
                <b className="tabular-nums">{fmtEurCents(doneInfo.total)}</b>. Seuraavalle laskulle:{" "}
                <b className="tabular-nums">{fmtEurCents(doneInfo.next)}</b>.
              </span>
            </p>
            <Button className="w-full" onClick={() => changeOpen(false)}>Sulje</Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
