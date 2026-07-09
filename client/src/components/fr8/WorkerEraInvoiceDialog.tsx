/**
 * FR8 erälaskutus — johtajan "Maksu"-toiminto tekijöille (kohta 3A).
 *
 * Johtaja valitsee erät 1-3 tai erä 4, näkee jokaiselle tekijälle esitäytetyn
 * pestyt_ikkunat × 20 € -rivin (esitäyttö = tekijän tähänastinen pesty-ikkuna-
 * määrä koko keikalla — AINA muokattavissa, koska erän ikkunamäärä täytetään
 * käsin, ks. docs/fr8-era-laskutus-plan.md kohta 1), sekä erilliset "Sovittu
 * muutos" ja "Ennakko / jo maksettu" -kentät per tekijä. Lähetys luo per-tekijä
 * luonnos-laskut, jotka ilmestyvät tekijän omaan näkymään hyväksyttäväksi
 * (vaihe 3 — ei toteutettu vielä tässä dialogissa).
 */
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { computeEraBilling, type TekijaPesu } from "@shared/era-billing";
import { fmtEurCents } from "@shared/tax";
import { Wallet, Check } from "lucide-react";

interface WorkerRowState {
  pestytIkkunat: string;
  sovittuMuutosCents: string;
  ennakkoCents: string;
}

export default function WorkerEraInvoiceDialog({ jobId, workers, onSent }: {
  jobId: number;
  workers: { id: string; name: string; washed: number }[];
  onSent?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [era, setEra] = useState<"1-3" | "4">("1-3");
  const [rows, setRows] = useState<Record<string, WorkerRowState>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sentCount, setSentCount] = useState<number | null>(null);

  useEffect(() => {
    if (!open) return;
    setSentCount(null);
    setError(null);
    setRows((prev) => {
      const next: Record<string, WorkerRowState> = {};
      for (const w of workers) {
        next[w.id] = prev[w.id] ?? {
          pestytIkkunat: w.washed > 0 ? String(w.washed) : "",
          sovittuMuutosCents: "",
          ennakkoCents: "",
        };
      }
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const eraNumbers = era === "4" ? [4] : [1, 2, 3];

  const parsedWorkers: TekijaPesu[] = workers.map((w) => {
    const r = rows[w.id] || { pestytIkkunat: "", sovittuMuutosCents: "", ennakkoCents: "" };
    return {
      workerId: w.id,
      name: w.name,
      pestytIkkunat: Math.max(0, parseFloat(r.pestytIkkunat.replace(",", ".")) || 0),
      sovittuMuutosCents: Math.round((parseFloat(r.sovittuMuutosCents.replace(",", ".")) || 0) * 100),
      ennakkoCents: Math.round((parseFloat(r.ennakkoCents.replace(",", ".")) || 0) * 100),
    };
  });
  const preview = computeEraBilling(0, parsedWorkers, []);

  const setField = (id: string, field: keyof WorkerRowState, value: string) => {
    setRows((cur) => ({ ...cur, [id]: { ...cur[id], [field]: value } }));
  };

  const send = async () => {
    const activeWorkers = parsedWorkers.filter((w) => w.pestytIkkunat > 0 || w.sovittuMuutosCents !== 0 || w.ennakkoCents !== 0);
    if (activeWorkers.length === 0) { setError("Täytä ainakin yhden tekijän tiedot."); return; }
    setBusy(true);
    setError(null);
    const res = await api.createWorkerEraInvoiceBatch(jobId, { eraNumbers, workers: activeWorkers });
    setBusy(false);
    if (res.ok && res.data) {
      setSentCount(res.data.invoices.length);
      onSent?.();
    } else {
      setError(res.error || "Lähetys epäonnistui");
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button className="inline-flex items-center gap-2 rounded-2xl border bg-card px-4 py-3 text-left hover:bg-muted/40 transition-colors">
          <Wallet className="h-4 w-4 shrink-0" />
          <span className="text-sm font-bold">Maksu</span>
        </button>
      </DialogTrigger>
      <DialogContent className="max-w-lg max-h-[88vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-1.5"><Wallet className="h-4 w-4" /> Tekijöiden maksu</DialogTitle>
          <DialogDescription>Valitse erä ja tarkista/muokkaa jokaisen tekijän pestyt ikkunat, sovittu muutos ja ennakko.</DialogDescription>
        </DialogHeader>

        <div className="flex gap-2 mb-4">
          {(["1-3", "4"] as const).map((e) => (
            <button key={e} onClick={() => setEra(e)}
              className={`flex-1 rounded-xl border px-3 py-2 text-sm font-semibold ${era === e ? "border-primary bg-primary/10" : "border-border"}`}>
              {e === "1-3" ? "Erät 1-3" : "Erä 4"}
            </button>
          ))}
        </div>

        <div className="space-y-3">
          {workers.map((w) => {
            const r = rows[w.id] || { pestytIkkunat: "", sovittuMuutosCents: "", ennakkoCents: "" };
            const row = preview.workers.find((pw) => pw.workerId === w.id);
            return (
              <div key={w.id} className="rounded-xl border p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold">{w.name}</span>
                  {row && (
                    <span className="text-xs tabular-nums text-muted-foreground">
                      ansaittu {fmtEurCents(row.ansaittuCents)} · maksettava {fmtEurCents(row.maksettavaCents)}
                    </span>
                  )}
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <label className="text-[11px] text-muted-foreground">
                    Ikkunat
                    <Input type="text" inputMode="decimal" value={r.pestytIkkunat}
                      onChange={(e) => setField(w.id, "pestytIkkunat", e.target.value)}
                      className="h-8 mt-0.5 tabular-nums" />
                  </label>
                  <label className="text-[11px] text-muted-foreground">
                    Sovittu muutos (€)
                    <Input type="text" inputMode="decimal" value={r.sovittuMuutosCents}
                      onChange={(e) => setField(w.id, "sovittuMuutosCents", e.target.value)}
                      className="h-8 mt-0.5 tabular-nums" />
                  </label>
                  <label className="text-[11px] text-muted-foreground">
                    Ennakko (€)
                    <Input type="text" inputMode="decimal" value={r.ennakkoCents}
                      onChange={(e) => setField(w.id, "ennakkoCents", e.target.value)}
                      className="h-8 mt-0.5 tabular-nums" />
                  </label>
                </div>
              </div>
            );
          })}
        </div>

        <div className="flex items-center justify-between gap-3 mt-4 pt-3 border-t border-border">
          <span className="text-xs text-muted-foreground">
            Tekijät ansaittu yhteensä: <strong className="tabular-nums">{fmtEurCents(preview.tekijatAnsaittuYhtCents)}</strong>
          </span>
          <button onClick={send} disabled={busy}
            className="inline-flex items-center gap-1.5 rounded-lg bg-foreground px-4 py-2 text-xs font-semibold text-background disabled:opacity-40">
            {busy ? "Lähetetään…" : sentCount != null ? <><Check className="h-3.5 w-3.5" /> Lähetetty ({sentCount})</> : "Lähetä tekijöille"}
          </button>
        </div>
        {error && <p className="text-xs text-destructive mt-2">{error}</p>}
      </DialogContent>
    </Dialog>
  );
}
