/**
 * Single-worker admin view — /admin/tiimi/:workerId (HOST only).
 *
 * Opens by clicking a person's profile photo anywhere (dashboard, crew,
 * tax-export). Aggregates ONE worker across every gig: profile, money movement
 * (earned / paid / open + each payout), and documents (their auto invoices +
 * hand-attached receipts). Tax details (ennakkoperintä / ennakonpidätys / ALV)
 * ride quietly on each row via the existing shared/tax.ts logic — never a big
 * section of their own. Each manual document carries a 6-year retention date in
 * the background.
 */
import { useEffect, useState, useCallback } from "react";
import { useRoute, useLocation } from "wouter";
import { ArrowLeft, Wallet, FileText, Plus, Download, Loader2, Paperclip } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api, type WorkerDetail } from "@/lib/api";
import { getAdminProfile } from "@/lib/admin-profile";
import { computeTax, readVatStatus, readInPrepaymentRegister, readPayeeType, fmtPct } from "@shared/tax";
import { MAX_CREW_DOC_LEN, retentionFromDate } from "@shared/crew";

const eur = (c: number) => (c / 100).toLocaleString("fi-FI", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";
const fmtDate = (ms: number) => new Date(ms).toLocaleDateString("fi-FI", { day: "numeric", month: "numeric", year: "numeric" });

export default function AdminWorkerDetailPage() {
  const [, params] = useRoute("/admin/tiimi/:workerId");
  const [, navigate] = useLocation();
  const workerId = params?.workerId ?? "";
  const isHost = getAdminProfile()?.role === "HOST";

  const [data, setData] = useState<WorkerDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await api.getWorker(workerId);
    if (res.ok && res.data) { setData(res.data); setErr(null); }
    else setErr(res.error || "Työntekijää ei löytynyt");
    setLoading(false);
  }, [workerId]);

  useEffect(() => { if (workerId) load(); }, [workerId, load]);

  // Redirect non-hosts away — this view is founders-only.
  useEffect(() => { if (!isHost) navigate("/admin"); }, [isHost, navigate]);
  if (!isHost) return null;

  if (loading) return <div className="min-h-screen flex items-center justify-center text-muted-foreground">Ladataan…</div>;
  if (err || !data) {
    return (
      <div className="min-h-screen bg-background admin-shell-pad">
        <div className="mx-auto max-w-2xl px-4">
          <BackLink onClick={() => navigate("/admin")} />
          <p className="text-sm text-amber-600">{err || "Ei tietoja"}</p>
        </div>
      </div>
    );
  }

  const { worker, totals, payouts, documents } = data;
  const answers = worker.answers || {};
  const initials = (worker.name || "?").trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase();

  // Tax details for one labour amount (snapshot if present) — used to whisper the
  // register / withholding / ALV status on each row. Uses shared/tax.ts as-is.
  const taxLine = (laborCents: number, snapshot?: any): string => {
    const tx = snapshot ?? computeTax({
      laborCents,
      vatStatus: readVatStatus(answers),
      inPrepaymentRegister: readInPrepaymentRegister(answers),
      payeeType: readPayeeType(answers),
    });
    const parts: string[] = [];
    parts.push(readInPrepaymentRegister(answers) ? "ennakkoperintärekisterissä" : "ei ennakkoperintärekisterissä");
    if (tx.withheld) parts.push(`ennakonpidätys ${fmtPct(tx.withholdingRate)} (${eur(tx.withholdingCents)})`);
    if (tx.vatRegistered) parts.push(`ALV ${fmtPct(tx.vatRate)}`);
    return parts.join(" · ");
  };

  // Documents shown = the worker's AUTO invoices (from paid payouts) + the
  // hand-attached ones, newest first.
  const invoiceDocs = payouts
    .filter((p) => p.status === "maksettu" && p.invoiceNo)
    .map((p) => ({
      key: `inv_${p.id}`,
      date: p.paidAt || p.createdAt,
      title: `Lasku ${p.invoiceNo}`,
      sub: p.gigName,
      amountCents: p.tax?.payableCents ?? p.amountCents,
      href: `/api/crew/${p.token}/payout/${p.id}/invoice.pdf`,
      retention: retentionFromDate(p.paidAt || p.createdAt),
      auto: true as const,
      tax: taxLine(p.amountCents, p.tax),
    }));
  const manualDocs = documents.map((d) => ({
    key: `doc_${d.id}`,
    date: d.date,
    title: d.desc || d.fileName || "Liite",
    sub: d.kind === "kuitti" ? "Kuitti" : d.kind === "lasku" ? "Lasku" : "Liite",
    amountCents: d.amountCents,
    href: d.fileDataUrl,
    retention: d.retentionUntil,
    auto: false as const,
    tax: taxLine(d.amountCents ?? 0),
  }));
  const allDocs = [...invoiceDocs, ...manualDocs].sort((a, b) => b.date - a.date);

  return (
    <div className="min-h-screen bg-background admin-shell-pad">
      <div className="mx-auto max-w-2xl px-4">
        <BackLink onClick={() => navigate("/admin")} />

        {/* 1 — Profiili */}
        <Card className="p-5 bg-card border-0 premium-shadow mb-4">
          <div className="flex items-center gap-4">
            <div className="relative grid h-16 w-16 shrink-0 place-items-center overflow-hidden rounded-full bg-muted text-lg font-bold text-muted-foreground">
              {initials}
              <img
                src={worker.photoDataUrl || `/fr8/${worker.id}.jpg`}
                alt={worker.name}
                className="absolute inset-0 h-full w-full object-cover"
                onError={(e) => { e.currentTarget.style.display = "none"; }}
              />
            </div>
            <div className="min-w-0">
              <h1 className="text-xl font-bold truncate">{worker.name}</h1>
              <p className="text-xs text-muted-foreground">{worker.role === "host" ? "Perustaja" : "Tekijä"}{worker.yTunnus ? ` · Y-tunnus ${worker.yTunnus}` : ""}</p>
              {[worker.phone, worker.email, worker.city].filter(Boolean).length > 0 && (
                <p className="text-xs text-muted-foreground mt-1 break-words">
                  {[worker.phone, worker.email, worker.city].filter(Boolean).join(" · ")}
                </p>
              )}
            </div>
          </div>
        </Card>

        {/* 2 — Rahaliikenne */}
        <Card className="p-5 bg-card border-0 premium-shadow mb-4">
          <h2 className="flex items-center gap-1.5 text-sm font-bold mb-3"><Wallet className="h-4 w-4" /> Rahaliikenne</h2>
          <div className="grid grid-cols-3 gap-2 mb-4 text-center">
            <Metric label="Ansaittu" value={eur(totals.earnedCents)} />
            <Metric label="Maksettu" value={eur(totals.paidCents)} tone="text-green-600" />
            <Metric label="Avoinna" value={eur(totals.openCents)} tone={totals.openCents > 0 ? "text-amber-600" : undefined} />
          </div>
          {payouts.length === 0 ? (
            <p className="text-[11px] text-muted-foreground">Ei vielä maksuja.</p>
          ) : (
            <div className="divide-y divide-border">
              {payouts.map((p) => {
                const st = p.status === "maksettu" ? { label: "Maksettu", cls: "text-green-600" }
                  : p.status === "hyvaksytty" ? { label: "Hyväksytty", cls: "text-blue-600" }
                  : { label: "Odottaa", cls: "text-amber-600" };
                return (
                  <div key={p.id} className="py-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate">{p.note || "Ikkunanpesutyö"}</p>
                        <p className="text-[11px] text-muted-foreground truncate">{fmtDate(p.createdAt)} · {p.gigName}</p>
                      </div>
                      <div className="shrink-0 text-right">
                        <p className="text-sm font-bold tabular-nums">{eur(p.amountCents)}</p>
                        <p className={`text-[10px] font-semibold ${st.cls}`}>{st.label}</p>
                      </div>
                    </div>
                    {/* Verotiedot hiljaa rivin alla */}
                    <p className="text-[10px] text-muted-foreground/80 mt-1">{taxLine(p.amountCents, p.tax)}</p>
                  </div>
                );
              })}
            </div>
          )}
        </Card>

        {/* 3 — Dokumentit */}
        <Card className="p-5 bg-card border-0 premium-shadow mb-4">
          <h2 className="flex items-center gap-1.5 text-sm font-bold mb-3"><FileText className="h-4 w-4" /> Dokumentit</h2>
          {allDocs.length === 0 ? (
            <p className="text-[11px] text-muted-foreground mb-3">Ei vielä dokumentteja. Laskut syntyvät automaattisesti kun maksu merkitään maksetuksi.</p>
          ) : (
            <div className="divide-y divide-border mb-3">
              {allDocs.map((d) => (
                <div key={d.key} className="py-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate flex items-center gap-1.5">
                        {d.auto ? <FileText className="h-3.5 w-3.5 text-muted-foreground shrink-0" /> : <Paperclip className="h-3.5 w-3.5 text-muted-foreground shrink-0" />}
                        {d.title}
                      </p>
                      <p className="text-[11px] text-muted-foreground truncate">
                        {fmtDate(d.date)}{d.sub ? ` · ${d.sub}` : ""}{d.auto ? " · automaattinen" : ""}
                      </p>
                    </div>
                    <div className="shrink-0 flex items-center gap-2">
                      {d.amountCents != null && <span className="text-sm font-semibold tabular-nums">{eur(d.amountCents)}</span>}
                      {d.href && (
                        <a href={d.href} target="_blank" rel="noreferrer" download={d.auto ? undefined : true}>
                          <Button variant="outline" size="icon" className="h-8 w-8"><Download className="h-4 w-4" /></Button>
                        </a>
                      )}
                    </div>
                  </div>
                  {/* Verotiedot + säilytys hiljaa */}
                  <p className="text-[10px] text-muted-foreground/80 mt-1">
                    {d.tax} · säilytys {new Date(d.retention).getFullYear()} asti
                  </p>
                </div>
              ))}
            </div>
          )}
          <AddDocument workerId={workerId} onAdded={load} />
        </Card>
      </div>
    </div>
  );
}

