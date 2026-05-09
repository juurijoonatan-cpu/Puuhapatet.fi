/**
 * Admin — Sähköpostiliidit & Bulk Sender
 */

import { useState, useEffect } from "react";
import { AdminNav } from "@/components/admin-nav";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { api, EmailLead } from "@/lib/api";
import {
  Mail,
  Trash2,
  Send,
  Upload,
  RefreshCw,
  CheckCircle,
  XCircle,
  Clock,
  AlertCircle,
  ChevronDown,
  ChevronUp,
} from "lucide-react";

const EXAMPLE_JSON = `[
  {
    "companyName": "Esimerkki Oy",
    "email": "info@esimerkki.fi",
    "address": "Mannerheimintie 1, Helsinki",
    "customMessage": "Näimme teidän toimipisteenne ja ajattelimme, että voisimme auttaa ikkunoiden kanssa."
  },
  {
    "companyName": "Toinen Yritys Ky",
    "email": "toimisto@toinenyritys.fi",
    "address": "Aleksanterinkatu 7, Helsinki"
  }
]`;

type SendResult = { sent: number; failed: number; errors?: { id: number; email: string; error: string }[] } | null;

export default function EmailLeadsPage() {
  const { toast } = useToast();

  const [leads, setLeads] = useState<EmailLead[]>([]);
  const [loading, setLoading] = useState(true);
  const [bulkJson, setBulkJson] = useState("");
  const [parsedLeads, setParsedLeads] = useState<{ companyName: string; email: string; address?: string; customMessage?: string }[] | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendResult, setSendResult] = useState<SendResult>(null);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [showExample, setShowExample] = useState(false);
  const [showImport, setShowImport] = useState(true);

  const pendingCount = leads.filter(l => l.status === "pending").length;
  const sentCount = leads.filter(l => l.status === "sent").length;
  const failedCount = leads.filter(l => l.status === "failed").length;

  async function fetchLeads() {
    setLoading(true);
    const res = await api.getEmailLeads();
    if (res.ok && res.data) setLeads(res.data);
    setLoading(false);
  }

  useEffect(() => { fetchLeads(); }, []);

  function handleJsonChange(val: string) {
    setBulkJson(val);
    setParseError(null);
    setParsedLeads(null);
    if (!val.trim()) return;
    try {
      const parsed = JSON.parse(val);
      if (!Array.isArray(parsed)) { setParseError("JSON täytyy olla taulukko [ ]"); return; }
      const valid = parsed.every(
        (item: unknown) =>
          typeof item === "object" && item !== null &&
          typeof (item as Record<string, unknown>).companyName === "string" &&
          typeof (item as Record<string, unknown>).email === "string"
      );
      if (!valid) { setParseError("Jokaisella kohteella täytyy olla companyName ja email"); return; }
      setParsedLeads(parsed as { companyName: string; email: string; address?: string; customMessage?: string }[]);
    } catch (e) {
      setParseError("Virheellinen JSON — tarkista syntaksi");
    }
  }

  async function handleImport() {
    if (!parsedLeads || parsedLeads.length === 0) return;
    setImporting(true);
    const res = await api.bulkImportLeads(parsedLeads);
    setImporting(false);
    if (res.ok && res.data) {
      toast({ title: `Tuotu ${res.data.count} liidiä`, description: "Liidit lisätty tietokantaan." });
      setBulkJson("");
      setParsedLeads(null);
      setShowImport(false);
      fetchLeads();
    } else {
      toast({ title: "Tuonti epäonnistui", description: res.error, variant: "destructive" });
    }
  }

  async function handleSend(onlySelected = false) {
    const ids = onlySelected ? Array.from(selectedIds) : undefined;
    if (onlySelected && (!ids || ids.length === 0)) {
      toast({ title: "Ei valittuja liidejä", description: "Valitse ensin lähetettävät liidit.", variant: "destructive" });
      return;
    }
    setSending(true);
    setSendResult(null);
    const res = await api.sendBulkLeadEmails(ids);
    setSending(false);
    if (res.ok && res.data) {
      setSendResult(res.data);
      toast({
        title: `Lähetetty ${res.data.sent} sähköpostia`,
        description: res.data.failed > 0 ? `${res.data.failed} epäonnistui.` : "Kaikki lähetetty onnistuneesti!",
      });
      setSelectedIds(new Set());
      fetchLeads();
    } else {
      toast({ title: "Lähetys epäonnistui", description: res.error, variant: "destructive" });
    }
  }

  async function handleDelete(id: number) {
    const res = await api.deleteEmailLead(id);
    if (res.ok) {
      setLeads(prev => prev.filter(l => l.id !== id));
      setSelectedIds(prev => { const s = new Set(prev); s.delete(id); return s; });
    } else {
      toast({ title: "Poisto epäonnistui", description: res.error, variant: "destructive" });
    }
  }

  async function handleResetStatus(id: number) {
    const res = await api.updateEmailLeadStatus(id, "pending");
    if (res.ok) {
      fetchLeads();
    }
  }

  function toggleSelect(id: number) {
    setSelectedIds(prev => {
      const s = new Set(prev);
      if (s.has(id)) s.delete(id);
      else s.add(id);
      return s;
    });
  }

  function toggleSelectAll() {
    const pendingIds = leads.filter(l => l.status === "pending").map(l => l.id);
    if (pendingIds.every(id => selectedIds.has(id)) && pendingIds.length > 0) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(pendingIds));
    }
  }

  const statusBadge = (status: EmailLead["status"]) => {
    if (status === "sent") return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400">
        <CheckCircle className="w-3 h-3" /> Lähetetty
      </span>
    );
    if (status === "failed") return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400">
        <XCircle className="w-3 h-3" /> Epäonnistui
      </span>
    );
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400">
        <Clock className="w-3 h-3" /> Odottaa
      </span>
    );
  };

  return (
    <div className="min-h-screen bg-background">
      <AdminNav />

      <main className="container mx-auto px-4 pt-20 pb-32 md:pt-24 max-w-4xl">
        {/* Header */}
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
            <Mail className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Sähköpostiliidit</h1>
            <p className="text-muted-foreground text-sm">Bulk-lähetys yrityksille</p>
          </div>
        </div>

        {/* Stats row */}
        <div className="grid grid-cols-3 gap-3 mb-6">
          <Card className="p-4 text-center">
            <p className="text-2xl font-bold text-amber-500">{pendingCount}</p>
            <p className="text-xs text-muted-foreground mt-0.5">Odottaa</p>
          </Card>
          <Card className="p-4 text-center">
            <p className="text-2xl font-bold text-green-500">{sentCount}</p>
            <p className="text-xs text-muted-foreground mt-0.5">Lähetetty</p>
          </Card>
          <Card className="p-4 text-center">
            <p className="text-2xl font-bold text-red-500">{failedCount}</p>
            <p className="text-xs text-muted-foreground mt-0.5">Epäonnistui</p>
          </Card>
        </div>

        {/* Import section */}
        <Card className="mb-4">
          <button
            className="w-full flex items-center justify-between p-4 text-left"
            onClick={() => setShowImport(v => !v)}
          >
            <div className="flex items-center gap-2">
              <Upload className="w-4 h-4 text-primary" />
              <span className="font-semibold">Tuo liidit JSON-muodossa</span>
              {parsedLeads && (
                <span className="text-xs bg-primary/10 text-primary px-2 py-0.5 rounded-full font-medium">
                  {parsedLeads.length} valmis tuotavaksi
                </span>
              )}
            </div>
            {showImport ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
          </button>

          {showImport && (
            <div className="px-4 pb-4 space-y-3">
              {/* Example toggle */}
              <button
                className="text-xs text-primary hover:underline flex items-center gap-1"
                onClick={() => setShowExample(v => !v)}
              >
                {showExample ? "Piilota esimerkki" : "Näytä JSON-esimerkki"}
              </button>
              {showExample && (
                <pre className="text-xs bg-muted rounded-lg p-3 overflow-x-auto text-muted-foreground leading-relaxed">
                  {EXAMPLE_JSON}
                </pre>
              )}

              <textarea
                className="w-full h-52 rounded-xl border border-input bg-background px-3 py-2.5 text-sm font-mono placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 resize-y"
                placeholder={`Liitä JSON-lista tähän...\n\nEsimerkki:\n[\n  { "companyName": "Yritys Oy", "email": "info@yritys.fi" }\n]`}
                value={bulkJson}
                onChange={e => handleJsonChange(e.target.value)}
              />

              {parseError && (
                <div className="flex items-center gap-2 text-destructive text-sm">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  {parseError}
                </div>
              )}

              {parsedLeads && (
                <div className="rounded-lg border border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-900/20 p-3">
                  <p className="text-sm font-medium text-green-800 dark:text-green-400 mb-2">
                    ✓ {parsedLeads.length} liidiä valmis tuotavaksi
                  </p>
                  <div className="space-y-1 max-h-36 overflow-y-auto">
                    {parsedLeads.map((l, i) => (
                      <div key={i} className="text-xs text-green-700 dark:text-green-500 font-mono flex gap-2">
                        <span className="font-semibold">{l.companyName}</span>
                        <span className="opacity-70">{l.email}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <Button
                onClick={handleImport}
                disabled={!parsedLeads || importing}
                className="w-full"
              >
                {importing ? (
                  <><RefreshCw className="w-4 h-4 mr-2 animate-spin" /> Tuodaan...</>
                ) : (
                  <><Upload className="w-4 h-4 mr-2" /> Tuo {parsedLeads ? `${parsedLeads.length} liidiä` : "liidit"}</>
                )}
              </Button>
            </div>
          )}
        </Card>

        {/* Send controls */}
        {leads.length > 0 && (
          <Card className="p-4 mb-4">
            <div className="flex flex-wrap gap-3 items-center justify-between">
              <div className="flex items-center gap-3">
                <p className="text-sm font-medium">
                  {selectedIds.size > 0
                    ? `${selectedIds.size} valittu`
                    : `${pendingCount} odottavaa`}
                </p>
                {pendingCount > 0 && (
                  <button className="text-xs text-primary hover:underline" onClick={toggleSelectAll}>
                    {leads.filter(l => l.status === "pending").every(l => selectedIds.has(l.id))
                      ? "Poista valinnat"
                      : "Valitse kaikki odottavat"}
                  </button>
                )}
              </div>
              <div className="flex gap-2">
                {selectedIds.size > 0 && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleSend(true)}
                    disabled={sending}
                  >
                    {sending ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4 mr-1.5" />}
                    Lähetä valituille ({selectedIds.size})
                  </Button>
                )}
                <Button
                  size="sm"
                  onClick={() => handleSend(false)}
                  disabled={sending || pendingCount === 0}
                >
                  {sending ? (
                    <><RefreshCw className="w-4 h-4 mr-1.5 animate-spin" /> Lähetetään...</>
                  ) : (
                    <><Send className="w-4 h-4 mr-1.5" /> Lähetä kaikki odottavat ({pendingCount})</>
                  )}
                </Button>
              </div>
            </div>

            {sendResult && (
              <div className={`mt-3 rounded-lg p-3 text-sm ${sendResult.failed > 0 ? "bg-amber-50 dark:bg-amber-900/20 text-amber-800 dark:text-amber-400" : "bg-green-50 dark:bg-green-900/20 text-green-800 dark:text-green-400"}`}>
                <p className="font-semibold">
                  ✓ {sendResult.sent} lähetetty
                  {sendResult.failed > 0 && ` · ${sendResult.failed} epäonnistui`}
                </p>
                {sendResult.errors && sendResult.errors.length > 0 && (
                  <ul className="mt-1 space-y-0.5 text-xs opacity-80">
                    {sendResult.errors.map(e => (
                      <li key={e.id}>{e.email}: {e.error}</li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </Card>
        )}

        {/* Leads table */}
        <Card className="overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-border">
            <h2 className="font-semibold text-sm">Liidit ({leads.length})</h2>
            <button
              onClick={fetchLeads}
              className="text-muted-foreground hover:text-foreground transition-colors"
              title="Päivitä lista"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
            </button>
          </div>

          {loading ? (
            <div className="py-16 text-center text-muted-foreground text-sm">Ladataan...</div>
          ) : leads.length === 0 ? (
            <div className="py-16 text-center">
              <Mail className="w-10 h-10 text-muted-foreground/30 mx-auto mb-3" />
              <p className="text-muted-foreground text-sm">Ei liidejä vielä.</p>
              <p className="text-muted-foreground text-xs mt-1">Tuo JSON-lista ylhäältä aloittaaksesi.</p>
            </div>
          ) : (
            <div className="divide-y divide-border">
              {leads.map(lead => (
                <div key={lead.id} className="flex items-start gap-3 px-4 py-3 hover:bg-muted/30 transition-colors">
                  {/* Checkbox — only for pending */}
                  <div className="mt-0.5 shrink-0">
                    {lead.status === "pending" ? (
                      <input
                        type="checkbox"
                        checked={selectedIds.has(lead.id)}
                        onChange={() => toggleSelect(lead.id)}
                        className="w-4 h-4 accent-primary rounded cursor-pointer"
                      />
                    ) : (
                      <div className="w-4 h-4" />
                    )}
                  </div>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-medium text-sm truncate">{lead.companyName}</p>
                      {statusBadge(lead.status)}
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">{lead.email}</p>
                    {lead.address && <p className="text-xs text-muted-foreground">{lead.address}</p>}
                    {lead.customMessage && (
                      <p className="text-xs text-muted-foreground mt-1 italic truncate max-w-xs">"{lead.customMessage}"</p>
                    )}
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-1 shrink-0">
                    {lead.status === "failed" && (
                      <button
                        onClick={() => handleResetStatus(lead.id)}
                        title="Palauta odottavaksi"
                        className="p-1.5 rounded-lg text-muted-foreground hover:text-amber-500 hover:bg-amber-50 dark:hover:bg-amber-900/20 transition-colors"
                      >
                        <RefreshCw className="w-4 h-4" />
                      </button>
                    )}
                    <button
                      onClick={() => handleDelete(lead.id)}
                      title="Poista liidi"
                      className="p-1.5 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </main>
    </div>
  );
}
