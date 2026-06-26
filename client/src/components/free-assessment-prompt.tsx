/**
 * Free assessment ("Ilmainen kartoituskäynti") prompt.
 *
 * A calm, on-brand nudge that surfaces our strongest no-risk offer: a free,
 * no-commitment site visit. Shown once per browser session, after a short
 * delay, and easy to dismiss. Positioned so it never collides with the chat
 * launcher (bottom-right) or the floating mobile nav (bottom-center): on
 * mobile it slides in just under the header, on desktop from the bottom-left.
 */

import { useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import { ClipboardCheck, X, ArrowRight } from "lucide-react";
import { useI18n } from "@/lib/i18n";

const SESSION_KEY = "pp_assessment_prompt_dismissed";
const SHOW_AFTER_MS = 6500;

export function FreeAssessmentPrompt() {
  const [location] = useLocation();
  const { lang } = useI18n();
  const [show, setShow] = useState(false);

  // Keep it classy: only on the landing page, and not on conversion routes
  // where the offer is already in front of the visitor.
  const eligible = location === "/";

  useEffect(() => {
    if (!eligible || typeof window === "undefined") return;
    if (sessionStorage.getItem(SESSION_KEY) === "1") return;
    const timer = window.setTimeout(() => setShow(true), SHOW_AFTER_MS);
    return () => window.clearTimeout(timer);
  }, [eligible]);

  const dismiss = () => {
    setShow(false);
    try { sessionStorage.setItem(SESSION_KEY, "1"); } catch { /* ignore */ }
  };

  const fi = lang !== "en";
  const tr = {
    badge: fi ? "Maksuton" : "Free",
    title: fi ? "Ilmainen kartoituskäynti" : "Free assessment visit",
    body: fi
      ? "Tilaa veloitukseton kartoitus — katsotaan kohde yhdessä ja saat tarkan hinnan. Ei sitoumuksia."
      : "Book a no-cost assessment — we look at the site together and you get an exact price. No commitment.",
    cta: fi ? "Varaa kartoitus" : "Book assessment",
    later: fi ? "Ehkä myöhemmin" : "Maybe later",
    close: fi ? "Sulje" : "Close",
  };

  return (
    <AnimatePresence>
      {show && (
        <motion.div
          initial={{ opacity: 0, y: 18, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 18, scale: 0.97 }}
          transition={{ type: "spring", stiffness: 320, damping: 30 }}
          role="dialog"
          aria-label={tr.title}
          className="fixed z-[55] top-[4.75rem] left-3 right-3 md:top-auto md:bottom-6 md:left-6 md:right-auto md:w-[360px] rounded-2xl bg-card border border-border border-t-[3px] border-t-primary shadow-2xl overflow-hidden"
          data-testid="assessment-prompt"
        >

          <button
            onClick={dismiss}
            aria-label={tr.close}
            className="absolute top-3 right-3 w-8 h-8 rounded-full bg-muted/70 hover:bg-muted text-muted-foreground hover:text-foreground flex items-center justify-center transition-colors"
          >
            <X className="w-4 h-4" />
          </button>

          <div className="p-4 pr-12">
            <div className="flex items-start gap-3">
              <div className="w-11 h-11 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0">
                <ClipboardCheck className="w-5 h-5 text-primary" />
              </div>
              <div className="min-w-0">
                <span className="inline-block text-[10px] font-semibold uppercase tracking-wider text-primary bg-primary/10 rounded-full px-2 py-0.5 mb-1.5">
                  {tr.badge}
                </span>
                <h3 className="text-base font-semibold text-foreground leading-snug">
                  {tr.title}
                </h3>
                <p className="text-sm text-muted-foreground leading-relaxed mt-1">
                  {tr.body}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-3 mt-4">
              <Link href="/tilaus" onClick={dismiss} className="flex-1">
                <button
                  className="w-full inline-flex items-center justify-center gap-1.5 rounded-xl bg-primary text-primary-foreground text-sm font-semibold py-2.5 transition-all hover:-translate-y-0.5 active:scale-[0.98]"
                  data-testid="assessment-cta"
                >
                  {tr.cta}
                  <ArrowRight className="w-4 h-4" />
                </button>
              </Link>
              <button
                onClick={dismiss}
                className="text-sm text-muted-foreground hover:text-foreground transition-colors px-1"
              >
                {tr.later}
              </button>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
