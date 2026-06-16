/**
 * Host crew overview (admin) — manage a gig's hard-coded workers, their private
 * links, pay rate, and see the full scoreboard: who washed which windows, their
 * €/h efficiency, profiles, agreement status and notes.
 *
 * Hosts (Joonatan + Matias) get the full picture here; workers only ever see
 * their own /tyo/:token dashboard.
 */
import { useEffect, useState, useCallback } from "react";
import { useRoute, useLocation } from "wouter";
import { api, type HostCrewRow } from "@/lib/api";
import { ChevronLeft, Copy, Check, RotateCw, Trash2, Plus, UserPlus } from "lucide-react";

const PUBLIC_BASE = "https://puuhapatet.fi";
const eur = (c: number) => (c / 100).toLocaleString("fi-FI", { maximumFractionDigits: 0 }) + " €";

export default function AdminCrewPage() {
  const [, params] = useRoute("/admin/gig/:id/tiimi");
  const [, navigate] = useLocation();
  const jobId = Number(params?.id);
  const [crew, setCrew] = useState<HostCrewRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await api.getHostCrew(jobId);
    if (res.ok && res.data) { setCrew(res.data.crew); setErr(null); }
    else setErr(res.error || "Lataus epäonnistui");
    setLoading(false);
  }, [jobId]);

  useEffect(() => { if (jobId) load(); }, [jobId, load]);

  const seed = async () => { setBusy(true); await api.seedCrew(jobId); await load(); setBusy(false); };
  const addWorker = async () => { setBusy(true); await api.addCrewMember(jobId, {}); await load(); setBusy(false); };
  const update = async (id: string, data: Parameters<typeof api.updateCrewMember>[2]) => { await api.updateCrewMember(jobId, id, data); await load(); };
  const remove = async (id: string) => { if (confirm("Poistetaanko työntekijä?")) { await api.removeCrewMember(jobId, id); await load(); } };

  const copyLink = (token: string) => {
    const url = `${PUBLIC_BASE}/tyo/${token}`;
    navigator.clipboard?.writeText(url);
    setCopied(token);
    setTimeout(() => setCopied(null), 1500);
  };

  if (loading) return <div className="min-h-screen flex items-center justify-center text-muted-foreground">Ladataan…</div>;

  return (
    <div className="min-h-screen bg-background pb-24">
      <div className="mx-auto max-w-3xl px-4 pt-6">
        <button onClick={() => navigate(`/admin/gig/${jobId}`)} className="flex items-center gap-1 text-sm text-muted-foreground mb-4">
          <ChevronLeft className="h-4 w-4" /> Takaisin keikkaan
        </button>
        <div className="flex items-center justify-between mb-1">
          <h1 className="text-2xl font-bold">Tiimi &amp; työntekijät</h1>
          <span className="text-sm text-muted-foreground">{crew.length} hlö</span>
        </div>
        <p className="text-sm text-muted-foreground mb-6">
          Jokainen työntekijä saa oman yksityisen linkin. He allekirjoittavat sopimukset ja merkitsevät
          pesemänsä ikkunat — sinä näet kaiken täältä. Työntekijät eivät näe keikan kokonaishintaa.
        </p>

        {err && <p className="text-sm text-amber-600 mb-4">{err}</p>}

        {crew.length === 0 ? (
          <div className="rounded-2xl border border-dashed p-8 text-center">
            <p className="text-muted-foreground mb-4">Ei vielä työntekijöitä. Luo aloitusrosteri (Petrus + 5 paikkaa).</p>
            <button onClick={seed} disabled={busy} className="inline-flex items-center gap-2 rounded-xl bg-foreground px-4 py-2.5 text-sm font-semibold text-background disabled:opacity-50">
              <UserPlus className="h-4 w-4" /> Luo työntekijät
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            {crew.map(({ member, stats, onboarded }) => (
              <div key={member.id} className="rounded-2xl border bg-card p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <input
                        defaultValue={member.name}
                        onBlur={(e) => e.target.value !== member.name && update(member.id, { name: e.target.value })}
                        className="bg-transparent font-semibold text-base border-b border-transparent focus:border-border focus:outline-none"
                      />
                      {member.adminLinked && <span className="rounded-full bg-blue-500/10 px-2 py-0.5 text-[10px] font-semibold text-blue-600">ADMIN</span>}
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${onboarded ? "bg-green-500/10 text-green-600" : "bg-amber-500/10 text-amber-600"}`}>
                        {onboarded ? "Allekirjoittanut" : "Odottaa"}
                      </span>
                      {!member.active && <span className="rounded-full bg-zinc-500/10 px-2 py-0.5 text-[10px] font-semibold text-zinc-500">Pois käytöstä</span>}
                    </div>
                    {member.profile && (
                      <p className="text-xs text-muted-foreground mt-1 truncate">
                        {[member.profile.phone, member.profile.email, member.profile.yTunnus].filter(Boolean).join(" · ") || "—"}
                      </p>
                    )}
                  </div>
                  <button onClick={() => remove(member.id)} className="text-muted-foreground hover:text-red-500 p-1"><Trash2 className="h-4 w-4" /></button>
                </div>

                {/* Scoreboard */}
                <div className="grid grid-cols-4 gap-2 mt-3 text-center">
                  <Metric label="Ikkunat" value={String(stats.washed)} />
                  <Metric label="Ansio" value={eur(stats.earnedCents)} />
                  <Metric label="Tunnit" value={stats.hours.toLocaleString("fi-FI", { maximumFractionDigits: 1 })} />
                  <Metric label="€/h" value={stats.hours > 0 ? eur(Math.round(stats.eurPerHour * 100)) : "—"} />
                </div>

                {/* Link + rate */}
                <div className="flex items-center gap-2 mt-3 flex-wrap">
                  <button onClick={() => copyLink(member.token)} className="inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium">
                    {copied === member.token ? <Check className="h-3.5 w-3.5 text-green-600" /> : <Copy className="h-3.5 w-3.5" />}
                    {copied === member.token ? "Kopioitu" : "Kopioi linkki"}
                  </button>
                  <button onClick={() => { if (confirm("Vanhenneta vanha linkki ja luo uusi?")) update(member.id, { rotateToken: true }); }} className="inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium text-muted-foreground">
                    <RotateCw className="h-3.5 w-3.5" /> Uusi linkki
                  </button>
                  <label className="inline-flex items-center gap-1 text-xs text-muted-foreground ml-auto">
                    €/ikkuna
                    <input
                      type="number" defaultValue={member.perWindowCents / 100} min={0}
                      onBlur={(e) => { const c = Math.round(parseFloat(e.target.value) * 100); if (c && c !== member.perWindowCents) update(member.id, { perWindowCents: c }); }}
                      className="w-16 rounded-md border px-2 py-1 text-right bg-transparent"
                    />
                  </label>
                  <button onClick={() => update(member.id, { active: !member.active })} className="text-xs underline text-muted-foreground">
                    {member.active ? "Poista käytöstä" : "Ota käyttöön"}
                  </button>
                </div>

                {/* Notes */}
                {member.notes.length > 0 && (
                  <details className="mt-3">
                    <summary className="text-xs font-medium text-muted-foreground cursor-pointer">Muistiinpanot ({member.notes.length})</summary>
                    <div className="mt-2 space-y-1.5">
                      {member.notes.map((n, i) => (
                        <div key={i} className="rounded-lg bg-muted/40 px-3 py-2 text-xs">
                          <p>{n.text}</p>
                          <p className="text-muted-foreground mt-0.5">{new Date(n.t).toLocaleString("fi-FI", { day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit" })}</p>
                        </div>
                      ))}
                    </div>
                  </details>
                )}
              </div>
            ))}

            <button onClick={addWorker} disabled={busy} className="w-full inline-flex items-center justify-center gap-2 rounded-2xl border border-dashed py-3 text-sm font-medium text-muted-foreground disabled:opacity-50">
              <Plus className="h-4 w-4" /> Lisää työntekijä
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-muted/40 py-2">
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="text-sm font-bold tabular-nums">{value}</p>
    </div>
  );
}
