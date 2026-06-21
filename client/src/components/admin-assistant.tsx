/**
 * In-admin AI assistant — floating helper for the team.
 *
 * Knows the operational data (role-scoped server side) and helps with tasks:
 * summaries, scheduling/route ideas, drafting customer messages, optimising.
 * It advises and drafts — it does not change data itself.
 *
 * Conversation persists across admin navigation (sessionStorage) so the team
 * doesn't lose context when moving between pages.
 */

import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Sparkles, X, Send, Loader2, Trash2, Copy, Check, AlertCircle, Mail, AlertTriangle } from "lucide-react";
import { getAdminProfile } from "@/lib/admin-profile";
import { ChatMarkdown } from "@/components/chat-markdown";
import { API_BASE, withAuth } from "@/lib/api";

interface EmailDraft {
  jobId: number;
  customerName: string;
  email: string;
  style: "henkikohtainen" | "pro" | "lyhyt";
  message: string;
  warning?: string;
}
type DraftState = "pending" | "sending" | "sent" | "error";
interface Msg { role: "user" | "assistant"; content: string; drafts?: EmailDraft[]; draftStates?: DraftState[]; }

const STORE_KEY = "puuhapatet_assistant_thread";

const SUGGESTIONS = [
  "Mitkä keikat ovat tällä viikolla?",
  "Tee yhteenveto avoimista liideistä",
  "Ehdota uusia prospekteja Espoosta",
  "Luonnostele viesti asiakkaalle tarjouksen perään",
];

