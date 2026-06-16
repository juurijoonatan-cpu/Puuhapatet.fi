/**
 * Public chat bubble — floating assistant for the customer site.
 *
 * - Answers from the Puuhapatet knowledge base via a free AI model (server side).
 * - Never guesses: if it can't help it offers to pass the message to the team.
 * - Live handoff: once the team replies in the admin inbox, those messages
 *   appear here (polled even while the panel is closed, with an unread dot).
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { MessageCircle, X, Send, Loader2, User } from "lucide-react";
import { useLocation } from "wouter";
import { useI18n } from "@/lib/i18n";
import { ChatMarkdown } from "@/components/chat-markdown";

interface Msg {
  role: "user" | "assistant" | "admin" | "system";
  content: string;
  authorName?: string | null;
}

const TOKEN_KEY = "puuhapatet_chat_token";

export function ChatWidget() {
  const [location] = useLocation();
  const { lang } = useI18n();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [status, setStatus] = useState<string>("bot");
  const [unseen, setUnseen] = useState(false);
  const [showContact, setShowContact] = useState(false);
  const [contact, setContact] = useState({ name: "", phone: "", email: "" });
  const [hasContact, setHasContact] = useState(false);
  const [token, setToken] = useState<string | null>(() =>
    typeof window !== "undefined" ? localStorage.getItem(TOKEN_KEY) : null,
  );
  const scrollRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const lastCountRef = useRef(0);

  const tr = useMemo(() => {
    const en = lang === "en";
    return {
      greeting: en
        ? "Hi! 👋 I'm the Puuhapatet assistant. Ask me about our services, price estimates and areas — or I can pass your message straight to the team. How can I help?"
        : "Moi! 👋 Olen Puuhapattien avustaja. Voin kertoa palveluista, hinta-arvioista ja alueista — tai välittää viestisi suoraan tiimille. Miten voin auttaa?",
      assistant: en ? "Assistant" : "Avustaja",
      teamReplying: en ? "The team is replying" : "Tiimi vastaa",
      waiting: en ? "Waiting for the team…" : "Odotetaan tiimiä…",
      placeholder: en ? "Type a message…" : "Kirjoita viesti…",
      talkToTeam: en ? "I'd like to talk to the team →" : "Haluan jutella tiimin kanssa →",
      openAria: en ? "Open chat" : "Avaa chat",
      closeAria: en ? "Close chat" : "Sulje chat",
      sendAria: en ? "Send" : "Lähetä",
      teamLabel: en ? "Puuhapatet team" : "Puuhapattien tiimi",
      connErr: en
        ? "Connection dropped for a moment. You can also call: Joonatan +358 40 0389999."
        : "Yhteys katkesi hetkeksi. Voit myös soittaa: Joonatan +358 40 0389999.",
      contactTitle: en ? "Leave your details and we'll be in touch" : "Jätä yhteystietosi, niin olemme yhteydessä",
      name: en ? "Name" : "Nimi",
      phone: en ? "Phone" : "Puhelin",
      emailOpt: en ? "Email (optional)" : "Sähköposti (valinnainen)",
      send: en ? "Send" : "Lähetä",
      requested: en
        ? "Thanks! Your request has been passed to the team — we usually reply the same day."
        : "Kiitos! Pyyntö välitettiin tiimille — vastaamme yleensä saman päivän aikana.",
    };
  }, [lang]);

  const greeting: Msg = useMemo(() => ({ role: "assistant", content: tr.greeting }), [tr.greeting]);
  const displayMessages = messages.length ? messages : [greeting];

  // Hide on admin / standalone tool routes — those have their own assistant.
  const hidden = location.startsWith("/admin") || location.startsWith("/tarjous") ||
    location.startsWith("/seuranta") || location.startsWith("/it") || location.startsWith("/cv");

  // Auto-grow the textarea.
  useEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = Math.min(ta.scrollHeight, 96) + "px";
  }, [input]);

  useEffect(() => {
    if (open) scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [displayMessages.length, open, sending]);

  function applyServerMessages(list: any[]) {
    const mapped: Msg[] = list.map((m) => ({ role: m.role, content: m.content, authorName: m.authorName }));
    setMessages([greeting, ...mapped]);
    // Mark unseen if a new admin/assistant message arrived while panel closed.
    const incoming = mapped.filter(m => m.role === "admin").length;
    if (!open && incoming > lastCountRef.current) setUnseen(true);
    lastCountRef.current = incoming;
  }

  // Poll for live admin replies whenever a human is involved (even when closed).
  useEffect(() => {
    if (!token) return;
    if (status !== "needs_human" && status !== "human") return;
    let active = true;
    const tick = async () => {
      try {
        const res = await fetch(`/api/chat/${token}`);
        if (!res.ok || !active) return;
        const data = await res.json();
        if (Array.isArray(data.messages)) applyServerMessages(data.messages);
        if (data.status) setStatus(data.status);
      } catch { /* ignore */ }
    };
    const iv = setInterval(tick, 5000);
    return () => { active = false; clearInterval(iv); };
  }, [token, status, open]);

  useEffect(() => { if (open) setUnseen(false); }, [open]);

  if (hidden) return null;

  async function send(textArg?: string) {
    const text = (textArg ?? input).trim();
    if (!text || sending) return;
    setInput("");
    setMessages((m) => [...(m.length ? m : [greeting]), { role: "user", content: text }]);
    setSending(true);
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, message: text, pageUrl: typeof window !== "undefined" ? window.location.href : undefined }),
      });
      const data = await res.json();
      if (data.token && data.token !== token) {
        setToken(data.token);
        localStorage.setItem(TOKEN_KEY, data.token);
      }
      if (data.status) {
        setStatus(data.status);
        if (data.status === "needs_human" && !hasContact) setShowContact(true);
      }
      if (Array.isArray(data.messages)) applyServerMessages(data.messages);
      else if (data.reply) setMessages((m) => [...m, { role: "assistant", content: data.reply }]);
    } catch {
      setMessages((m) => [...m, { role: "assistant", content: tr.connErr }]);
    } finally {
      setSending(false);
    }
  }

  async function submitContact() {
    if (!contact.name.trim() || !(contact.phone.trim() || contact.email.trim())) return;
    try {
      await fetch(`/api/chat/${token}/request-human`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(contact),
      });
    } catch { /* ignore */ }
    setHasContact(true);
    setShowContact(false);
    setStatus("needs_human");
    setMessages((m) => [...m, { role: "system", content: tr.requested }]);
  }

  function requestHuman() {
    setShowContact(true);
    if (status === "bot") setStatus("needs_human");
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
            className="fixed bottom-20 right-4 md:bottom-6 md:right-6 z-[60] w-14 h-14 rounded-full bg-primary text-primary-foreground shadow-lg flex items-center justify-center"
            aria-label={tr.openAria}
            data-testid="chat-launcher"
          >
            <MessageCircle className="w-7 h-7" />
            {unseen && <span className="absolute -top-0.5 -right-0.5 w-3.5 h-3.5 rounded-full bg-red-500 border-2 border-background" />}
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
            style={{ transformOrigin: "bottom right" }}
            className="fixed bottom-20 right-4 md:bottom-6 md:right-6 z-[60] w-[calc(100vw-2rem)] max-w-[380px] h-[70vh] max-h-[560px] flex flex-col rounded-2xl overflow-hidden bg-card border border-border shadow-2xl"
          >
            <div className="flex items-center justify-between px-4 py-3 bg-primary text-primary-foreground">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-full bg-white/15 flex items-center justify-center">
                  <MessageCircle className="w-5 h-5" />
                </div>
                <div>
                  <p className="font-semibold leading-tight">Puuhapatet</p>
                  <p className="text-xs opacity-80 leading-tight flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-300 inline-block" />
                    {status === "human" ? tr.teamReplying : status === "needs_human" ? tr.waiting : tr.assistant}
                  </p>
                </div>
              </div>
              <button onClick={() => setOpen(false)} aria-label={tr.closeAria} className="p-1 rounded-lg hover:bg-white/10">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-3 space-y-2 bg-background">
              {displayMessages.map((m, i) => {
                if (m.role === "system") {
                  return <p key={i} className="text-center text-xs text-muted-foreground py-1 px-4">{m.content}</p>;
                }
                const mine = m.role === "user";
                return (
                  <motion.div
                    key={i}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.18 }}
                    className={`flex ${mine ? "justify-end" : "justify-start"}`}
                  >
                    <div className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm ${
                      mine ? "bg-primary text-primary-foreground rounded-br-sm"
                           : m.role === "admin" ? "bg-emerald-100 text-emerald-950 dark:bg-emerald-900/40 dark:text-emerald-100 rounded-bl-sm"
                           : "bg-muted text-foreground rounded-bl-sm"
                    }`}>
                      {m.role === "admin" && (
                        <span className="flex items-center gap-1 text-[10px] font-semibold opacity-70 mb-0.5">
                          <User className="w-3 h-3" />{m.authorName || tr.teamLabel}
                        </span>
                      )}
                      {mine ? m.content : <ChatMarkdown content={m.content} />}
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

            <AnimatePresence>
              {showContact && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  className="overflow-hidden border-t border-border bg-muted/40"
                >
                  <div className="p-3 space-y-2">
                    <p className="text-xs font-medium text-foreground">{tr.contactTitle}</p>
                    <input
                      value={contact.name} onChange={(e) => setContact({ ...contact, name: e.target.value })}
                      placeholder={tr.name}
                      className="w-full rounded-lg border border-border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                    />
                    <div className="flex gap-2">
                      <input
                        value={contact.phone} onChange={(e) => setContact({ ...contact, phone: e.target.value })}
                        placeholder={tr.phone} inputMode="tel"
                        className="flex-1 rounded-lg border border-border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                      />
                    </div>
                    <input
                      value={contact.email} onChange={(e) => setContact({ ...contact, email: e.target.value })}
                      placeholder={tr.emailOpt} inputMode="email"
                      className="w-full rounded-lg border border-border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                    />
                    <button
                      onClick={submitContact}
                      disabled={!contact.name.trim() || !(contact.phone.trim() || contact.email.trim())}
                      className="w-full rounded-lg bg-primary text-primary-foreground py-1.5 text-sm font-medium disabled:opacity-40"
                    >
                      {tr.send}
                    </button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {!showContact && status !== "human" && (
              <div className="px-3 pt-1">
                <button onClick={requestHuman} className="text-xs text-primary hover:underline" data-testid="chat-request-human">
                  {tr.talkToTeam}
                </button>
              </div>
            )}

            <div className="flex items-end gap-2 p-3 border-t border-border bg-card">
              <textarea
                ref={taRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
                placeholder={tr.placeholder}
                rows={1}
                className="flex-1 resize-none rounded-xl border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 max-h-24"
                data-testid="chat-input"
              />
              <button
                onClick={() => send()}
                disabled={sending || !input.trim()}
                className="w-10 h-10 rounded-xl bg-primary text-primary-foreground flex items-center justify-center disabled:opacity-40 shrink-0 transition-opacity"
                aria-label={tr.sendAria}
                data-testid="chat-send"
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
