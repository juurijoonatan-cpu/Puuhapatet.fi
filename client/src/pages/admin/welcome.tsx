/**
 * Puuhapatet member onboarding + agreement signing (route /admin/tervetuloa).
 *
 * The first thing every worker (and founder) sees in the admin. New members get
 * an animated welcome to Puuhapatet; returning members whose signed version is
 * out of date get a "what changed" intro. Then the personalised agreement, the
 * policy acknowledgements, and an electronic signature. Signing opens the tools.
 */

import { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowRight, ArrowLeft, ShieldCheck, FileText, Check, PenLine } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import SignaturePad from "@/components/SignaturePad";
import InkReveal from "@/components/InkReveal";
import { api } from "@/lib/api";
import { getAdminProfile } from "@/lib/admin-profile";
import { agreementForProfile, cacheSignature, getCachedSignature } from "@/lib/member-agreement";
import { feePctForWorker, type TeamRole } from "@shared/team";
import { AGREEMENT_VERSION, type MemberAgreementSignature } from "@shared/member-agreement";

type Step = "welcome" | "agreement" | "policies" | "sign";
const ORDER: Step[] = ["welcome", "agreement", "policies", "sign"];

export default function AdminWelcomePage() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const profile = getAdminProfile();

  const doc = useMemo(() => (profile ? agreementForProfile(profile) : null), [profile]);
  const prior = profile ? getCachedSignature(profile.id) : null;
  const isReturning = !!prior; // signed an older version before
  const isFounder = doc?.type === "founder";

  const [step, setStep] = useState<Step>("welcome");
  const [accepted, setAccepted] = useState<Record<string, boolean>>({});
  const [signerName, setSignerName] = useState(profile?.name ?? "");
  const [place, setPlace] = useState("Helsinki");
  const [guardianName, setGuardianName] = useState("");
  const [signatureDataUrl, setSignatureDataUrl] = useState("");
  const [agreed, setAgreed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!profile) navigate("/admin/login", { replace: true });
  }, [profile, navigate]);

  if (!profile || !doc) return null;

  const allPoliciesAccepted = doc.policies.every((p) => accepted[p.id]);
  const idx = ORDER.indexOf(step);

  const go = (dir: 1 | -1) => {
    setError("");
    const next = ORDER[idx + dir];
    if (next) setStep(next);
  };

  const submit = async () => {
    setError("");
    if (!allPoliciesAccepted) { setStep("policies"); return setError("Hyväksy kaikki käytännöt."); }
    if (!signerName.trim()) return setError("Täytä nimesi.");
    if (profile.isUnder18 && !guardianName.trim()) return setError("Alaikäisenä täytä huoltajan nimi.");
    if (!signatureDataUrl) return setError("Piirrä allekirjoitus.");
    if (!agreed) return setError("Vahvista hyväksyntä rastittamalla suostumus.");

    const sig: Partial<MemberAgreementSignature> = {
      version: AGREEMENT_VERSION,
      type: doc.type,
      userId: profile.id,
      signedAt: Date.now(),
      signerName: signerName.trim(),
      place: place.trim() || undefined,
      guardianName: profile.isUnder18 ? guardianName.trim() : undefined,
      snapshot: { name: profile.name, role: profile.role as TeamRole, yTunnus: profile.yTunnus, feePct: feePctForWorker(profile.id) },
      acceptedPolicyIds: doc.policies.map((p) => p.id),
      signatureDataUrl,
    };

    setSubmitting(true);
    const res = await api.saveMemberAgreement(profile.id, sig);
    setSubmitting(false);
    if (res.ok && res.data?.signature) {
      cacheSignature(res.data.signature);
      toast({ title: "Sopimus allekirjoitettu", description: "Tervetuloa — työkalut ovat nyt käytössäsi." });
      navigate("/admin/dashboard", { replace: true });
    } else {
      setError(res.error || "Tallennus epäonnistui. Yritä uudelleen.");
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-background to-muted/40 text-foreground">
      <div className="mx-auto max-w-2xl px-4 py-10 md:py-14">
        {/* Progress */}
        <div className="mb-8 flex items-center gap-2">
          {ORDER.map((s, i) => (
            <div key={s} className={`h-1.5 flex-1 rounded-full transition-colors ${i <= idx ? "bg-foreground" : "bg-border"}`} />
          ))}
        </div>

        <AnimatePresence mode="wait">
          <motion.div
            key={step}
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.32, ease: [0.2, 0.8, 0.2, 1] }}
          >
            {step === "welcome" && (
              <WelcomeStep isReturning={isReturning} isFounder={!!isFounder} name={profile.name} onNext={() => go(1)} />
            )}

            {step === "agreement" && (
              <section>
                <Eyebrow icon={<FileText className="h-4 w-4" />}>{doc.title}</Eyebrow>
                <p className="mt-1 text-sm text-muted-foreground">{doc.subtitle} · versio {doc.version}</p>
                <p className="mt-4 text-[15px] leading-relaxed">{doc.intro}</p>

                {/* Key terms at a glance — the dense text in one breath */}
                <div className="mt-5 grid grid-cols-3 gap-3">
                  <Highlight label="Palvelumaksu" value={`${feePctForWorker(profile.id)} %`} />
                  <Highlight label="Laskutus" value="Oma Y‑tunnus" />
                  <Highlight label="Asiakkaat" value="Puuhapatetille" />
                </div>

                <div className="mt-5 space-y-5 rounded-2xl border border-border bg-card p-5 md:p-6">
                  {doc.sections.map((sec) => (
                    <div key={sec.no}>
                      <h3 className="text-[15px] font-semibold">
                        <span className="mr-2 font-mono text-xs text-muted-foreground">{sec.no}</span>
                        {sec.title}
                      </h3>
                      <div className="mt-2 space-y-1.5">
                        {sec.body.map((para, i) =>
                          para.startsWith("• ") ? (
                            <p key={i} className="flex gap-2 text-sm leading-relaxed text-muted-foreground">
                              <span className="text-muted-foreground/60">•</span>
                              <span>{para.slice(2)}</span>
                            </p>
                          ) : (
                            <p key={i} className="text-sm leading-relaxed text-muted-foreground">{para}</p>
                          ),
                        )}
                      </div>
                    </div>
                  ))}
                </div>
                <NavRow onBack={() => go(-1)} onNext={() => go(1)} nextLabel="Käytännöt" />
              </section>
            )}

            {step === "policies" && (
              <section>
                <Eyebrow icon={<ShieldCheck className="h-4 w-4" />}>Käytännöt</Eyebrow>
                <p className="mt-1 text-sm text-muted-foreground">Hyväksy jokainen käytäntö erikseen.</p>
                <div className="mt-5 space-y-3">
                  {doc.policies.map((pol) => {
                    const on = !!accepted[pol.id];
                    return (
                      <button
                        key={pol.id}
                        type="button"
                        onClick={() => setAccepted((a) => ({ ...a, [pol.id]: !a[pol.id] }))}
                        className={`w-full rounded-2xl border p-4 text-left transition-all ${on ? "border-foreground/40 bg-foreground/[0.03]" : "border-border bg-card hover:border-foreground/20"}`}
                      >
                        <div className="flex items-start gap-3">
                          <span className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md border transition-colors ${on ? "border-foreground bg-foreground text-background" : "border-muted-foreground/40"}`}>
                            {on && <Check className="h-3.5 w-3.5" />}
                          </span>
                          <div>
                            <p className="font-medium">{pol.title}</p>
                            <ul className="mt-1.5 space-y-1">
                              {pol.points.map((pt, i) => (
                                <li key={i} className="text-sm leading-relaxed text-muted-foreground">{pt}</li>
                              ))}
                            </ul>
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
                {error && <p className="mt-3 text-sm text-red-600 dark:text-red-400">{error}</p>}
                <NavRow onBack={() => go(-1)} onNext={() => go(1)} nextLabel="Allekirjoitus" nextDisabled={!allPoliciesAccepted} />
              </section>
            )}

            {step === "sign" && (
              <section>
                <Eyebrow icon={<PenLine className="h-4 w-4" />}>Allekirjoitus</Eyebrow>
                <p className="mt-1 text-sm text-muted-foreground">{doc.closing}</p>

                <div className="mt-5 grid gap-4 sm:grid-cols-2">
                  <Field label="Nimi *">
                    <input className={inputCls} value={signerName} onChange={(e) => setSignerName(e.target.value)} />
                  </Field>
                  <Field label="Paikka">
                    <input className={inputCls} value={place} onChange={(e) => setPlace(e.target.value)} />
                  </Field>
                  {profile.isUnder18 && (
                    <Field label="Huoltajan nimi * (alle 18 v)" full>
                      <input className={inputCls} value={guardianName} onChange={(e) => setGuardianName(e.target.value)} placeholder="Huoltajan nimi" />
                    </Field>
                  )}
                </div>

                <p className="mb-2 mt-4 text-xs text-muted-foreground">Allekirjoitus *</p>
                <SignaturePad onChange={setSignatureDataUrl} />
                <p className="mt-2 text-xs text-muted-foreground">
                  {profile.name} · {new Date().toLocaleDateString("fi-FI")} · versio {doc.version}
                </p>

                <label className="mt-5 flex cursor-pointer items-start gap-3 text-sm leading-relaxed">
                  <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} className="mt-0.5 h-4 w-4 shrink-0 accent-foreground" />
                  <span>{doc.closing}</span>
                </label>

                {error && <p className="mt-3 text-sm text-red-600 dark:text-red-400">{error}</p>}

                <div className="mt-6 flex items-center gap-3">
                  <Button variant="outline" onClick={() => go(-1)} className="gap-2"><ArrowLeft className="h-4 w-4" /> Takaisin</Button>
                  <Button onClick={submit} disabled={submitting} className="flex-1 gap-2">
                    {submitting ? "Tallennetaan…" : <>Allekirjoita ja jatka <ArrowRight className="h-4 w-4" /></>}
                  </Button>
                </div>
              </section>
            )}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}

function WelcomeStep({ isReturning, isFounder, name, onNext }: { isReturning: boolean; isFounder: boolean; name: string; onNext: () => void }) {
  return (
    <section className="text-center">
      {/* Ink-reveal brand hero — wipe the ink to reveal Puuhapatet */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="relative mx-auto mb-7 h-44 w-full max-w-md overflow-hidden rounded-3xl shadow-xl md:h-52"
      >
        {/* Behind the ink: gradient + wordmark */}
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-gradient-to-br from-emerald-500 via-teal-600 to-teal-800 text-white">
          <span className="text-3xl font-extrabold tracking-tight md:text-4xl">Puuhapatet</span>
          <span className="mt-1 text-xs font-medium uppercase tracking-[0.3em] text-white/80">Puhdasta jälkeä</span>
        </div>
        <InkReveal maskColor={[9, 11, 13]} brushSize={130} />
        <span className="pointer-events-none absolute bottom-3 left-0 right-0 z-[2] text-center text-[11px] font-medium uppercase tracking-[0.2em] text-white/70">
          Pyyhkäise paljastaaksesi
        </span>
      </motion.div>

      <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.15 }} className="text-sm font-medium uppercase tracking-[0.18em] text-muted-foreground">
        {isReturning ? "Päivitetyt sopimus & käytännöt" : "Tervetuloa"}
      </motion.p>
      <motion.h1 initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }} className="mt-2 text-3xl font-extrabold tracking-tight md:text-4xl">
        {isReturning ? "Pieni päivitys, ja jatketaan" : <>Tervetuloa Puuhapatetiin{name ? `, ${name.split(" ")[0]}` : ""}</>}
      </motion.h1>

      <motion.p initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.28 }} className="mx-auto mt-4 max-w-lg text-[15px] leading-relaxed text-muted-foreground">
        {isReturning
          ? "Olemme päivittäneet Puuhapatetin sopimusta ja käytäntöjä. Käy ne nopeasti läpi ja vahvista — sen jälkeen pääset jatkamaan kuten ennen."
          : isFounder
            ? "Tämä on yhteinen perustajasopimuksemme: miten rakennamme ja hoidamme Puuhapatetia yhdessä, läpinäkyvästi ja pitkäjänteisesti. Käydään se kerran läpi ja allekirjoitetaan."
            : "Olet osa Puuhapatetin tiimiä — itsenäinen tekijä yhteisen brändin alla. Ennen kuin avaamme työkalut, käydään läpi yhteinen sopimus ja muutama käytäntö. Vie pari minuuttia."}
      </motion.p>

      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.4 }} className="mt-8">
        <Button size="lg" onClick={onNext} className="gap-2">
          {isReturning ? "Katso muutokset" : "Aloitetaan"} <ArrowRight className="h-4 w-4" />
        </Button>
      </motion.div>
    </section>
  );
}

function Highlight({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border bg-card px-3 py-2.5 text-center">
      <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-0.5 text-sm font-semibold leading-tight">{value}</p>
    </div>
  );
}

function Eyebrow({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 text-muted-foreground">
      {icon}
      <h2 className="text-lg font-bold tracking-tight text-foreground">{children}</h2>
    </div>
  );
}

function NavRow({ onBack, onNext, nextLabel, nextDisabled }: { onBack: () => void; onNext: () => void; nextLabel: string; nextDisabled?: boolean }) {
  return (
    <div className="mt-6 flex items-center gap-3">
      <Button variant="outline" onClick={onBack} className="gap-2"><ArrowLeft className="h-4 w-4" /> Takaisin</Button>
      <Button onClick={onNext} disabled={nextDisabled} className="flex-1 gap-2">{nextLabel} <ArrowRight className="h-4 w-4" /></Button>
    </div>
  );
}

function Field({ label, children, full }: { label: string; children: React.ReactNode; full?: boolean }) {
  return (
    <label className={`block ${full ? "sm:col-span-2" : ""}`}>
      <span className="mb-1.5 block text-xs text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

const inputCls =
  "w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm outline-none focus:border-foreground/40";
