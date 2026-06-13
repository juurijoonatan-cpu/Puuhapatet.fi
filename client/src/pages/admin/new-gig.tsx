/**
 * New custom gig (cap-pricing / kattomalli contract job)
 *
 * For firms & contract jobs: enter company info, paste the contract, define
 * priced sectors, then a live progress tracker + shareable customer view and
 * partial-invoicing are generated automatically.
 */

import { useState } from "react";
import { Link, useLocation } from "wouter";
import { ArrowLeft, Plus, Trash2, Building2, FileText, Layers, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { api } from "@/lib/api";
import { getAdminProfile, USERS } from "@/lib/admin-profile";
import { emptyGigData, newSector, computeTotals, eur, type GigSector, type GigData } from "@shared/gig";
import { cn } from "@/lib/utils";

function randomToken(): string {
  const a = Math.random().toString(36).slice(2, 10);
  const b = Date.now().toString(36);
  return `${a}${b}`.toLowerCase();
}

export default function AdminNewGigPage() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const profile = getAdminProfile();

  // Company / firm
  const [company, setCompany] = useState({
    name: "", contact: "", businessId: "", email: "", phone: "", address: "", billing: "",
  });
  const [description, setDescription] = useState("");
  const [contractId, setContractId] = useState("");
  const [contractText, setContractText] = useState("");
  const [vatNote, setVatNote] = useState("Hintoihin ei lisätä arvonlisäveroa (AVL 3 §, vähäinen liiketoiminta).");
  const [customerNote, setCustomerNote] = useState("");
  const [invoiceInterval, setInvoiceInterval] = useState(100);

  const [sectors, setSectors] = useState<GigSector[]>([
    { ...newSector(0), name: "Sektori 1", unitLabel: "ikkuna" },
  ]);

  // Worker assignment
  const [assigned, setAssigned] = useState<string[]>(profile ? [profile.id] : []);
  const [submitting, setSubmitting] = useState(false);

  const totals = computeTotals({ ...emptyGigData(), sectors });

  const updateSector = (i: number, patch: Partial<GigSector>) => {
    setSectors((prev) => prev.map((s, idx) => (idx === i ? { ...s, ...patch } : s)));
  };
  const addSector = () => setSectors((prev) => [...prev, newSector(prev.length)]);
  const removeSector = (i: number) => setSectors((prev) => prev.filter((_, idx) => idx !== i));
  const toggleWorker = (id: string) =>
    setAssigned((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const canSubmit =
    (company.name.trim().length > 0) &&
    sectors.length > 0 &&
    sectors.every((s) => s.total > 0 && s.unitPriceCents > 0) &&
    !submitting;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      // 1) Customer (firm)
      const custRes = await api.createCustomer({
        name: company.contact || company.name,
        phone: company.phone || "-",
        email: company.email || undefined,
        address: company.address || company.name,
        isYritys: true,
        companyName: company.name,
        yTunnus: company.businessId || undefined,
        ownedBy: assigned.join(",") || profile?.id,
        notes: company.billing || undefined,
      });
      if (!custRes.ok || !custRes.data) throw new Error(custRes.error || "Asiakkaan luonti epäonnistui");

      // 2) Gig data
      const gig: GigData = {
        ...emptyGigData(),
        contractId: contractId.trim() || undefined,
        company: { ...company },
        contractText: contractText.trim() || undefined,
        vatNote: vatNote.trim() || undefined,
        customerNote: customerNote.trim() || undefined,
        sectors: sectors.map((s, i) => ({ ...s, priority: i + 1 })),
        invoiceInterval: invoiceInterval > 0 ? invoiceInterval : 100,
        log: [{ t: Date.now(), text: "Keikka luotu", by: profile?.name }],
      };

      const token = randomToken();
      const jobRes = await api.createJob({
        customerId: (custRes.data as any).id,
        description: description.trim() || `${company.name} — sopimuskeikka`,
        agreedPrice: totals.capCents,
        status: "in_progress",
        assignedTo: assigned.join(",") || profile?.id,
        isCustomGig: true,
        gigData: JSON.stringify(gig),
        quoteToken: token,
        isYritys: true,
      });
      if (!jobRes.ok || !jobRes.data) throw new Error(jobRes.error || "Keikan luonti epäonnistui");

      toast({ title: "Keikka luotu", description: "Seuranta ja asiakaslinkki ovat valmiina." });
      navigate(`/admin/gig/${(jobRes.data as any).id}`);
    } catch (e: any) {
      toast({ variant: "destructive", title: "Virhe", description: e.message });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-background pt-20 md:pt-24 pb-28">
      <div className="container mx-auto px-4 max-w-2xl">
        <div className="flex items-center gap-4 mb-6">
          <Link href="/admin/new">
            <Button variant="ghost" size="icon"><ArrowLeft className="w-5 h-5" /></Button>
          </Link>
          <div>
            <h1 className="text-2xl font-semibold text-foreground">Yritys- / sopimuskeikka</h1>
            <p className="text-sm text-muted-foreground">Kattomalli, live-seuranta ja osalaskutus</p>
          </div>
        </div>

        {/* Company */}
        <Card className="p-5 bg-card border-0 premium-shadow mb-4">
          <div className="flex items-center gap-2 mb-4">
            <Building2 className="w-4 h-4 text-muted-foreground" />
            <h2 className="font-semibold text-foreground">Tilaaja / yritys</h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Yrityksen nimi *</Label>
              <Input value={company.name} onChange={(e) => setCompany({ ...company, name: e.target.value })} placeholder="Esim. Fr8" />
            </div>
            <div>
              <Label className="text-xs">Yhteyshenkilö</Label>
              <Input value={company.contact} onChange={(e) => setCompany({ ...company, contact: e.target.value })} placeholder="Esim. Niilo" />
            </div>
            <div>
              <Label className="text-xs">Y-tunnus</Label>
              <Input value={company.businessId} onChange={(e) => setCompany({ ...company, businessId: e.target.value })} />
            </div>
            <div>
              <Label className="text-xs">Sähköposti (laskut + linkki)</Label>
              <Input type="email" value={company.email} onChange={(e) => setCompany({ ...company, email: e.target.value })} />
            </div>
            <div>
              <Label className="text-xs">Puhelin</Label>
              <Input value={company.phone} onChange={(e) => setCompany({ ...company, phone: e.target.value })} />
            </div>
            <div>
              <Label className="text-xs">Osoite / kohde</Label>
              <Input value={company.address} onChange={(e) => setCompany({ ...company, address: e.target.value })} placeholder="Esim. Bulevardi 31, Helsinki" />
            </div>
          </div>
          <div className="mt-3">
            <Label className="text-xs">Laskutustiedot (sisäinen)</Label>
            <Textarea rows={2} value={company.billing} onChange={(e) => setCompany({ ...company, billing: e.target.value })} placeholder="Viralliset laskutustiedot, viitteet, jne." />
          </div>
        </Card>

        {/* Contract */}
        <Card className="p-5 bg-card border-0 premium-shadow mb-4">
          <div className="flex items-center gap-2 mb-4">
            <FileText className="w-4 h-4 text-muted-foreground" />
            <h2 className="font-semibold text-foreground">Sopimus & kuvaus</h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
            <div>
              <Label className="text-xs">Sopimustunnus</Label>
              <Input value={contractId} onChange={(e) => setContractId(e.target.value)} placeholder="Esim. PT-2026-02" />
            </div>
            <div>
              <Label className="text-xs">Työn kuvaus</Label>
              <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Esim. Ikkunoiden pesu sisäkautta" />
            </div>
          </div>
          <Label className="text-xs">Liitä sopimusteksti (näkyy tiimille)</Label>
          <Textarea rows={6} value={contractText} onChange={(e) => setContractText(e.target.value)} placeholder="Liitä koko sopimus tähän…" className="font-mono text-xs" />
          <div className="mt-3">
            <Label className="text-xs">ALV-huomautus</Label>
            <Input value={vatNote} onChange={(e) => setVatNote(e.target.value)} />
          </div>
          <div className="mt-3">
            <Label className="text-xs">Asiakkaalle näkyvä viesti (live-näkymä)</Label>
            <Textarea rows={2} value={customerNote} onChange={(e) => setCustomerNote(e.target.value)} placeholder="Esim. Maksat vain pestyistä ikkunoista — hinta ei voi ylittää kattoa." />
          </div>
        </Card>

        {/* Sectors */}
        <Card className="p-5 bg-card border-0 premium-shadow mb-4">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Layers className="w-4 h-4 text-muted-foreground" />
              <h2 className="font-semibold text-foreground">Sektorit & hinnoittelu</h2>
            </div>
            <Button variant="outline" size="sm" onClick={addSector}><Plus className="w-4 h-4 mr-1" /> Sektori</Button>
          </div>

          <div className="space-y-4">
            {sectors.map((s, i) => (
              <div key={i} className="rounded-xl border border-border p-4">
                <div className="flex items-center gap-3 mb-3">
                  <input
                    type="color"
                    value={s.color}
                    onChange={(e) => updateSector(i, { color: e.target.value })}
                    className="w-8 h-8 rounded-md border border-border bg-transparent cursor-pointer"
                    aria-label="Sektorin väri"
                  />
                  <Input value={s.name} onChange={(e) => updateSector(i, { name: e.target.value })} placeholder="Sektorin nimi" className="flex-1" />
                  {sectors.length > 1 && (
                    <Button variant="ghost" size="icon" onClick={() => removeSector(i)}>
                      <Trash2 className="w-4 h-4 text-destructive" />
                    </Button>
                  )}
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <Label className="text-xs">Määrä (kpl)</Label>
                    <Input type="number" min={0} value={s.total || ""} onChange={(e) => updateSector(i, { total: Math.max(0, parseInt(e.target.value) || 0) })} />
                  </div>
                  <div>
                    <Label className="text-xs">Hinta / yksikkö (€)</Label>
                    <Input type="number" min={0} step="0.01" value={s.unitPriceCents ? s.unitPriceCents / 100 : ""} onChange={(e) => updateSector(i, { unitPriceCents: Math.max(0, Math.round((parseFloat(e.target.value) || 0) * 100)) })} />
                  </div>
                  <div>
                    <Label className="text-xs">Yksikön nimi</Label>
                    <Input value={s.unitLabel} onChange={(e) => updateSector(i, { unitLabel: e.target.value })} placeholder="ikkuna" />
                  </div>
                </div>
                <p className="text-xs text-muted-foreground mt-2">
                  Hintakatto: <span className="font-semibold text-foreground">{eur(s.total * s.unitPriceCents)}</span>
                </p>
              </div>
            ))}
          </div>

          <div className="mt-4 flex items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <Label className="text-xs whitespace-nowrap">Laskuta n. joka</Label>
              <Input type="number" min={1} value={invoiceInterval} onChange={(e) => setInvoiceInterval(Math.max(1, parseInt(e.target.value) || 100))} className="w-20" />
              <span className="text-xs text-muted-foreground">yksikön välein</span>
            </div>
            <div className="text-right">
              <p className="text-xs text-muted-foreground">Hintakatto yhteensä</p>
              <p className="text-xl font-bold text-foreground tabular-nums">{eur(totals.capCents)}</p>
            </div>
          </div>
        </Card>

        {/* Workers */}
        <Card className="p-5 bg-card border-0 premium-shadow mb-6">
          <div className="flex items-center gap-2 mb-4">
            <Users className="w-4 h-4 text-muted-foreground" />
            <h2 className="font-semibold text-foreground">Tekijät</h2>
          </div>
          <div className="flex flex-wrap gap-2">
            {USERS.map((u) => (
              <button
                key={u.id}
                type="button"
                onClick={() => toggleWorker(u.id)}
                className={cn(
                  "flex items-center gap-2 px-3 py-2 rounded-xl border-2 transition-all",
                  assigned.includes(u.id) ? "border-primary bg-primary/5" : "border-border",
                )}
              >
                {u.photoUrl ? (
                  <img src={u.photoUrl} alt={u.name} className="w-6 h-6 rounded-full object-cover" />
                ) : (
                  <div className="w-6 h-6 rounded-full bg-muted flex items-center justify-center text-xs">{u.name[0]}</div>
                )}
                <span className="text-sm">{u.name.split(" ")[0]}</span>
              </button>
            ))}
          </div>
        </Card>

        <Button className="w-full" size="lg" disabled={!canSubmit} onClick={handleSubmit}>
          {submitting ? "Luodaan…" : "Luo keikka & avaa seuranta"}
        </Button>
        {!canSubmit && !submitting && (
          <p className="text-xs text-muted-foreground text-center mt-2">
            Täytä yrityksen nimi ja anna jokaiselle sektorille määrä ja yksikköhinta.
          </p>
        )}
      </div>
    </div>
  );
}
