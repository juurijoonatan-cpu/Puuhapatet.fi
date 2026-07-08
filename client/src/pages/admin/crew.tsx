/**
 * Host crew overview (admin) — manage a gig's hard-coded workers, their private
 * links, pay rate, and see the full scoreboard: who washed which windows, their
 * €/h efficiency, profiles, agreement status and notes.
 *
 * Hosts (Joonatan + Matias) get the full picture here; workers only ever see
 * their own /tyo/:token dashboard.
 */
import { useEffect, useState, useCallback } from "react";
import { useRoute, useLocation, Link } from "wouter";
import { api, type HostCrewRow, type FounderSettlement } from "@/lib/api";
import { isFounder } from "@shared/team";
import type { ProjBuilding, FixedDeal, EraDebtBreakdown } from "@shared/project";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Disclosure } from "@/components/ui/disclosure";
import { PAY_PERIODS, eraWindowCounts, computePayProgress } from "@shared/payprogress";
import { WORKER_AGREEMENTS, PROFILE_QUESTIONS, resolveAgreementSet } from "@shared/worker-agreements";
import { downloadWorkerContract, openWorkerContractForPrint, downloadSignatureImage } from "@/lib/worker-contract-doc";
import { useCrewWorkerRedirect } from "@/lib/use-crew-redirect";
import { ChevronLeft, Copy, Check, RotateCw, Trash2, Plus, UserPlus, FileText, Printer, Download, Wallet } from "lucide-react";
import type { CrewPayout } from "@shared/crew";
import { computeTax, readVatStatus, readInPrepaymentRegister, readPayeeType, fmtPct, fmtEurCents } from "@shared/tax";
import { BRAND_BILLERS, DEFAULT_BILLER_ID } from "@shared/billers";
import { traineeForUserId, traineeForName } from "@shared/trainees";
import { getAdminProfile } from "@/lib/admin-profile";
import { Input } from "@/components/ui/input";

