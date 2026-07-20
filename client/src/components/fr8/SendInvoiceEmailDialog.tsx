/**
 * Vapaa sähköposti + valinnainen olemassa oleva lasku-PDF liitteenä (kohta:
 * Maksut-välilehden "Lähetä sähköposti" -painike).
 *
 * Johtaja kirjoittaa vastaanottajan(t) ja viestin itse, ja voi valita liitteeksi
 * MINKÄ TAHANSA järjestelmän tuntemat lasku-PDF:n (erälasku tai maksettu
 * tekijän maksulasku, miltä tahansa keikalta) — tai lähettää ilman liitettä.
 * PDF regeneroidaan lennossa palvelimella valinnan hetkellä, ei tallenneta
 * erikseen, joten se on aina ajan tasalla (ks. server/routes.ts POST
 * /api/admin/invoices/email). Perustajat (Matias + Joonatan) saavat aina
 * kopion — palvelin lisää sen, tätä ei voi ottaa pois täältä.
 */
import { useEffect, useMemo, useState } from "react";
import { api, type InvoiceListItem } from "@/lib/api";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { fmtEurCents } from "@shared/tax";
import { useIsMobile } from "@/hooks/use-mobile";
import { Mail, Check, Paperclip, X, Search } from "lucide-react";

function splitEmails(raw: string): string[] {
  return Array.from(new Set(
    raw.split(/[,;\s]+/).map((s) => s.trim().toLowerCase()).filter((s) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)),
  ));
}

