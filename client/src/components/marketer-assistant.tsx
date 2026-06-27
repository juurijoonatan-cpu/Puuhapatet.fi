/**
 * MarketerAssistant — AI offer apuri for door-to-door marketers.
 *
 * The marketer describes a target in plain Finnish ("iso talo, ~40 ikkunaa,
 * 6 ruutua, tikkaat, premium-alue"); the assistant (Claude Opus server-side)
 * prices it against our real price lists, estimates time, and PROPOSES a ready
 * offer. Nothing is written until the marketer taps "Vahvista" — that creates
 * the lead + a shareable /tarjous link (founder triage as usual).
 *
 * Controlled by the parent (sell.tsx) via `open` / `onClose`. Reuses the
 * proposal/confirm pattern from admin-assistant.tsx.
 */

import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Sparkles, X, Send, Loader2, Trash2, Check, AlertCircle, ClipboardCheck, Copy, ExternalLink, Share2 } from "lucide-react";
import { getAdminProfile } from "@/lib/admin-profile";
import { ChatMarkdown } from "@/components/chat-markdown";
import { API_BASE, withAuth } from "@/lib/api";

interface OfferAction {
  id: string;
  type: "create_offer";
  title: string;
  detail: string;
  payload: any;
}
type ActionState = "pending" | "applying" | "done" | "error";
interface Msg {
  role: "user" | "assistant";
  content: string;
  actions?: OfferAction[];
  actionStates?: ActionState[];
}

const STORE_KEY = "puuhapatet_marketer_assistant_thread";

const SUGGESTIONS = [
  "Omakotitalo ~120 m², kaikki pinnat, tikkaat — paljonko?",
  "Iso talo, 40 ikkunaa, 6 ruutua/ikkuna, premium-alue — tee tarjous",
  "Taloyhtiö, 80 ikkunaa, vain ulkopinnat, 2. kerros",
];

const offerUrl = (token: string) =>
  `${typeof window !== "undefined" ? window.location.origin : "https://puuhapatet.fi"}/tarjous/${token}`;