export function AdminAssistant() {
  const profile = typeof window !== "undefined" ? getAdminProfile() : null;
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Msg[]>(() => {
    if (typeof window === "undefined") return [];
    try { return JSON.parse(sessionStorage.getItem(STORE_KEY) || "[]"); } catch { return []; }
  });
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [aiEnabled, setAiEnabled] = useState<boolean | null>(null);
  const [copied, setCopied] = useState<number | null>(null);
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
      const res = await fetch(`${API_BASE}/api/admin/assistant`, {
        method: "POST",
        headers: withAuth({ "Content-Type": "application/json" }),
        body: JSON.stringify({
          message: content,
          userId: profile?.id,
          userName: profile?.name,
          role: profile?.role,
          history: messages.slice(-12),
        }),
      });
      const data = await res.json();
      const drafts: EmailDraft[] | undefined = Array.isArray(data.drafts) && data.drafts.length ? data.drafts : undefined;
      setMessages([...next, {
        role: "assistant",
        content: data.reply || data.error || "Ei vastausta.",
        drafts,
        draftStates: drafts ? drafts.map(() => "pending" as DraftState) : undefined,
      }]);
    } catch {
      setMessages([...next, { role: "assistant", content: "Yhteysvirhe. Yritä hetken kuluttua uudelleen." }]);
    } finally {
      setSending(false);
    }
  }

  async function sendDraft(msgIndex: number, draftIndex: number) {
    const msg = messages[msgIndex];
    const draft = msg?.drafts?.[draftIndex];
    if (!draft) return;
    if (msg.draftStates?.[draftIndex] === "sending" || msg.draftStates?.[draftIndex] === "sent") return;
    const setState = (s: DraftState) => setMessages(prev => prev.map((m, i) => {
      if (i !== msgIndex || !m.draftStates) return m;
      const ds = [...m.draftStates]; ds[draftIndex] = s;
      return { ...m, draftStates: ds };
    }));
    setState("sending");
    try {
      const res = await fetch(`${API_BASE}/api/admin/assistant/send-email`, {
        method: "POST",
        headers: withAuth({ "Content-Type": "application/json" }),
        body: JSON.stringify({ jobId: draft.jobId, message: draft.message, style: draft.style, role: profile?.role }),
      });
      const data = await res.json();
      setState(res.ok && data.ok ? "sent" : "error");
    } catch {
      setState("error");
    }
  }

  const styleLabel = (s: EmailDraft["style"]) =>
    s === "pro" ? "Virallinen" : s === "lyhyt" ? "Lyhyt" : "Henkilökohtainen";

  function clearThread() {
    setMessages([]);
    sessionStorage.removeItem(STORE_KEY);
  }

  async function copy(text: string, i: number) {
    try { await navigator.clipboard.writeText(text); setCopied(i); setTimeout(() => setCopied(null), 1500); } catch { /* ignore */ }
  }

  return (
    <>
      <AnimatePresence>
        {!open && (
          <motion.button
            initial={{ scale: 0, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0, opacity: 0 }}
            whileTap={{ scale: 0.92 }}
            onClick={() => setOpen(true)}
            style={{ bottom: "calc(env(safe-area-inset-bottom, 0px) + 5.75rem)" }}
            className="fixed right-4 md:!bottom-6 md:right-6 z-[55] w-14 h-14 rounded-full bg-primary text-primary-foreground shadow-lg shadow-primary/25 flex items-center justify-center ring-4 ring-background/80"
            aria-label="Avaa avustaja"
            data-testid="admin-assistant-launcher"
          >
            <Sparkles className="w-6 h-6" />
          </motion.button>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, scale: 0.9, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9, y: 20 }}
            transition={{ type: "spring", stiffness: 380, damping: 30 }}
            style={{ transformOrigin: "bottom right", bottom: "calc(env(safe-area-inset-bottom, 0px) + 5.75rem)" }}
            className="fixed right-4 md:!bottom-6 md:right-6 z-[58] w-[calc(100vw-2rem)] max-w-[400px] h-[calc(100dvh-9rem)] max-h-[620px] flex flex-col rounded-2xl overflow-hidden bg-card border border-border shadow-2xl"
          >
            <div className="flex items-center justify-between px-4 py-3 bg-primary text-primary-foreground">
              <div className="flex items-center gap-2">
                <Sparkles className="w-5 h-5" />
                <div>
                  <p className="font-semibold leading-tight">Avustaja</p>
                  <p className="text-xs opacity-80 leading-tight">{profile?.name} · {profile?.role}</p>
                </div>
              </div>
              <div className="flex items-center gap-1">
                {messages.length > 0 && (
                  <button onClick={clearThread} aria-label="Tyhjennä" className="p-1.5 rounded-lg hover:bg-white/10" title="Tyhjennä keskustelu">
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
                <button onClick={() => setOpen(false)} aria-label="Sulje" className="p-1.5 rounded-lg hover:bg-white/10">
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {aiEnabled === false && (
              <div className="flex items-start gap-2 px-3 py-2 bg-amber-50 dark:bg-amber-950/40 border-b border-amber-200 dark:border-amber-900 text-amber-800 dark:text-amber-200 text-xs">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>Tekoäly ei ole vielä käytössä. Lisää <code className="font-mono">AI_API_KEY</code> ympäristömuuttuja, niin avustaja herää henkiin.</span>
              </div>
            )}

            <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-3 space-y-2 bg-background">
              {messages.length === 0 && (
                <div className="space-y-2 pt-2">
                  <p className="text-sm text-muted-foreground px-1">
                    Kysy keikoista, asiakkaista tai pyydä apua tehtäviin. Avustaja näkee
                    {profile?.role === "HOST" ? " koko toiminnan." : " omat keikkasi ja asiakkaasi."}
                  </p>
                  {SUGGESTIONS.map((s) => (
                    <button
                      key={s}
                      onClick={() => send(s)}
                      className="block w-full text-left text-sm px-3 py-2 rounded-xl border border-border hover:bg-muted/60 hover:border-primary/40 transition-colors"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              )}
              {messages.map((m, i) => {
                const mine = m.role === "user";
                return (
                  <motion.div
                    key={i}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.18 }}
                    className={`flex ${mine ? "justify-end" : "justify-start"} group`}
                  >
                    <div className={`max-w-[88%] flex flex-col gap-2 ${mine ? "items-end" : "items-start"}`}>
                      <div className={`relative rounded-2xl px-3 py-2 text-sm ${
                        mine ? "bg-primary text-primary-foreground rounded-br-sm" : "bg-muted text-foreground rounded-bl-sm"
                      }`}>
                        {mine ? <span className="whitespace-pre-wrap">{m.content}</span> : <ChatMarkdown content={m.content} />}
                        {!mine && (
                          <button
                            onClick={() => copy(m.content, i)}
                            className="absolute -bottom-2 -right-2 w-6 h-6 rounded-full bg-card border border-border flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                            aria-label="Kopioi"
                          >
                            {copied === i ? <Check className="w-3 h-3 text-emerald-500" /> : <Copy className="w-3 h-3 text-muted-foreground" />}
                          </button>
                        )}
                      </div>
                      {!mine && m.drafts?.map((draft, di) => {
                        const state = m.draftStates?.[di] ?? "pending";
                        return (
                          <div key={di} className="w-full rounded-xl border border-border bg-card overflow-hidden">
                            <div className="flex items-center justify-between gap-2 px-3 py-2 bg-muted/50 border-b border-border">
                              <div className="flex items-center gap-1.5 min-w-0">
                                <Mail className="w-3.5 h-3.5 text-primary shrink-0" />
                                <span className="text-xs font-medium truncate">{draft.customerName}</span>
                              </div>
                              <span className="text-[10px] uppercase tracking-wide text-muted-foreground shrink-0">{styleLabel(draft.style)}</span>
                            </div>
                            <p className="px-3 py-2 text-[13px] leading-relaxed text-foreground/90 whitespace-pre-wrap">{draft.message}</p>
                            <p className="px-3 pb-1.5 text-[11px] text-muted-foreground truncate">→ {draft.email}</p>
                            {draft.warning && (
                              <div className="flex items-start gap-1.5 px-3 pb-2 text-[11px] text-amber-600 dark:text-amber-400">
                                <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-px" />
                                <span>{draft.warning}</span>
                              </div>
                            )}
                            <div className="px-3 pb-3 pt-1">
                              {state === "sent" ? (
                                <div className="flex items-center gap-1.5 text-xs font-medium text-emerald-600 dark:text-emerald-400">
                                  <Check className="w-4 h-4" /> Lähetetty
                                </div>
                              ) : state === "error" ? (
                                <button
                                  onClick={() => sendDraft(i, di)}
                                  className="w-full text-xs font-medium px-3 py-2 rounded-lg bg-destructive/10 text-destructive hover:bg-destructive/20 transition-colors"
                                >
                                  Lähetys epäonnistui — yritä uudelleen
                                </button>
                              ) : (
                                <button
                                  onClick={() => sendDraft(i, di)}
                                  disabled={state === "sending"}
                                  className="w-full flex items-center justify-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-lg bg-primary text-primary-foreground hover:opacity-90 transition-opacity disabled:opacity-50"
                                >
                                  {state === "sending"
                                    ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Lähetetään…</>
                                    : <><Send className="w-3.5 h-3.5" /> Hyväksy ja lähetä</>}
                                </button>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </motion.div>
                );
              })}
              {sending && (
                <div className="flex justify-start">
                  <div className="bg-muted rounded-2xl rounded-bl-sm px-3 py-2.5 flex items-center gap-1">
                    {[0, 1, 2].map((d) => (
                      <motion.span
                        key={d}
                        className="w-1.5 h-1.5 rounded-full bg-muted-foreground/60"
                        animate={{ opacity: [0.3, 1, 0.3] }}
                        transition={{ duration: 1, repeat: Infinity, delay: d * 0.2 }}
                      />
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
                placeholder="Kysy jotain…"
                rows={1}
                className="flex-1 resize-none rounded-xl border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 max-h-28"
                data-testid="admin-assistant-input"
              />
              <button
                onClick={() => send()}
                disabled={sending || !input.trim()}
                className="w-10 h-10 rounded-xl bg-primary text-primary-foreground flex items-center justify-center disabled:opacity-40 shrink-0"
                aria-label="Lähetä"
                data-testid="admin-assistant-send"
              >
                {sending ? <Loader2 className="w-5 h-5 animate-spin" /> : <Send className="w-5 h-5" />}
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