const PUBLIC_BASE = "https://puuhapatet.fi";
const eur = (c: number) => (c / 100).toLocaleString("fi-FI", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";
const agreementTitle = (id: string) => WORKER_AGREEMENTS.find((a) => a.id === id)?.title ?? id;
// Friendly labels/values for the internal onboarding keys (not in PROFILE_QUESTIONS),
// so the host's worker summary reads cleanly instead of showing raw keys.
const ANSWER_LABELS: Record<string, string> = {
  ytunnusStatus: "Y-tunnus",
  insuranceValid: "Vakuutukset voimassa",
  riskAck: "Riskikuittaus",
  prepaymentRegister: "Ennakkoperintärekisteri",
  vatStatus: "ALV-asema",
};
const VALUE_LABELS: Record<string, string> = {
  on: "On jo", tulossa: "Tulossa",
  kylla: "Kyllä", ei: "Ei",
  "1": "Hyväksytty",
  vahainen_toiminta: "Ei ALV:tä (vähäinen toiminta)",
  alv_rekisterissa: "ALV-rekisterissä (25,5 %)",
};
const profileLabel = (id: string) => ANSWER_LABELS[id] ?? PROFILE_QUESTIONS.find((q) => q.id === id)?.label ?? id;
const profileValue = (v: string) => VALUE_LABELS[v] ?? v;

export default function AdminCrewPage() {
  const [, params] = useRoute("/admin/gig/:id/tiimi");
  const [, navigate] = useLocation();
  const jobId = Number(params?.id);
  const { checking: crewChecking } = useCrewWorkerRedirect(jobId);
  const [crew, setCrew] = useState<HostCrewRow[]>([]);
  const [building, setBuilding] = useState<ProjBuilding | null>(null);
  const [deal, setDeal] = useState<FixedDeal | null>(null);
  const [totalBillable, setTotalBillable] = useState(0);
  const [billableWashed, setBillableWashed] = useState(0);
  const [eraWindows, setEraWindowsState] = useState<number[] | null>(null);
  const [eraBreakdown, setEraBreakdown] = useState<EraDebtBreakdown[]>([]);
  const [founderSettlement, setFounderSettlement] = useState<FounderSettlement | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await api.getHostCrew(jobId);
    if (res.ok && res.data) {
      setCrew(res.data.crew); setBuilding(res.data.building);
      setDeal(res.data.deal); setTotalBillable(res.data.totalBillable);
      setBillableWashed(res.data.billableWashed); setEraWindowsState(res.data.eraWindows);
      setEraBreakdown(res.data.eraBreakdown || []);
      setFounderSettlement(res.data.founderSettlement || null);
      setErr(null);
    }
    else setErr(res.error || "Lataus epäonnistui");
    setLoading(false);
  }, [jobId]);

  useEffect(() => { if (jobId) load(); }, [jobId, load]);

  const seed = async () => { setBusy(true); await api.seedCrew(jobId); await load(); setBusy(false); };
  const addWorker = async () => { setBusy(true); await api.addCrewMember(jobId, {}); await load(); setBusy(false); };
  const update = async (id: string, data: Parameters<typeof api.updateCrewMember>[2]) => { await api.updateCrewMember(jobId, id, data); await load(); };
  const remove = async (id: string) => { if (confirm("Poistetaanko työntekijä?")) { await api.removeCrewMember(jobId, id); await load(); } };
  const addNote = async (id: string, text: string) => { const res = await api.addCrewNote(jobId, id, text); await load(); return res.ok; };
  const createPayout = async (id: string, data: { amountCents: number; windows?: number; note?: string; billerId?: string }) => {
    const res = await api.createPayout(jobId, id, data); await load(); return res.ok;
  };
  const markPaid = async (id: string, payoutId: string) => {
    const res = await api.markPayoutPaid(jobId, id, payoutId); await load(); return res;
  };
  const deletePayout = async (id: string, payoutId: string) => {
    const res = await api.deletePayout(jobId, id, payoutId); await load(); return res.ok;
  };
  const logDay = async (id: string, hours: number) => {
    const res = await api.crewLogDay(jobId, id, hours); await load(); return res;
  };
  const saveEraWindows = async (windows: number[]) => {
    const res = await api.setEraWindows(jobId, windows);
    if (res.ok && res.data) setEraWindowsState(res.data.eraWindows);
    return res.ok;
  };

  const copyLink = (token: string) => {
    const url = `${PUBLIC_BASE}/tyo/${token}`;
    navigator.clipboard?.writeText(url);
    setCopied(token);
    setTimeout(() => setCopied(null), 1500);
  };

  if (loading || crewChecking) return <div className="min-h-screen flex items-center justify-center text-muted-foreground">Ladataan…</div>;

  return (
    <div className="min-h-screen bg-background admin-shell-pad">
      <div className="mx-auto max-w-3xl px-4">
        <button onClick={() => navigate(`/admin/gig/${jobId}`)} className="flex items-center gap-1 text-sm text-muted-foreground mb-4">
          <ChevronLeft className="h-4 w-4" /> Takaisin keikkaan
        </button>
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold">Tiimi &amp; työntekijät</h1>
          <span className="text-sm text-muted-foreground">{crew.length} hlö</span>
        </div>

        {err && <p className="text-sm text-amber-600 mb-4">{err}</p>}

        {/* Payroll overview — every worker's pay at a glance: earned, paid and
            still open, plus the gig's total labour cost. Detailed per-worker
            payout actions stay in each worker's card below. */}
        {crew.length > 0 && <PayrollSummary crew={crew} />}

        {/* Maksuerät & kate — tucked behind a button so it doesn't crowd the page.
            The popup holds the per-erä window editor + the per-erä kate AND the
            "who washed which erä" debt breakdown. Display/planning only. */}
        {deal && (
          <EraKateDialog
            deal={deal}
            totalBillable={totalBillable}
            billableWashed={billableWashed}
            eraWindows={eraWindows}
            eraBreakdown={eraBreakdown}
            founderSettlement={founderSettlement}
            onSave={saveEraWindows}
          />
        )}

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

                {/* Yrittäjätiedot — founder can pre-fill/verify insurance, Y-tunnus,
                    ennakkoperintärekisteri, ALV & email on the worker's behalf. */}
                <EntrepreneurPanel member={member} onUpdate={update} />

                {/* Signed agreements + signatures (downloadable) */}
                {member.agreements.length > 0 && (
                  <Disclosure variant="inline" className="mt-3" title={`Allekirjoitetut sopimukset (${member.agreements.length})`}>
                    <div className="space-y-2">
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
                  </Disclosure>
                )}

                {/* Worker info summary — everything they filled in onboarding, folded
                    into a smooth dropdown so the card stays compact for the host. */}
                {member.profile?.answers && Object.keys(member.profile.answers).filter((k) => (member.profile!.answers![k] || "").trim()).length > 0 && (
                  <Disclosure variant="inline" className="mt-3" title="Työntekijän tiedot">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-2">
                      {Object.entries(member.profile.answers)
                        .filter(([, v]) => (v || "").trim())
                        .map(([k, v]) => (
                          <div key={k} className="text-xs">
                            <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{profileLabel(k)}</p>
                            <p className="break-words">{profileValue(v)}</p>
                          </div>
                        ))}
                    </div>
                  </Disclosure>
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

                {/* Notes — always available so the founder can jot e.g.
                    "lyhytaikainen apu, tulee huomenna" against a worker. */}
                <AdminNotesPanel member={member} onAddNote={addNote} />

                {/* Manager day-log — record this worker's day (hours + today's
                    windows) and email them the summary, on their behalf. */}
                <DayLogPanel member={member} onLog={(hours) => logDay(member.id, hours)} />

                {/* Payouts (Puuhapatet → worker). Suggest only the UNPAID remainder
                    — what this worker has done since the last payout — so each payout
                    covers just the current billed period, never the cumulative total. */}
                {(() => {
                  const claimedCents = (member.payouts || []).reduce((s, p) => s + p.amountCents, 0);
                  const claimedWindows = (member.payouts || []).reduce((s, p) => s + (p.windows || 0), 0);
                  return (
                    <PayoutPanel
                      member={member}
                      suggestedCents={Math.max(0, stats.earnedCents - claimedCents)}
                      suggestedWindows={Math.max(0, stats.washed - claimedWindows)}
                      onCreate={createPayout}
                      onMarkPaid={markPaid}
                      onDelete={deletePayout}
                    />
                  );
                })()}
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

/** Manager logs a worker's day on their behalf: enter the hours, and the day's
 *  windows (marked by that worker today) + a summary email are recorded/sent. */
function DayLogPanel({
  member, onLog,
}: {
  member: HostCrewRow["member"];
  onLog: (hours: number) => Promise<{ ok: boolean; windows?: number; emailed?: boolean; error?: string }>;
}) {
  const [hours, setHours] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const submit = async () => {
    const h = parseFloat(hours.replace(",", "."));
    const valid = Number.isFinite(h) && h > 0;
    setBusy(true); setMsg(null);
    const res = await onLog(valid ? Math.round(h * 100) / 100 : 0);
    setBusy(false);
    if (res.ok) {
      const parts = [`Päivä kirjattu`];
      if (res.windows) parts.push(`${res.windows} ikkunaa`);
      parts.push(res.emailed ? "yhteenveto sähköpostiin ✓" : member.profile?.email ? "sähköposti ei käytössä" : "ei sähköpostia tallennettu");
      setMsg(parts.join(" · "));
      setHours("");
    } else {
      setMsg(res.error || "Kirjaus epäonnistui");
    }
  };

  return (
    <Disclosure variant="inline" className="mt-3 rounded-xl border bg-muted/20 px-3 py-2" title="Kirjaa päivä & lähetä yhteenveto">
      <div className="flex items-center gap-2">
        <input
          value={hours}
          onChange={(e) => setHours(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
          inputMode="decimal"
          placeholder="Tunnit (esim. 6,5)"
          className="flex-1 rounded-lg border bg-background px-3 py-2 text-sm outline-none"
        />
        <button
          onClick={submit}
          disabled={busy}
          className="shrink-0 rounded-lg bg-foreground px-3 py-2 text-xs font-semibold text-background disabled:opacity-50"
        >
          {busy ? "Tallennetaan…" : "Merkitse päivä"}
        </button>
      </div>
      {msg && <p className="mt-2 text-[11px] text-muted-foreground">{msg}</p>}
    </Disclosure>
  );
}

/** A labelled two-choice toggle row (tap the active choice again to clear it). */
function ToggleRow({ label, value, onChange, options }: {
  label: string; value: string; onChange: (v: string) => void; options: [string, string][];
}) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">{label}</p>
      <div className="flex gap-2">
        {options.map(([val, lbl]) => (
          <button
            key={val}
            type="button"
            onClick={() => onChange(value === val ? "" : val)}
            className={`flex-1 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors ${value === val ? "border-green-600 bg-green-500/10 text-green-600" : "border-border text-muted-foreground"}`}
          >
            {value === val ? "✓ " : ""}{lbl}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Host-editable entrepreneur facts: insurance, ennakkoperintärekisteri, ALV,
 *  Y-tunnus and email. Lets the founder pre-fill or verify these on the worker's
 *  behalf (e.g. an experienced hire working before he onboards himself). The worker
 *  still confirms them when he signs. Writes to profile + profile.answers. */
function EntrepreneurPanel({ member, onUpdate }: {
  member: HostCrewRow["member"];
  onUpdate: (id: string, data: Parameters<typeof api.updateCrewMember>[2]) => Promise<void> | void;
}) {
  const a = member.profile?.answers || {};
  const base = {
    insurance: a.insuranceValid || "", register: a.prepaymentRegister || "", vat: a.vatStatus || "",
    yTunnus: member.profile?.yTunnus || "", email: member.profile?.email || "",
  };
  const [insurance, setInsurance] = useState(base.insurance);
  const [register, setRegister] = useState(base.register);
  const [vat, setVat] = useState(base.vat);
  const [yTunnus, setYTunnus] = useState(base.yTunnus);
  const [email, setEmail] = useState(base.email);
  const [busy, setBusy] = useState(false);

  const dirty = insurance !== base.insurance || register !== base.register || vat !== base.vat
    || yTunnus.trim() !== base.yTunnus || email.trim() !== base.email;

  const save = async () => {
    setBusy(true);
    const answers: Record<string, string> = {};
    if (insurance) answers.insuranceValid = insurance;
    if (register) answers.prepaymentRegister = register;
    if (vat) answers.vatStatus = vat;
    await onUpdate(member.id, { profile: { yTunnus: yTunnus.trim(), email: email.trim(), answers } });
    setBusy(false);
  };

  return (
    <Disclosure variant="inline" className="mt-3" title="Yrittäjätiedot">
      <div className="space-y-3">
        {/* Sopimustyyppi — which agreement package the worker signs. Applies
            immediately; set it BEFORE he signs. Switching never affects others. */}
        <div className="rounded-lg border bg-muted/20 p-2.5">
          <label className="block text-[11px] text-muted-foreground">
            Sopimustyyppi
            <select
              value={resolveAgreementSet(member)}
              onChange={(e) => onUpdate(member.id, { agreementSet: e.target.value as "standard" | "kevyt" })}
              className="mt-1 w-full rounded-md border bg-background px-2 py-2 text-sm text-foreground"
            >
              <option value="standard">Vakio — koko paketti (sis. kilpailukielto & sitoumus)</option>
              <option value="kevyt">Kevyt — lyhytaikainen / ulkoinen yrittäjä (ei kilpailukieltoa)</option>
            </select>
          </label>
          <p className="mt-1.5 text-[11px] text-muted-foreground">
            {resolveAgreementSet(member) === "kevyt"
              ? "Allekirjoitettavana vain alihankkijasopimus + tietosuoja & turvallisuus. Ei kilpailukieltoa, asiakassuojasakkoa eikä pitkäaikaissitoumusta."
              : "Koko sopimuspaketti: alihankkija, tietosuoja, asiakassuoja & kilpailukielto sekä tiimisitoumus."}
          </p>
        </div>
        <p className="text-[11px] text-muted-foreground">Voit esitäyttää tai varmistaa nämä työntekijän puolesta. Hän vahvistaa ne allekirjoittaessaan.</p>
        <ToggleRow label="Vakuutukset voimassa" value={insurance} onChange={setInsurance} options={[["kylla", "Kyllä"], ["ei", "Ei vielä"]]} />
        <ToggleRow label="Ennakkoperintärekisterissä" value={register} onChange={setRegister} options={[["kylla", "Kyllä"], ["ei", "Ei"]]} />
        <ToggleRow label="ALV-asema" value={vat} onChange={setVat} options={[["vahainen_toiminta", "Ei ALV:tä"], ["alv_rekisterissa", "ALV 25,5 %"]]} />
        <div className="flex gap-2">
          <label className="flex-1 text-[11px] text-muted-foreground">
            Y-tunnus
            <Input value={yTunnus} onChange={(e) => setYTunnus(e.target.value)} placeholder="1234567-8" className="mt-1 h-9" />
          </label>
          <label className="flex-1 text-[11px] text-muted-foreground">
            Sähköposti (yhteenvedot)
            <Input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="nimi@esimerkki.fi" className="mt-1 h-9" />
          </label>
        </div>
        <button onClick={save} disabled={busy || !dirty}
          className="inline-flex items-center gap-1.5 rounded-lg bg-foreground px-3 py-1.5 text-xs font-semibold text-background disabled:opacity-40">
          {busy ? "Tallennetaan…" : "Tallenna yrittäjätiedot"}
        </button>
      </div>
    </Disclosure>
  );
}

/** Worker notes — read the log and add new ones from admin (e.g. tag a
 *  short-term helper). Always available, unlike the old read-only block. */
function AdminNotesPanel({ member, onAddNote }: {
  member: HostCrewRow["member"];
  onAddNote: (id: string, text: string) => Promise<boolean>;
}) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const add = async () => {
    const t = text.trim();
    if (!t) return;
    setBusy(true);
    const ok = await onAddNote(member.id, t);
    setBusy(false);
    if (ok) setText("");
  };
  return (
    <Disclosure variant="inline" className="mt-3" title={`Muistiinpanot (${member.notes.length})`}>
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") add(); }}
            placeholder="Lisää muistiinpano (esim. lyhytaikainen apu, tulee huomenna)"
            className="flex-1 rounded-lg border bg-background px-3 py-2 text-sm outline-none"
          />
          <button onClick={add} disabled={busy || !text.trim()} className="shrink-0 rounded-lg bg-foreground px-3 py-2 text-xs font-semibold text-background disabled:opacity-50">
            {busy ? "…" : "Lisää"}
          </button>
        </div>
        {member.notes.length > 0 ? (
          <div className="space-y-1.5">
            {member.notes.map((n, i) => (
              <div key={i} className="rounded-lg bg-muted/40 px-3 py-2 text-xs">
                <p>{n.text}</p>
                <p className="text-muted-foreground mt-0.5">{new Date(n.t).toLocaleString("fi-FI", { day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit" })}</p>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-[11px] text-muted-foreground">Ei vielä muistiinpanoja.</p>
        )}
      </div>
    </Disclosure>
  );
}

/** Payout management for one worker (Puuhapatet → alihankkija). Create a payout
 *  notification; once the worker approves, mark it paid → invoice auto-generated. */
function PayoutPanel({
  member, suggestedCents, suggestedWindows, onCreate, onMarkPaid, onDelete,
}: {
  member: HostCrewRow["member"];
  suggestedCents: number;
  suggestedWindows: number;
  onCreate: (id: string, data: { amountCents: number; windows?: number; note?: string; billerId?: string }) => Promise<boolean>;
  onMarkPaid: (id: string, payoutId: string) => Promise<{ ok: boolean; data?: { emailId?: string }; error?: string }>;
  onDelete: (id: string, payoutId: string) => Promise<boolean>;
}) {
  const payouts: CrewPayout[] = member.payouts || [];
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState(suggestedCents > 0 ? String(suggestedCents / 100) : "");
  const [windows, setWindows] = useState(suggestedWindows ? String(suggestedWindows) : "");
  const [note, setNote] = useState("");
  // Buyer = the leader who billed the customer for this money. Default to the
  // logged-in leader if they're one of the billers, else the first leader.
  const myId = getAdminProfile()?.id;
  const [billerId, setBillerId] = useState(
    BRAND_BILLERS.some((b) => b.id === myId) ? myId! : DEFAULT_BILLER_ID,
  );
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const eur2 = (c: number) => (c / 100).toLocaleString("fi-FI", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";
  const STATUS: Record<string, { label: string; cls: string }> = {
    ilmoitettu: { label: "Odottaa työntekijän hyväksyntää", cls: "bg-amber-500/10 text-amber-600" },
    hyvaksytty: { label: "Hyväksytty · maksa pankissa", cls: "bg-blue-500/10 text-blue-600" },
    maksettu: { label: "Maksettu · lasku luotu", cls: "bg-green-500/10 text-green-600" },
  };

  const create = async () => {
    setMsg(null);
    const cents = Math.round(parseFloat(amount.replace(",", ".")) * 100);
    if (!Number.isFinite(cents) || cents <= 0) { setMsg("Anna summa euroina."); return; }
    setBusy(true);
    const ok = await onCreate(member.id, { amountCents: cents, windows: Number(windows) || undefined, note: note.trim() || undefined, billerId });
    setBusy(false);
    if (ok) { setOpen(false); setNote(""); } else setMsg("Maksun luonti epäonnistui.");
  };

  const pay = async (p: CrewPayout) => {
    const tx = p.tax ?? computeTax({
      laborCents: p.amountCents,
      vatStatus: readVatStatus(member.profile?.answers),
      inPrepaymentRegister: readInPrepaymentRegister(member.profile?.answers),
      payeeType: readPayeeType(member.profile?.answers),
    });
    const extra = tx.withheld
      ? `\n\nHuom: työntekijä ei ole ennakkoperintärekisterissä → tilille ${eur2(tx.payableCents)}, ennakonpidätys ${fmtPct(tx.withholdingRate)} (${eur2(tx.withholdingCents)}) tilitettävä Verolle.`
      : "";
    if (!confirm(`Merkitäänkö maksetuksi? Tilille maksetaan ${eur2(tx.payableCents)}.\n\nVarmista että pankkisiirto on tehty. Tämä luo työntekijän laskun ja lähettää sen tiimille.${extra}`)) return;
    setBusy(true);
    const res = await onMarkPaid(member.id, p.id);
    setBusy(false);
    setMsg(res.ok ? (res.data?.emailId ? "Merkitty maksetuksi · lasku lähetetty tiimille." : "Merkitty maksetuksi · lasku luotu (sähköposti ei käytössä).") : (res.error || "Epäonnistui."));
  };

  const trainee = traineeForUserId(member.linkedUserId) || traineeForUserId(member.id) || traineeForName(member.name);

  return (
    <>
      {trainee && (
        <p className="mt-3 rounded-lg border border-blue-500/20 bg-blue-500/5 px-3 py-2 text-[11px] text-muted-foreground">
          <b className="text-foreground">Harjoittelija</b> — {trainee.responsibleLeaderName} vastaa. Ei omaa Y-tunnusta eikä alihankkijalaskutusta; ansiot jaetaan tiimin kesken.
        </p>
      )}
    <Disclosure
      variant="inline"
      className="mt-3"
      icon={<Wallet className="h-3.5 w-3.5 text-muted-foreground" />}
      title={`Maksut työntekijälle (${payouts.length})`}
    >
      <div className="space-y-2">
        {payouts.map((p) => {
          const st = STATUS[p.status] || STATUS.ilmoitettu;
          // Net to transfer = työkorvaus + ALV − ennakonpidätys. Use the snapshot
          // once paid; otherwise compute from the worker's declared tax status.
          const tx = p.tax ?? computeTax({
            laborCents: p.amountCents,
            vatStatus: readVatStatus(member.profile?.answers),
            inPrepaymentRegister: readInPrepaymentRegister(member.profile?.answers),
            payeeType: readPayeeType(member.profile?.answers),
          });
          const taxAdjusted = tx.vatRegistered || tx.withheld;
          return (
            <div key={p.id} className="rounded-lg border bg-muted/30 p-3">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-bold tabular-nums">{eur2(tx.payableCents)}{taxAdjusted && <span className="ml-1 text-[10px] font-normal text-muted-foreground">tilille</span>}</p>
                  <p className="text-[11px] text-muted-foreground truncate">{p.note || "Ikkunanpesutyö"}{p.windows ? ` · ${p.windows} ikkunaa` : ""} · {new Date(p.createdAt).toLocaleDateString("fi-FI")}</p>
                </div>
                <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${st.cls}`}>{st.label}</span>
              </div>
              {p.buyer && (
                <p className="mt-1 text-[11px] text-muted-foreground">Laskutetaan: {p.buyer.name}{p.buyer.yTunnus ? ` · ${p.buyer.yTunnus}` : ""}</p>
              )}
              {taxAdjusted && (
                <p className="mt-1.5 text-[11px] text-muted-foreground">
                  {fmtEurCents(tx.laborCents)} veroton{tx.vatRegistered ? ` + ALV ${fmtPct(tx.vatRate)} ${fmtEurCents(tx.vatCents)}` : ""}{tx.withheld ? ` − ennakonpidätys ${fmtPct(tx.withholdingRate)} ${fmtEurCents(tx.withholdingCents)}` : ""}
                </p>
              )}
              {p.status === "hyvaksytty" && p.billing && (
                <p className="mt-1.5 text-[11px] text-muted-foreground break-words">
                  Maksa {eur2(tx.payableCents)}: {[p.billing.name, p.billing.iban, p.billing.yTunnus && `Y ${p.billing.yTunnus}`].filter(Boolean).join(" · ")}
                </p>
              )}
              {p.status === "maksettu" && p.invoiceNo && (
                <p className="mt-1.5 text-[11px] text-muted-foreground">Lasku {p.invoiceNo}{p.paidAt ? ` · ${new Date(p.paidAt).toLocaleDateString("fi-FI")}` : ""}</p>
              )}
              {(p.expenses || []).length > 0 && (
                <div className="mt-2 rounded-lg border border-border bg-muted/30 p-2.5">
                  <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">Tekijän vähennyskelpoiset kulut (ei vaikuta maksuun)</p>
                  <div className="space-y-1">
                    {(p.expenses || []).map((e) => (
                      <div key={e.id} className="flex items-center justify-between gap-2 text-[11px]">
                        <span className="flex items-center gap-1.5 min-w-0">
                          {e.receiptDataUrl && <img src={e.receiptDataUrl} alt="" className="h-5 w-5 rounded object-cover shrink-0" />}
                          <span className="truncate">{e.desc}</span>
                        </span>
                        <span className="shrink-0 tabular-nums text-muted-foreground">{eur2(e.amountCents)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              <div className="flex items-center gap-2 mt-2">
                {p.status === "hyvaksytty" && (
                  <button onClick={() => pay(p)} disabled={busy} className="inline-flex items-center gap-1.5 rounded-lg bg-green-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50">
                    <Check className="h-3.5 w-3.5" /> Merkitse maksetuksi
                  </button>
                )}
                {/* A non-paid payout can be scrapped (e.g. wrong amount) and re-created. */}
                {p.status !== "maksettu" && (
                  <button
                    onClick={async () => { if (confirm("Poistetaanko tämä maksu? Voit luoda uuden.")) { setBusy(true); await onDelete(member.id, p.id); setBusy(false); } }}
                    disabled={busy}
                    className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium text-muted-foreground hover:text-red-500 disabled:opacity-50"
                  >
                    <Trash2 className="h-3.5 w-3.5" /> Poista
                  </button>
                )}
              </div>
            </div>
          );
        })}

        {msg && <p className="text-[11px] text-muted-foreground">{msg}</p>}

        {open ? (
          <div className="rounded-lg border bg-card p-3 space-y-2">
            {suggestedCents > 0 && (
              <p className="text-[11px] text-muted-foreground">
                Maksamatta tältä jaksolta: <span className="font-semibold text-foreground">{eur2(suggestedCents)}</span>{suggestedWindows ? ` · ${suggestedWindows} ikkunaa` : ""} (tehty työ − jo luodut maksut)
              </p>
            )}
            <div className="flex gap-2">
              <label className="flex-1 text-[11px] text-muted-foreground">
                Summa (€)
                <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" className="mt-1 w-full rounded-md border bg-background px-2 py-1.5 text-sm text-foreground" />
              </label>
              <label className="w-24 text-[11px] text-muted-foreground">
                Ikkunat
                <input value={windows} onChange={(e) => setWindows(e.target.value)} inputMode="numeric" className="mt-1 w-full rounded-md border bg-background px-2 py-1.5 text-sm text-foreground" />
              </label>
            </div>
            <label className="block text-[11px] text-muted-foreground">
              Kuvaus
              <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="esim. FR8 — 1. erä" className="mt-1 w-full rounded-md border bg-background px-2 py-1.5 text-sm text-foreground" />
            </label>
            <label className="block text-[11px] text-muted-foreground">
              Laskutettava (ostaja) — kuka laskutti asiakkaan tästä erästä
              <select value={billerId} onChange={(e) => setBillerId(e.target.value)} className="mt-1 w-full rounded-md border bg-background px-2 py-1.5 text-sm text-foreground">
                {BRAND_BILLERS.map((b) => (
                  <option key={b.id} value={b.id}>{b.name}{b.yTunnus ? ` · ${b.yTunnus}` : ""}</option>
                ))}
              </select>
            </label>
            <div className="flex gap-2">
              <button onClick={create} disabled={busy} className="flex-1 rounded-lg bg-foreground py-2 text-xs font-semibold text-background disabled:opacity-50">
                {busy ? "Luodaan…" : "Lähetä maksuilmoitus"}
              </button>
              <button onClick={() => setOpen(false)} className="rounded-lg border px-3 py-2 text-xs text-muted-foreground">Peruuta</button>
            </div>
          </div>
        ) : (
          <button onClick={() => { setOpen(true); setMsg(null); }} className="w-full inline-flex items-center justify-center gap-1.5 rounded-lg border border-dashed py-2 text-xs font-medium text-muted-foreground">
            <Plus className="h-3.5 w-3.5" /> Luo maksu työntekijälle
          </button>
        )}
      </div>
    </Disclosure>
    </>
  );
}

/** Maksuerät & kate — behind a button so it stays out of the way. The popup holds
 *  the per-erä window editor + per-erä kate AND the per-erä debt breakdown (who
 *  washed each erä's windows). Pure display/planning: never touches worker pay. */
function EraKateDialog({ deal, totalBillable, billableWashed, eraWindows, eraBreakdown, founderSettlement, onSave }: {
  deal: FixedDeal;
  totalBillable: number;
  billableWashed: number;
  eraWindows: number[] | null;
  eraBreakdown: EraDebtBreakdown[];
  founderSettlement: FounderSettlement | null;
  onSave: (windows: number[]) => Promise<boolean>;
}) {
  const [open, setOpen] = useState(false);
  const periods = PAY_PERIODS;
  const instalmentCents = Math.round(deal.capCents / periods);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button className="w-full flex items-center gap-2 rounded-2xl border bg-card px-4 py-3 mb-5 text-left hover:bg-muted/40 transition-colors">
          <Wallet className="h-4 w-4 shrink-0" />
          <span className="text-sm font-bold">Maksuerät &amp; kate</span>
          <span className="ml-auto text-[11px] text-muted-foreground tabular-nums">{eur(deal.capCents)} · {periods} erää ›</span>
        </button>
      </DialogTrigger>
      <DialogContent className="max-w-lg max-h-[88vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-1.5"><Wallet className="h-4 w-4" /> Maksuerät &amp; kate</DialogTitle>
          <DialogDescription className="tabular-nums">
            {eur(deal.capCents)} · {periods} erää · {eur(instalmentCents)}/erä
          </DialogDescription>
        </DialogHeader>

        <EraKatePanel
          deal={deal}
          totalBillable={totalBillable}
          billableWashed={billableWashed}
          eraWindows={eraWindows}
          onSave={onSave}
        />

        <FounderSettlementView settlement={founderSettlement} />

        <EraDebtList eraBreakdown={eraBreakdown} />
      </DialogContent>
    </Dialog>
  );
}

/** Bossien tulot & jako. The kate (1575 − palkat) is split equally between the
 *  founders as passive income; the founder who billed an erä collected the full
 *  instalment from the customer and pays out the workers + the other founder's
 *  share. Per billed erä we show a settlement "kuitti" so each biller sees why
 *  they're left with their amount. */
function FounderSettlementView({ settlement }: { settlement: FounderSettlement | null }) {
  if (!settlement) return null;
  const { founders, settlements } = settlement;
  const earners = founders.filter((f) => f.kateShareCents > 0 || f.billedCents > 0);
  if (settlements.length === 0 || earners.length === 0) {
    return (
      <div className="mt-1 pt-4 border-t border-border">
        <h3 className="text-sm font-bold mb-1">Bossien tulot</h3>
        <p className="text-[11px] text-muted-foreground">Ei vielä laskutettuja eriä — tulot näkyvät, kun ensimmäinen erä laskutetaan asiakkaalta.</p>
      </div>
    );
  }
  const totalKate = founders.reduce((s, f) => s + f.kateShareCents, 0);
  const firstName = (n: string) => n.trim().split(/\s+/)[0];

  return (
    <div className="mt-1 pt-4 border-t border-border space-y-4">
      {/* Passive income — each founder's equal share of the kate from billed erät. */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-bold">Bossien passiiviset tulot</h3>
          <span className="text-sm font-bold tabular-nums text-emerald-600">{eur(totalKate)}</span>
        </div>
        <p className="text-[11px] text-muted-foreground mb-2">Kate (lasku − palkat) jaetaan tasan. Laskutetuista eristä.</p>
        <div className="space-y-2">
          {earners.map((f) => (
            <div key={f.id} className="flex items-center justify-between gap-2 rounded-xl border bg-muted/20 px-3 py-2">
              <div className="min-w-0">
                <p className="text-sm font-medium truncate">{f.name}</p>
                <p className="text-[11px] text-muted-foreground">Laskutti asiakkaalta {eur(f.billedCents)}</p>
              </div>
              <span className="shrink-0 text-right">
                <span className="block text-sm font-bold tabular-nums text-emerald-600">{eur(f.kateShareCents)}</span>
                <span className="text-[10px] text-muted-foreground">kate-osuus</span>
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Settlement receipts — per billed erä, how the biller's instalment is split. */}
      <div>
        <h3 className="text-sm font-bold mb-2">Laskutus & jako per erä</h3>
        <div className="space-y-2">
          {settlements.map((s) => (
            <div key={s.era} className="rounded-xl border bg-muted/20 p-3">
              <div className="flex items-center justify-between gap-2 mb-1.5">
                <span className="text-xs font-semibold">Erä {s.era} · {firstName(s.billerName)} laskutti</span>
                <span className="text-[11px] text-muted-foreground tabular-nums">sai {eur(s.instalmentCents)}</span>
              </div>
              <div className="space-y-1 text-xs">
                <div className="flex items-center justify-between gap-2 text-muted-foreground">
                  <span>→ Työntekijöille (palkat)</span>
                  <span className="tabular-nums">−{eur(s.palkatCents)}</span>
                </div>
                {s.paysOut.map((p) => (
                  <div key={p.id} className="flex items-center justify-between gap-2 text-muted-foreground">
                    <span>→ {firstName(p.name)}lle (kate-osuus)</span>
                    <span className="tabular-nums">−{eur(p.cents)}</span>
                  </div>
                ))}
                <div className="flex items-center justify-between gap-2 pt-1 mt-1 border-t border-border/60 font-semibold">
                  <span>{firstName(s.billerName)}lle jää</span>
                  <span className="tabular-nums text-emerald-600">{eur(s.billerShareCents)}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/** The per-erä window-count editor: founders set each erä's window count, the
 *  per-erä kate (€1575 ÷ erän ikkunat) follows. Lives inside EraKateDialog. */
function EraKatePanel({ deal, totalBillable, billableWashed, eraWindows, onSave }: {
  deal: FixedDeal;
  totalBillable: number;
  billableWashed: number;
  eraWindows: number[] | null;
  onSave: (windows: number[]) => Promise<boolean>;
}) {
  const periods = PAY_PERIODS;
  const instalmentCents = Math.round(deal.capCents / periods);
  const canonical = eraWindowCounts(totalBillable, periods, eraWindows);
  const [counts, setCounts] = useState<number[]>(canonical);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);

  // Re-sync when the server data changes (initial load / after save).
  useEffect(() => { setCounts(eraWindowCounts(totalBillable, periods, eraWindows)); setSaved(false); }, [totalBillable, eraWindows, periods]);

  const sum = counts.reduce((s, n) => s + n, 0);
  const prog = computePayProgress(0, billableWashed, periods, counts);
  const dirty = JSON.stringify(counts) !== JSON.stringify(canonical);

  const setAt = (i: number, v: string) => {
    const n = Math.max(0, Math.floor(Number(v.replace(/[^0-9]/g, "")) || 0));
    setCounts((c) => c.map((x, j) => (j === i ? n : x)));
    setSaved(false);
  };
  const save = async () => { setBusy(true); const ok = await onSave(counts); setBusy(false); if (ok) setSaved(true); };

  return (
    <div>
      <div className="space-y-2">
        {counts.map((n, i) => {
          const current = prog.currentPeriod === i + 1 && !prog.done && billableWashed > 0;
          const kateCents = n > 0 ? Math.round(instalmentCents / n) : 0;
          return (
            <div key={i} className={`flex items-center gap-3 rounded-xl border px-3 py-2 ${current ? "border-primary/50 bg-primary/5" : "border-border"}`}>
              <span className="text-xs font-semibold w-16 shrink-0">Erä {i + 1}{current ? " ·nyt" : ""}</span>
              <Input
                type="text" inputMode="numeric" value={String(n)}
                onChange={(e) => setAt(i, e.target.value)}
                className="h-8 w-20 text-right tabular-nums"
                aria-label={`Erän ${i + 1} ikkunamäärä`}
              />
              <span className="text-[11px] text-muted-foreground">ikkunaa</span>
              <span className="ml-auto text-right whitespace-nowrap">
                <span className="text-sm font-bold tabular-nums">{eur(kateCents)}</span>
                <span className="text-[10px] text-muted-foreground"> /ikkuna</span>
              </span>
            </div>
          );
        })}
      </div>

      <div className="flex items-center justify-between gap-3 mt-3 pt-3 border-t border-border">
        <span className={`text-[11px] ${sum === totalBillable ? "text-muted-foreground" : "text-amber-600"}`}>
          Yhteensä {sum} / {totalBillable} sopimusikkunaa{sum !== totalBillable ? " — tarkista" : ""}
          {" · "}{billableWashed} pesty{prog.done ? " · valmis 🎉" : billableWashed > 0 ? ` · ${prog.toNext} seuraavaan erään` : ""}
        </span>
        <button onClick={save} disabled={busy || !dirty}
          className="inline-flex items-center gap-1.5 rounded-lg bg-foreground px-3 py-1.5 text-xs font-semibold text-background shrink-0 disabled:opacity-40">
          {busy ? "Tallennetaan…" : saved && !dirty ? <><Check className="h-3.5 w-3.5" /> Tallennettu</> : "Tallenna erät"}
        </button>
      </div>
    </div>
  );
}

/** Per-erä debt breakdown: for each erä, who washed its windows (in wash order)
 *  and the palkka that implies — answering "kuka pesi erän 1 ensimmäiset 40
 *  ikkunaa ja kuinka monta kukin". Reads server-computed attribution. */
function EraDebtList({ eraBreakdown }: { eraBreakdown: EraDebtBreakdown[] }) {
  if (!eraBreakdown || eraBreakdown.length === 0) return null;
  const fmtWindows = (n: number) => n.toLocaleString("fi-FI", { maximumFractionDigits: 1 });
  const anyWashed = eraBreakdown.some((e) => e.washed > 0);

  return (
    <div className="mt-1 pt-4 border-t border-border">
      <h3 className="text-sm font-bold mb-3">Kuka pesi minkä erän</h3>

      {!anyWashed ? (
        <p className="text-[11px] text-muted-foreground">Ei vielä pestyjä ikkunoita.</p>
      ) : (
        <div className="space-y-2">
          {eraBreakdown.map((e) => (
            <div key={e.era} className="rounded-xl border bg-muted/20 p-3">
              <div className="flex items-center justify-between gap-2 mb-1">
                <span className="text-xs font-semibold">
                  Erä {e.era}{e.complete ? " · valmis ✓" : ""}
                  {e.biller?.name
                    ? <span className="ml-1 font-normal text-muted-foreground">· laskutti {e.biller.name.split(/\s+/)[0]}</span>
                    : <span className="ml-1 font-normal text-amber-600">· ei vielä laskutettu</span>}
                </span>
                <span className="text-[11px] text-muted-foreground tabular-nums">{e.washed} / {e.size} ikkunaa</span>
              </div>
              {/* Lasku → palkat → kate (bossien passiivinen tulo tästä erästä). */}
              <div className="flex items-center justify-between gap-2 mb-1.5 text-[11px] tabular-nums">
                <span className="text-muted-foreground">Lasku {eur(e.instalmentCents)} − palkat {eur(e.earnedCents)}</span>
                <span className="font-semibold text-emerald-600">kate {eur(e.marginCents)}</span>
              </div>
              {(() => {
                // Real workers (paid per window) vs founders (wash at no palkka —
                // their work just lifts the kate, so show them cleanly, not as 0 € rows).
                const paid = e.workers.filter((w) => !isFounder(w.workerId));
                const bosses = e.workers.filter((w) => isFounder(w.workerId));
                if (e.workers.length === 0) return <p className="text-[11px] text-muted-foreground">Ei vielä pesty.</p>;
                return (
                  <div className="space-y-1 pt-1 border-t border-border/60">
                    {paid.map((w) => (
                      <div key={w.workerId} className="flex items-center justify-between gap-2 text-xs">
                        <span className="truncate">{w.name}</span>
                        <span className="shrink-0 text-muted-foreground tabular-nums">
                          {fmtWindows(w.windows)} ikkunaa · <span className="font-semibold text-foreground">{eur(w.earnedCents)}</span>
                        </span>
                      </div>
                    ))}
                    {bosses.length > 0 && (
                      <div className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground pt-0.5">
                        <span className="truncate italic">
                          Bossien omat ikkunat: {bosses.map((b) => `${b.name.trim().split(/\s+/)[0]} ${fmtWindows(b.windows)}`).join(" · ")}
                        </span>
                        <span className="shrink-0">ei palkkaa</span>
                      </div>
                    )}
                  </div>
                );
              })()}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Consolidated payroll overview for the whole gig — what each worker has
 *  earned, what's been paid out, and what's still open. This is the "see how
 *  much money for each worker" view; it reads the same crew/payout data the
 *  per-worker cards use, so it's always in sync. */
function PayrollSummary({ crew }: { crew: HostCrewRow[] }) {
  const rows = crew
    .filter((c) => c.member.active)
    .map(({ member, stats }) => {
      const payouts = member.payouts || [];
      const paidCents = payouts.filter((p) => p.status === "maksettu").reduce((s, p) => s + p.amountCents, 0);
      // "Open" = work earned that hasn't actually been paid out yet (covers both
      // not-yet-created payouts and created-but-unpaid ones).
      const openCents = Math.max(0, stats.earnedCents - paidCents);
      return { id: member.id, name: member.name, washed: stats.washed, earnedCents: stats.earnedCents, paidCents, openCents };
    })
    .filter((r) => r.earnedCents > 0 || r.washed > 0)
    .sort((a, b) => b.earnedCents - a.earnedCents);

  if (rows.length === 0) return null;

  const totalEarned = rows.reduce((s, r) => s + r.earnedCents, 0);
  const totalPaid = rows.reduce((s, r) => s + r.paidCents, 0);
  const totalOpen = rows.reduce((s, r) => s + r.openCents, 0);
  const totalWashed = rows.reduce((s, r) => s + r.washed, 0);

  return (
    <div className="rounded-2xl border bg-card p-4 mb-5">
      <div className="flex items-center justify-between mb-3">
        <h2 className="flex items-center gap-1.5 text-sm font-bold"><Wallet className="h-4 w-4" /> Palkkayhteenveto</h2>
        <span className="text-[11px] text-muted-foreground">{totalWashed} ikkunaa · {rows.length} tekijää</span>
      </div>

      {/* Totals strip — the gig's total labour cost, paid out and still owed. */}
      <div className="grid grid-cols-3 gap-2 mb-3 text-center">
        <div className="rounded-xl bg-muted/40 py-2">
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Palkat yhteensä</p>
          <p className="text-sm font-bold tabular-nums">{eur(totalEarned)}</p>
        </div>
        <div className="rounded-xl bg-muted/40 py-2">
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Maksettu</p>
          <p className="text-sm font-bold tabular-nums text-green-600">{eur(totalPaid)}</p>
        </div>
        <div className="rounded-xl bg-muted/40 py-2">
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Avoinna</p>
          <p className="text-sm font-bold tabular-nums text-amber-600">{eur(totalOpen)}</p>
        </div>
      </div>

      {/* Per-worker rows */}
      <div className="divide-y divide-border">
        {rows.map((r) => (
          <div key={r.id} className="flex items-center justify-between gap-3 py-2">
            <div className="min-w-0">
              <p className="text-sm font-medium truncate">{r.name}</p>
              <p className="text-[11px] text-muted-foreground">{r.washed} ikkunaa</p>
            </div>
            <div className="flex items-center gap-4 text-right shrink-0">
              <div className="hidden sm:block">
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Ansaittu</p>
                <p className="text-sm font-semibold tabular-nums">{eur(r.earnedCents)}</p>
              </div>
              <div className="hidden sm:block">
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Maksettu</p>
                <p className="text-sm font-semibold tabular-nums text-green-600">{eur(r.paidCents)}</p>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Avoinna</p>
                <p className={`text-sm font-bold tabular-nums ${r.openCents > 0 ? "text-amber-600" : "text-muted-foreground"}`}>{eur(r.openCents)}</p>
              </div>
            </div>
          </div>
        ))}
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

  // Trainees (harjoittelija, e.g. Milja) sign NOTHING — they work under a
  // leader's responsibility. Showing "Odottaa allekirjoitusta" for them is wrong
  // (no signature is ever coming), so they get their own status pill instead.
  const trainee = traineeForUserId(member.linkedUserId) || traineeForUserId(member.id) || traineeForName(member.name);

  return (
    <div>
      {/* Identity row: avatar + editable name (clean inline title) + status + delete */}
      <div className="flex items-center gap-3">
        {/* Avatar: onboarding photo → static /fr8/<id>.jpg → initials (image hides
            itself on load error, revealing the initials underneath). */}
        <Link href={`/admin/tiimi/${member.id}`} aria-label={`Avaa ${member.name}`} className="relative grid h-10 w-10 shrink-0 place-items-center overflow-hidden rounded-full bg-muted text-sm font-bold text-muted-foreground transition-transform hover:scale-105 active:scale-95">
          {initials}
          <img
            src={member.profile?.photoDataUrl || `/fr8/${member.id}.jpg`}
            alt={member.name}
            className="absolute inset-0 h-full w-full object-cover"
            onError={(e) => { e.currentTarget.style.display = "none"; }}
          />
        </Link>
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
            {trainee ? (
              <span className="rounded-full bg-blue-500/10 px-2 py-0.5 text-[10px] font-semibold text-blue-600">
                Harjoittelija · ei allekirjoitusta
              </span>
            ) : (
              <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${onboarded ? "bg-green-500/10 text-green-600" : "bg-amber-500/10 text-amber-600"}`}>
                {onboarded ? "Allekirjoittanut" : "Odottaa allekirjoitusta"}
              </span>
            )}
            {!member.active && <span className="rounded-full bg-zinc-500/10 px-2 py-0.5 text-[10px] font-semibold text-zinc-500">Pois käytöstä</span>}
            {member.activeShiftAt && (
              <span className="rounded-full bg-green-500/10 px-2 py-0.5 text-[10px] font-semibold text-green-600">
                Työaika käynnissä · {fmtShiftDuration(Date.now() - member.activeShiftAt)}
              </span>
            )}
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
        {member.activeShiftAt && (
          <button
            onClick={() => {
              if (!confirm(`Päätetäänkö ${member.name}n käynnissä oleva työaika (${fmtShiftDuration(Date.now() - member.activeShiftAt!)})?\n\nKäytä tätä kun työntekijä on unohtanut painaa "Päätä työaika" itse. Ei vaikuta tuntikirjanpitoon.`)) return;
              onUpdate(member.id, { endShift: true });
            }}
            className="inline-flex items-center gap-1.5 rounded-lg border border-amber-500/30 px-2.5 py-1.5 text-xs font-medium text-amber-600"
          >
            Päätä vuoro
          </button>
        )}
        <button onClick={() => onUpdate(member.id, { active: !member.active })} className="text-xs underline text-muted-foreground ml-auto">
          {member.active ? "Poista käytöstä" : "Ota käyttöön"}
        </button>
      </div>
    </div>
  );
}

/** "2 t 47 min" / "47 min" for the stuck-shift badge + confirm dialog. */
function fmtShiftDuration(ms: number): string {
  const totalMin = Math.max(0, Math.round(ms / 60000));
  const h = Math.floor(totalMin / 60);
  const min = totalMin % 60;
  return h > 0 ? `${h} t ${min} min` : `${min} min`;
}