export function MarketerAssistant({ open, onClose }: { open: boolean; onClose: () => void }) {
  const profile = typeof window !== "undefined" ? getAdminProfile() : null;
  const [messages, setMessages] = useState<Msg[]>(() => {
    if (typeof window === "undefined") return [];
    try { return JSON.parse(sessionStorage.getItem(STORE_KEY) || "[]"); } catch { return []; }
  });
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [aiEnabled, setAiEnabled] = useState<boolean | null>(null);
  const [links, setLinks] = useState<Record<string, string>>({});
  const [copied, setCopied] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    fetch(`${API_BASE}/api/ai-status`).then(r => r.json()).then(d => setAiEnabled(!!d.enabled)).catch(() => setAiEnabled(null));
  }, []);
  useEffect(() => {
    try { sessionStorage.setItem(STORE_KEY, JSON.stringify(messages.slice(-40))); } catch { /* ignore */ }
  }, [messages]);
  useEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = Math.min(ta.scrollHeight, 112) + "px";
  }, [input]);
  useEffect(() => {
    if (open) scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages.length, open, sending]);

  async function send(text?: string) {
    const content = (text ?? input).trim();
    if (!content || sending) return;
    setInput("");
    const next = [...messages, { role: "user" as const, content }];
    setMessages(next);
    setSending(true);
    try {
      const res = await fetch(`${API_BASE}/api/marketer/assistant`, {
        method: "POST",
        headers: withAuth({ "Content-Type": "application/json" }),
        body: JSON.stringify({ message: content, userName: profile?.name, history: messages.slice(-12) }),
      });
      const data = await res.json();
      const actions: OfferAction[] | undefined = Array.isArray(data.actions) && data.actions.length ? data.actions : undefined;
      setMessages([...next, {
        role: "assistant",
        content: data.reply || data.error || "Ei vastausta.",
        actions,
        actionStates: actions ? actions.map(() => "pending" as ActionState) : undefined,
      }]);
    } catch {
      setMessages([...next, { role: "assistant", content: "Yhteysvirhe. Yritä hetken kuluttua uudelleen." }]);
    } finally {
      setSending(false);
    }
  }

  async function applyAction(msgIndex: number, actionIndex: number) {
    const msg = messages[msgIndex];
    const action = msg?.actions?.[actionIndex];
    if (!action) return;
    const cur = msg.actionStates?.[actionIndex];
    if (cur === "applying" || cur === "done") return;
    const setState = (s: ActionState) => setMessages(prev => prev.map((m, i) => {
      if (i !== msgIndex || !m.actionStates) return m;
      const as = [...m.actionStates]; as[actionIndex] = s;
      return { ...m, actionStates: as };
    }));
    setState("applying");
    try {
      const res = await fetch(`${API_BASE}/api/marketer/assistant/apply-action`, {
        method: "POST",
        headers: withAuth({ "Content-Type": "application/json" }),
        body: JSON.stringify({ type: action.type, payload: action.payload }),
      });
      const data = await res.json();
      if (res.ok && data.ok) {
        if (data.quoteToken) setLinks(prev => ({ ...prev, [`${msgIndex}-${actionIndex}`]: offerUrl(data.quoteToken) }));
        setState("done");
      } else {
        setState("error");
      }
    } catch {
      setState("error");
    }
  }

  async function copy(text: string, key: string) {
    try { await navigator.clipboard.writeText(text); setCopied(key); setTimeout(() => setCopied(null), 1600); } catch { /* ignore */ }
  }

  function clearThread() {
    setMessages([]);
    setLinks({});
    sessionStorage.removeItem(STORE_KEY);
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0, scale: 0.9, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.9, y: 20 }}
          transition={{ type: "spring", stiffness: 380, damping: 30 }}
          style={{ transformOrigin: "bottom right", bottom: "calc(env(safe-area-inset-bottom, 0px) + 1.25rem)" }}
          className="fixed right-4 md:right-6 z-[58] w-[calc(100vw-2rem)] max-w-[400px] h-[calc(100dvh-7rem)] max-h-[640px] flex flex-col rounded-2xl overflow-hidden bg-card border border-border shadow-2xl"
        >
          <div className="flex items-center justify-between px-4 py-3 bg-primary text-primary-foreground">
            <div className="flex items-center gap-2">
              <Sparkles className="w-5 h-5" />
              <div>
                <p className="font-semibold leading-tight">AI-tarjousapuri</p>
                <p className="text-xs opacity-80 leading-tight">Hinnoittele & tee tarjous</p>
              </div>
            </div>
            <div className="flex items-center gap-1">
              {messages.length > 0 && (
                <button onClick={clearThread} aria-label="Tyhjennä" className="p-1.5 rounded-lg hover:bg-white/10" title="Tyhjennä keskustelu">
                  <Trash2 className="w-4 h-4" />
                </button>
              )}
              <button onClick={onClose} aria-label="Sulje" className="p-1.5 rounded-lg hover:bg-white/10">
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>

          {aiEnabled === false && (
            <div className="flex items-start gap-2 px-3 py-2 bg-amber-50 dark:bg-amber-950/40 border-b border-amber-200 dark:border-amber-900 text-amber-800 dark:text-amber-200 text-xs">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>Tekoäly ei ole vielä käytössä. Lisää <code className="font-mono">ANTHROPIC_API_KEY</code> ympäristömuuttuja.</span>
            </div>
          )}

          <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-3 space-y-2 bg-background">
            {messages.length === 0 && (
              <div className="space-y-2 pt-2">
                <p className="text-sm text-muted-foreground px-1">
                  Kuvaile kohde, niin lasken hinnan oikeilla hinnastoillamme, arvioin keston ja teen valmiin tarjouksen.
                </p>
                {SUGGESTIONS.map((s) => (
                  <button key={s} onClick={() => send(s)}
                    className="block w-full text-left text-sm px-3 py-2 rounded-xl border border-border hover:bg-muted/60 hover:border-primary/40 transition-colors">
                    {s}
                  </button>
                ))}
              </div>
            )}
            {messages.map((m, i) => {
              const mine = m.role === "user";
              return (
                <div key={i} className={`flex ${mine ? "justify-end" : "justify-start"} group`}>
                  <div className={`max-w-[88%] flex flex-col gap-2 ${mine ? "items-end" : "items-start"}`}>
                    <div className={`relative rounded-2xl px-3 py-2 text-sm ${mine ? "bg-primary text-primary-foreground rounded-br-sm" : "bg-muted text-foreground rounded-bl-sm"}`}>
                      {mine ? <span className="whitespace-pre-wrap">{m.content}</span> : <ChatMarkdown content={m.content} />}
                    </div>
                    {!mine && m.actions?.map((action, ai) => {
                      const state = m.actionStates?.[ai] ?? "pending";
                      const link = links[`${i}-${ai}`];
                      return (
                        <div key={ai} className="w-full rounded-xl border border-border bg-card overflow-hidden">
                          <div className="flex items-center gap-1.5 px-3 py-2 bg-muted/50 border-b border-border">
                            <ClipboardCheck className="w-3.5 h-3.5 text-primary shrink-0" />
                            <span className="text-xs font-medium truncate">{action.title}</span>
                          </div>
                          {action.detail && <p className="px-3 py-2 text-[13px] leading-relaxed text-foreground/90 whitespace-pre-wrap">{action.detail}</p>}
                          {state === "done" ? (
                            <div className="px-3 pb-3 pt-1 space-y-2">
                              <div className="flex items-center gap-1.5 text-xs font-medium text-emerald-600 dark:text-emerald-400">
                                <Check className="w-4 h-4" /> Tarjous luotu — lähti tarkistukseen
                              </div>
                              {link && (
                                <div className="flex items-center gap-3 text-xs">
                                  <button onClick={() => copy(link, `${i}-${ai}`)} className="text-primary flex items-center gap-1">
                                    {copied === `${i}-${ai}` ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />} {copied === `${i}-${ai}` ? "Kopioitu" : "Kopioi linkki"}
                                  </button>
                                  <a href={link} target="_blank" rel="noreferrer" className="text-muted-foreground flex items-center gap-1"><ExternalLink className="w-3 h-3" /> Avaa</a>
                                  <a href={`https://wa.me/?text=${encodeURIComponent("Tässä tarjouksenne Puuhapateilta: " + link)}`} target="_blank" rel="noreferrer" className="text-muted-foreground flex items-center gap-1"><Share2 className="w-3 h-3" /> WhatsApp</a>
                                </div>
                              )}
                            </div>
                          ) : (
                            <div className="px-3 pb-3 pt-1">
                              <p className="pb-1.5 text-[11px] text-muted-foreground">Ehdotus — mitään ei luoda ennen kuin vahvistat.</p>
                              {state === "error" ? (
                                <button onClick={() => applyAction(i, ai)} className="w-full text-xs font-medium px-3 py-2 rounded-lg bg-destructive/10 text-destructive hover:bg-destructive/20 transition-colors">
                                  Vahvistus epäonnistui — yritä uudelleen
                                </button>
                              ) : (
                                <button onClick={() => applyAction(i, ai)} disabled={state === "applying"}
                                  className="w-full flex items-center justify-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-lg bg-primary text-primary-foreground hover:opacity-90 transition-opacity disabled:opacity-50">
                                  {state === "applying" ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Luodaan…</> : <><Check className="w-3.5 h-3.5" /> Vahvista & luo tarjouslinkki</>}
                                </button>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
            {sending && (
              <div className="flex justify-start">
                <div className="bg-muted rounded-2xl rounded-bl-sm px-3 py-2.5 flex items-center gap-1">
                  {[0, 1, 2].map((d) => (
                    <motion.span key={d} className="w-1.5 h-1.5 rounded-full bg-muted-foreground/60"
                      animate={{ opacity: [0.3, 1, 0.3] }} transition={{ duration: 1, repeat: Infinity, delay: d * 0.2 }} />
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="flex items-end gap-2 p-3 border-t border-border bg-card">
            <textarea
              ref={taRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
              placeholder="Kuvaile kohde…"
              rows={1}
              className="flex-1 resize-none rounded-xl border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 max-h-28"
            />
            <button onClick={() => send()} disabled={sending || !input.trim()}
              className="w-10 h-10 rounded-xl bg-primary text-primary-foreground flex items-center justify-center disabled:opacity-40 shrink-0" aria-label="Lähetä">
              {sending ? <Loader2 className="w-5 h-5 animate-spin" /> : <Send className="w-5 h-5" />}
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