function BackLink({ onClick }: { onClick: () => void }) {
  return (
    <button onClick={onClick} className="flex items-center gap-1 text-sm text-muted-foreground mb-4">
      <ArrowLeft className="h-4 w-4" /> Takaisin
    </button>
  );
}

function Metric({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="rounded-xl bg-muted/40 py-2">
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={`text-sm font-bold tabular-nums ${tone ?? ""}`}>{value}</p>
    </div>
  );
}

/** Attach a document by hand: date, description, amount, and a file (image/PDF). */
function AddDocument({ workerId, onAdded }: { workerId: string; onAdded: () => void }) {
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [desc, setDesc] = useState("");
  const [amount, setAmount] = useState("");
  const [kind, setKind] = useState<"kuitti" | "lasku" | "muu">("kuitti");
  const [file, setFile] = useState<{ name: string; dataUrl: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const pickFile = async (f?: File) => {
    if (!f) return;
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(String(fr.result));
      fr.onerror = () => reject(new Error("read"));
      fr.readAsDataURL(f);
    });
    if (dataUrl.length > MAX_CREW_DOC_LEN) { setMsg("Tiedosto on liian iso (max ~1,5 MB). Pienennä kuvaa."); return; }
    setMsg(null);
    setFile({ name: f.name, dataUrl });
  };

  const submit = async () => {
    if (!desc.trim() && !file) { setMsg("Anna kuvaus tai tiedosto."); return; }
    setBusy(true); setMsg(null);
    const cents = amount.trim() ? Math.round(parseFloat(amount.replace(",", ".")) * 100) : undefined;
    const res = await api.addWorkerDocument(workerId, {
      date: new Date(date + "T12:00:00").getTime(),
      desc: desc.trim(),
      amountCents: Number.isFinite(cents as number) ? cents : undefined,
      fileName: file?.name,
      fileDataUrl: file?.dataUrl,
      kind,
    });
    setBusy(false);
    if (res.ok) { setOpen(false); setDesc(""); setAmount(""); setFile(null); setKind("kuitti"); onAdded(); }
    else setMsg(res.error || "Tallennus epäonnistui.");
  };

  if (!open) {
    return (
      <button onClick={() => { setOpen(true); setMsg(null); }} className="w-full inline-flex items-center justify-center gap-1.5 rounded-lg border border-dashed py-2 text-xs font-medium text-muted-foreground">
        <Plus className="h-3.5 w-3.5" /> Lisää kuitti / liite
      </button>
    );
  }
  return (
    <div className="rounded-xl border bg-card p-3 space-y-2.5">
      <div className="flex gap-2">
        <label className="flex-1 text-[11px] text-muted-foreground">
          Päivämäärä
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="mt-1 h-9" />
        </label>
        <label className="w-28 text-[11px] text-muted-foreground">
          Summa (€)
          <Input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" placeholder="esim. 45,00" className="mt-1 h-9" />
        </label>
      </div>
      <label className="block text-[11px] text-muted-foreground">
        Kuvaus
        <Input value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="esim. Lasinpesuaine, kuitti K-Rauta" className="mt-1 h-9" />
      </label>
      <div className="flex items-center gap-2">
        <select value={kind} onChange={(e) => setKind(e.target.value as any)} className="h-9 rounded-md border bg-background px-2 text-sm text-foreground">
          <option value="kuitti">Kuitti</option>
          <option value="lasku">Lasku</option>
          <option value="muu">Muu</option>
        </select>
        <label className="flex-1 inline-flex items-center gap-2 h-9 rounded-md border bg-background px-3 text-xs text-muted-foreground cursor-pointer truncate">
          <Paperclip className="h-3.5 w-3.5 shrink-0" />
          {file ? file.name : "Liitä tiedosto (kuva/PDF)"}
          <input type="file" accept="image/*,application/pdf" className="hidden" onChange={(e) => pickFile(e.target.files?.[0])} />
        </label>
      </div>
      {msg && <p className="text-[11px] text-amber-600">{msg}</p>}
      <div className="flex gap-2">
        <Button onClick={submit} disabled={busy} className="flex-1 h-9">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Tallenna dokumentti"}
        </Button>
        <Button variant="outline" onClick={() => setOpen(false)} className="h-9">Peruuta</Button>
      </div>
    </div>
  );
}
