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
import type { ProjBuilding } from "@shared/project";
import { WORKER_AGREEMENTS, PROFILE_QUESTIONS } from "@shared/worker-agreements";
import { downloadWorkerContract, openWorkerContractForPrint, downloadSignatureImage } from "@/lib/worker-contract-doc";
import { useCrewWorkerRedirect } from "@/lib/use-crew-redirect";
import { ChevronLeft, Copy, Check, RotateCw, Trash2, Plus, UserPlus, FileText, Printer, Download } from "lucide-react";

const PUBLIC_BASE = "https://puuhapatet.fi";
const eur = (c: number) => (c / 100).toLocaleString("fi-FI", { maximumFractionDigits: 0 }) + " €";
const agreementTitle = (id: string) => WORKER_AGREEMENTS.find((a) => a.id === id)?.title ?? id;
const profileLabel = (id: string) => PROFILE_QUESTIONS.find((q) => q.id === id)?.label ?? id;

export default function AdminCrewPage() {
  const [, params] = useRoute("/admin/gig/:id/tiimi");
  const [, navigate] = useLocation();
  const jobId = Number(params?.id);
  const { checking: crewChecking } = useCrewWorkerRedirect(jobId);
  const [crew, setCrew] = useState<HostCrewRow[]>([]);
  const [building, setBuilding] = useState<ProjBuilding | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await api.getHostCrew(jobId);
    if (res.ok && res.data) { setCrew(res.data.crew); setBuilding(res.data.building); setErr(null); }
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

  if (loading || crewChecking) return <div className="min-h-screen flex items-center justify-center text-muted-foreground">Ladataan…</div>;

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
                <WorkerCardHeader member={member} stats={stats} onboarded={onboarded} copied={copied} onCopy={copyLink} onUpdate={update} onRemove={remove} />

                {/* Signed agreements + signatures (downloadable) */}
                {member.agreements.length > 0 && (
                  <details className="mt-3">
                    <summary className="text-xs font-medium text-muted-foreground cursor-pointer">
                      Allekirjoitetut sopimukset ({member.agreements.length})
                    </summary>
                    <div className="mt-2 space-y-2">
                      {member.agreements.map((a, i) => (
                        <div key={i} className="rounded-lg border bg-muted/30 p-3">
                          <div className="flex items-center justify-between gap-2">
                            <div className="min-w-0">
                              <p className="text-sm font-medium truncate">{agreementTitle(a.agreementId)}</p>
                              <p className="text-[11px] text-muted-foreground">
                                v{a.version} · {new Date(a.signedAt).toLocaleString("fi-FI", { day: "numeric", month: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" })}
                                {a.signerName ? ` · ${a.signerName}` : ""}
                              </p>
                            </div>
                            {a.signatureDataUrl && (
                              <button
                                onClick={() => downloadSignatureImage(a.signatureDataUrl, `Allekirjoitus_${member.name}_${a.agreementId}`)}
                                title="Lataa allekirjoitus (PNG)"
                                className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] text-muted-foreground shrink-0"
                              >
                                <Download className="h-3 w-3" /> PNG
                              </button>
                            )}
                          </div>
                          {a.signatureDataUrl && (
                            <img
                              src={a.signatureDataUrl}
                              alt="allekirjoitus"
                              className="mt-2 h-16 w-auto max-w-[220px] rounded-md border bg-white p-1 object-contain"
                            />
                          )}
                        </div>
                      ))}
                    </div>
                  </details>
                )}

                {/* Profile questionnaire answers */}
                {member.profile?.answers && Object.keys(member.profile.answers).length > 0 && (
                  <details className="mt-3">
                    <summary className="text-xs font-medium text-muted-foreground cursor-pointer">Profiili & vastaukset</summary>
                    <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-2">
                      {Object.entries(member.profile.answers).map(([k, v]) => (
                        <div key={k} className="text-xs">
                          <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{profileLabel(k)}</p>
                          <p className="break-words">{v}</p>
                        </div>
                      ))}
                    </div>
                  </details>
                )}

                {/* Downloadable signed-agreement document (host's legal record) */}
                {member.agreements.length > 0 && (
                  <div className="flex items-center gap-2 mt-3">
                    <button
                      onClick={() => downloadWorkerContract({ member, buildingName: building?.name, buildingAddress: building?.address })}
                      className="inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium"
                    >
                      <FileText className="h-3.5 w-3.5" /> Lataa sopimus
                    </button>
                    <button
                      onClick={() => openWorkerContractForPrint({ member, buildingName: building?.name, buildingAddress: building?.address })}
                      className="inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium text-muted-foreground"
                    >
                      <Printer className="h-3.5 w-3.5" /> Tulosta
                    </button>
                  </div>
                )}

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

/** Editable worker header: name + rate with explicit save, badges, scoreboard,
 *  and private-link controls. Per-row local state keeps the edit/save clean. */
function WorkerCardHeader({
  member, stats, onboarded, copied, onCopy, onUpdate, onRemove,
}: {
  member: HostCrewRow["member"];
  stats: HostCrewRow["stats"];
  onboarded: boolean;
  copied: string | null;
  onCopy: (token: string) => void;
  onUpdate: (id: string, data: Parameters<typeof api.updateCrewMember>[2]) => void;
  onRemove: (id: string) => void;
}) {
  const [name, setName] = useState(member.name);
  const [rate, setRate] = useState(String(member.perWindowCents / 100));
  const nameDirty = name.trim() !== "" && name !== member.name;
  const rateCents = Math.round(parseFloat(rate.replace(",", ".")) * 100);
  const rateDirty = Number.isFinite(rateCents) && rateCents > 0 && rateCents !== member.perWindowCents;
  const dirty = nameDirty || rateDirty;

  const save = () => {
    const data: Parameters<typeof api.updateCrewMember>[2] = {};
    if (nameDirty) data.name = name.trim();
    if (rateDirty) data.perWindowCents = rateCents;
    if (Object.keys(data).length) onUpdate(member.id, data);
  };

  const initials = (member.name || "?").trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase();

  return (
    <div>
      {/* Identity row: avatar + editable name (clean inline title) + status + delete */}
      <div className="flex items-center gap-3">
        <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-muted text-sm font-bold text-muted-foreground">{initials}</div>
        <div className="min-w-0 flex-1">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
            onBlur={save}
            placeholder="Työntekijän nimi"
            aria-label="Työntekijän nimi"
            className="w-full bg-transparent text-base font-semibold leading-tight border-b border-transparent hover:border-border/60 focus:border-foreground focus:outline-none transition-colors"
          />
          <div className="flex items-center gap-1.5 flex-wrap mt-1">
            {member.adminLinked && <span className="rounded-full bg-blue-500/10 px-2 py-0.5 text-[10px] font-semibold text-blue-600">ADMIN</span>}
            <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${onboarded ? "bg-green-500/10 text-green-600" : "bg-amber-500/10 text-amber-600"}`}>
              {onboarded ? "Allekirjoittanut" : "Odottaa allekirjoitusta"}
            </span>
            {!member.active && <span className="rounded-full bg-zinc-500/10 px-2 py-0.5 text-[10px] font-semibold text-zinc-500">Pois käytöstä</span>}
          </div>
        </div>
        {dirty
          ? <button onClick={save} className="shrink-0 rounded-lg bg-foreground px-3 py-1.5 text-xs font-semibold text-background">Tallenna</button>
          : <button onClick={() => onRemove(member.id)} title="Poista työntekijä" className="shrink-0 text-muted-foreground hover:text-red-500 p-1"><Trash2 className="h-4 w-4" /></button>}
      </div>

      {member.profile && [member.profile.phone, member.profile.email, member.profile.yTunnus].filter(Boolean).length > 0 && (
        <p className="text-xs text-muted-foreground mt-2 break-words pl-[52px]">
          {[member.profile.phone, member.profile.email, member.profile.yTunnus].filter(Boolean).join(" · ")}
        </p>
      )}

      {/* Scoreboard */}
      <div className="grid grid-cols-4 gap-2 mt-3 text-center">
        <Metric label="Ikkunat" value={String(stats.washed)} />
        <Metric label="Ansio" value={eur(stats.earnedCents)} />
        <Metric label="Tunnit" value={stats.hours.toLocaleString("fi-FI", { maximumFractionDigits: 1 })} />
        <Metric label="€/h" value={stats.hours > 0 ? eur(Math.round(stats.eurPerHour * 100)) : "—"} />
      </div>

      {/* Controls: link · rate · active — one tidy row */}
      <div className="flex items-center gap-2 mt-3 flex-wrap">
        <button onClick={() => onCopy(member.token)} className="inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium">
          {copied === member.token ? <Check className="h-3.5 w-3.5 text-green-600" /> : <Copy className="h-3.5 w-3.5" />}
          {copied === member.token ? "Kopioitu" : "Kopioi linkki"}
        </button>
        <button onClick={() => { if (confirm("Luo uusi linkki?\n\nTyöntekijän VANHA linkki lakkaa heti toimimasta. Kopioi ja lähetä uusi linkki hänelle uudestaan.")) onUpdate(member.id, { rotateToken: true }); }} className="inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium text-muted-foreground">
          <RotateCw className="h-3.5 w-3.5" /> Uusi linkki
        </button>
        <label className="inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs text-muted-foreground">
          Palkka
          <input
            type="number" inputMode="decimal" min={0} value={rate}
            onChange={(e) => setRate(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
            onBlur={save}
            className="w-12 bg-transparent text-right font-medium text-foreground focus:outline-none"
          />
          €/ikkuna
        </label>
        <button onClick={() => onUpdate(member.id, { active: !member.active })} className="text-xs underline text-muted-foreground ml-auto">
          {member.active ? "Poista käytöstä" : "Ota käyttöön"}
        </button>
      </div>
    </div>
  );
}