export default function SendInvoiceEmailDialog() {
  const m = useIsMobile();
  const [open, setOpen] = useState(false);
  const [to, setTo] = useState("");
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [invoices, setInvoices] = useState<InvoiceListItem[]>([]);
  const [loadingInvoices, setLoadingInvoices] = useState(false);
  const [search, setSearch] = useState("");
  const [selectedRef, setSelectedRef] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  useEffect(() => {
    if (!open) return;
    setSent(false);
    setError(null);
    setLoadingInvoices(true);
    void api.getAllInvoices().then((res) => {
      if (res.ok && res.data) setInvoices(res.data.invoices);
      setLoadingInvoices(false);
    });
  }, [open]);

  const selected = invoices.find((i) => i.ref === selectedRef) || null;
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = !q ? invoices : invoices.filter((i) =>
      `${i.jobLabel} ${i.partyLabel} ${i.invoiceNumber ?? ""}`.toLowerCase().includes(q));
    return list.slice(0, 60);
  }, [invoices, search]);

  const toList = splitEmails(to);

  const send = async () => {
    if (toList.length === 0) { setError("Vähintään yksi kelvollinen sähköpostiosoite vaaditaan."); return; }
    if (!message.trim()) { setError("Kirjoita viesti."); return; }
    setBusy(true);
    setError(null);
    const res = await api.sendInvoiceEmail({
      to: toList,
      message: message.trim(),
      subject: subject.trim() || undefined,
      invoiceRef: selectedRef || undefined,
    });
    setBusy(false);
    if (res.ok) {
      setSent(true);
    } else {
      setError(res.error || "Lähetys epäonnistui");
    }
  };

  const reset = () => {
    setTo(""); setSubject(""); setMessage(""); setSelectedRef(null); setSearch(""); setSent(false); setError(null);
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) reset(); }}>
      <DialogTrigger asChild>
        <button type="button"
          style={{
            display: "flex", alignItems: "center", gap: 6, flexShrink: 0, padding: "8px 12px",
            borderRadius: 10, cursor: "pointer", border: "1px solid rgba(255,255,255,0.12)",
            background: "rgba(255,255,255,0.04)", color: "rgba(255,255,255,0.75)",
            fontFamily: "var(--font-onest, system-ui, sans-serif)", fontSize: 12, fontWeight: 600,
          }}>
          <Mail style={{ width: 13, height: 13 }} /> Lähetä sähköposti
        </button>
      </DialogTrigger>
      <DialogContent className="max-w-lg max-h-[88vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-1.5"><Mail className="h-4 w-4" /> Lähetä sähköposti</DialogTitle>
          <DialogDescription>
            Kirjoita vastaanottaja(t) ja viesti vapaasti. Voit liittää minkä tahansa olemassa olevan laskun PDF:nä, tai lähettää ilman liitettä. Matias ja Joonatan saavat aina kopion.
          </DialogDescription>
        </DialogHeader>

        {sent ? (
          <div className="rounded-xl border border-primary/30 bg-primary/5 p-4 text-sm flex items-center gap-2">
            <Check className="h-4 w-4 text-primary shrink-0" /> Lähetetty.
          </div>
        ) : (
          <div className="space-y-3">
            <label className="block text-[11px] text-muted-foreground">
              Vastaanottaja(t) — erota pilkulla
              <Input type="text" value={to} onChange={(e) => setTo(e.target.value)}
                placeholder="etunimi.sukunimi@esimerkki.fi" className="h-9 mt-0.5" />
              {to.trim() && toList.length === 0 && (
                <span className="text-[10.5px] text-destructive">Ei kelvollisia osoitteita vielä.</span>
              )}
            </label>

            <label className="block text-[11px] text-muted-foreground">
              Otsikko (valinnainen)
              <Input type="text" value={subject} onChange={(e) => setSubject(e.target.value)}
                placeholder="Oletusotsikko käytetään jos tyhjä" className="h-9 mt-0.5" />
            </label>

            <label className="block text-[11px] text-muted-foreground">
              Viesti
              <Textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={m ? 5 : 6}
                placeholder="Kirjoita viesti tähän…" className="mt-0.5" />
            </label>

            <div>
              <p className="text-[11px] text-muted-foreground mb-1.5 flex items-center gap-1"><Paperclip className="h-3 w-3" /> Liitä lasku (valinnainen)</p>
              {selected ? (
                <div className="flex items-center justify-between gap-2 rounded-lg border border-primary/40 bg-primary/5 px-3 py-2">
                  <div className="min-w-0">
                    <p className="text-xs font-semibold truncate">{selected.partyLabel}</p>
                    <p className="text-[10.5px] text-muted-foreground truncate">
                      {selected.jobLabel} · {selected.dateStr} · {fmtEurCents(selected.totalCents)}
                      {selected.invoiceNumber ? ` · ${selected.invoiceNumber}` : ""}
                    </p>
                  </div>
                  <button type="button" onClick={() => setSelectedRef(null)} aria-label="Poista liite"
                    className="shrink-0 rounded-full p-1 text-muted-foreground hover:bg-muted/60 hover:text-foreground">
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              ) : (
                <>
                  <div className="relative mb-1.5">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                    <Input type="text" value={search} onChange={(e) => setSearch(e.target.value)}
                      placeholder="Hae asiakkaan, tekijän tai laskunumeron mukaan…" className="h-8 pl-8 text-xs" />
                  </div>
                  <div className="max-h-48 overflow-y-auto rounded-lg border border-border divide-y divide-border">
                    {loadingInvoices ? (
                      <p className="text-xs text-muted-foreground p-3">Ladataan laskuja…</p>
                    ) : filtered.length === 0 ? (
                      <p className="text-xs text-muted-foreground p-3">Ei laskuja haulla.</p>
                    ) : (
                      filtered.map((inv) => (
                        <button key={inv.ref} type="button" onClick={() => setSelectedRef(inv.ref)}
                          className="w-full text-left px-3 py-2 hover:bg-muted/40 transition-colors">
                          <p className="text-xs font-semibold truncate">{inv.partyLabel}</p>
                          <p className="text-[10.5px] text-muted-foreground truncate">
                            {inv.jobLabel} · {inv.dateStr} · {fmtEurCents(inv.totalCents)}
                            {inv.invoiceNumber ? ` · ${inv.invoiceNumber}` : ""}
                            {inv.tila ? ` · ${inv.tila}` : ""}
                          </p>
                        </button>
                      ))
                    )}
                  </div>
                </>
              )}
            </div>

            <div className="flex items-center justify-between gap-3 pt-2 border-t border-border">
              <span className="text-[10.5px] text-muted-foreground">Kopio: Matias + Joonatan (automaattinen)</span>
              <button onClick={send} disabled={busy}
                className="inline-flex items-center gap-1.5 rounded-lg bg-foreground px-4 py-2 text-xs font-semibold text-background disabled:opacity-40">
                {busy ? "Lähetetään…" : "Lähetä"}
              </button>
            </div>
            {error && <p className="text-xs text-destructive">{error}</p>}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
