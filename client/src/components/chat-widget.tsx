/**
 * Public chat bubble — floating assistant for the customer site.
 *
 * - Answers from the Puuhapatet knowledge base via a free AI model (server side).
 * - Never guesses: if it can't help it offers to pass the message to the team.
 * - Memory lives ONLY in the browser session (sessionStorage): it survives
 *   navigation between pages but is wiped when the visitor closes the tab, so
 *   every new visitor always starts on a clean slate. Nothing is stored
 *   server-side unless the visitor explicitly leaves a contact request.
 * - We are not live in the chat: a handoff just leaves a note for the team,
 *   who follow up by phone/email (usually the same day).
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { MessageCircle, X, Send, Loader2 } from "lucide-react";
import { useLocation } from "wouter";
import { useI18n } from "@/lib/i18n";
import { ChatMarkdown } from "@/components/chat-markdown";
import { API_BASE } from "@/lib/api";

interface Msg {
  role: "user" | "assistant" | "system";
  content: string;
}

// Session-scoped: cleared automatically when the tab/browser is closed.
const SESSION_KEY = "puuhapatet_chat_session";

function loadSession(): Msg[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function ChatWidget() {
  const [location] = useLocation();
  const { lang } = useI18n();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Msg[]>(() => loadSession());
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [showContact, setShowContact] = useState(false);
  const [contact, setContact] = useState({ name: "", phone: "", email: "" });
  const [requested, setRequested] = useState(false);
  // Mobile keyboard handling: track the visual viewport so the panel always
  // sits fully above the soft keyboard instead of being hidden behind it.
  const [vv, setVv] = useState<{ height: number; keyboard: number } | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);

  const tr = useMemo(() => {
    const en = lang === "en";
    return {
      greeting: en
        ? "Hi! 👋 I'm the Puuhapatet assistant. Ask me about our services, price estimates and areas — or I can pass your message straight to the team. How can I help?"
        : "Moi! 👋 Olen Puuhapattien avustaja. Voin kertoa palveluista, hinta-arvioista ja alueista — tai välittää viestisi suoraan tiimille. Miten voin auttaa?",
      assistant: en ? "Assistant" : "Avustaja",
      placeholder: en ? "Type a message…" : "Kirjoita viesti…",
      talkToTeam: en ? "Ask the team to contact me →" : "Pyydä tiimiä ottamaan yhteyttä →",
      openAria: en ? "Open chat" : "Avaa chat",
      closeAria: en ? "Close chat" : "Sulje chat",
      sendAria: en ? "Send" : "Lähetä",
      connErr: en
        ? "Connection dropped for a moment. You can also call: Joonatan +358 40 0389999."
        : "Yhteys katkesi hetkeksi. Voit myös soittaa: Joonatan +358 40 0389999.",
      contactTitle: en
        ? "We're not live in the chat right now, but leave your details and the team will be in touch."
        : "Emme päivystä chatissa juuri nyt, mutta jätä yhteystietosi niin tiimi on yhteydessä.",
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

  // Track the visual viewport on mobile while the panel is open. The soft
  // keyboard shrinks visualViewport.height (but not window.innerHeight), so we
  // resize the panel and lift it above the keyboard. Desktop keeps CSS sizing.
  useEffect(() => {
    if (!open || typeof window === "undefined") { setVv(null); return; }
    const visual = window.visualViewport;
    const isMobile = window.matchMedia("(max-width: 767px)").matches;
    if (!visual || !isMobile) { setVv(null); return; }
    const update = () => {
      const keyboard = Math.max(0, window.innerHeight - visual.height - visual.offsetTop);
      setVv({ height: visual.height, keyboard });
      // Keep the latest message visible as the layout changes.
      requestAnimationFrame(() => {
        scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
      });
    };
    update();
    visual.addEventListener("resize", update);
    visual.addEventListener("scroll", update);
    return () => {
      visual.removeEventListener("resize", update);
      visual.removeEventListener("scroll", update);
    };
  }, [open]);

  // Mirror the conversation into the browser session so it survives navigation
  // between pages, but is wiped automatically when the visitor closes the tab.
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      if (messages.length) sessionStorage.setItem(SESSION_KEY, JSON.stringify(messages));
      else sessionStorage.removeItem(SESSION_KEY);
    } catch { /* ignore quota / privacy-mode errors */ }
  }, [messages]);

  if (hidden) return null;

  async function send(textArg?: string) {
    const text = (textArg ?? input).trim();
    if (!text || sending) return;
    setInput("");
    // History sent to the server is whatever the browser remembers this session.
    const prior = messages.length ? messages : [];
    setMessages((m) => [...(m.length ? m : [greeting]), { role: "user", content: text }]);
    setSending(true);
    try {
      const res = await fetch(`${API_BASE}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: text,
          history: prior.filter((m) => m.role === "user" || m.role === "assistant"),
          pageUrl: typeof window !== "undefined" ? window.location.href : undefined,
        }),
      });
      const data = await res.json();
      if (data.reply) setMessages((m) => [...m, { role: "assistant", content: data.reply }]);
      // Bot couldn't fully help or visitor asked for a person → offer handoff.
      if (data.offerHandoff && !requested) setShowContact(true);
    } catch {
      setMessages((m) => [...m, { role: "assistant", content: tr.connErr }]);
    } finally {
      setSending(false);
    }
  }

  async function submitContact() {
    if (!contact.name.trim() || !(contact.phone.trim() || contact.email.trim())) return;
    // The visitor's most recent question, for the team's context.
    const lastQuestion = [...messages].reverse().find((m) => m.role === "user")?.content ?? "";
    try {
      await fetch(`${API_BASE}/api/chat/handoff`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...contact,
          question: lastQuestion,
          transcript: messages.filter((m) => m.role === "user" || m.role === "assistant"),
          pageUrl: typeof window !== "undefined" ? window.location.href : undefined,
        }),
      });
    } catch { /* ignore */ }
    setRequested(true);
    setShowContact(false);
    setMessages((m) => [...m, { role: "system", content: tr.requested }]);
  }

  function requestHuman() {
    setShowContact(true);
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
            className="fixed bottom-[6.5rem] right-4 md:bottom-6 md:right-6 z-[60] w-14 h-14 rounded-full bg-primary text-primary-foreground shadow-lg flex items-center justify-center"
            style={{ marginBottom: "env(safe-area-inset-bottom)" }}
            aria-label={tr.openAria}
            data-testid="chat-launcher"
          >
            <MessageCircle className="w-7 h-7" />
          </motion.button>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, scale: 0.92, y: 24 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.92, y: 24 }}
            transition={{ type: "spring", stiffness: 380, damping: 32 }}
            style={
              vv
                ? {
                    transformOrigin: "bottom center",
                    height: Math.min(vv.height - 24, 620),
                    bottom: vv.keyboard + 12,
                  }
                : { transformOrigin: "bottom right" }
            }
            className="fixed left-3 right-3 bottom-3 md:left-auto md:right-6 md:bottom-6 z-[70] md:w-[380px] h-[80dvh] md:h-[70vh] max-h-[620px] md:max-h-[560px] flex flex-col rounded-2xl overflow-hidden bg-card border border-border shadow-2xl"
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
                    {tr.assistant}
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
                           : "bg-muted text-foreground rounded-bl-sm"
                    }`}>
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

            {!showContact && !requested && (
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
                onFocus={() => {
                  // Once the keyboard animates in, pin the view to the latest message.
                  setTimeout(() => scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" }), 300);
                }}
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
