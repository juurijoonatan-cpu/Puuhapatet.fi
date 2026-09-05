/**
 * Free assessment ("Ilmainen kartoituskäynti") prompt.
 *
 * A calm, on-brand nudge that surfaces our strongest no-risk offer: a free,
 * no-commitment site visit. Shown once per browser session, after a short
 * delay, and easy to dismiss. Positioned so it never collides with the chat
 * launcher (bottom-right) or the floating mobile nav (bottom-center): on
 * mobile it slides in just under the header, on desktop from the bottom-left.
 *
 * The card used to wear a flat `border-t-[3px] border-t-primary`. Against the
 * rounded corners that read as a stray green line laid on top of the card
 * rather than part of it, and it landed fully drawn a beat before the card
 * itself had finished arriving. It is now a gradient hairline that draws in
 * from the left behind the card's own clipping, with a slow sheen over it —
 * same accent colour, but it belongs to the card. See `.pp-accent` in
 * index.css; `prefers-reduced-motion` freezes it fully drawn.
 */

import { useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { ClipboardCheck, X, ArrowRight } from "lucide-react";
import { LeafFall } from "@/components/leaf-fall";
import { currentSeason } from "@shared/season";
import { useI18n } from "@/lib/i18n";

const SESSION_KEY = "pp_assessment_prompt_dismissed";
const SHOW_AFTER_MS = 6500;

/** Shared by the icon row and the button row so they rise as one motion. */
const fadeUp = {
  hidden: { opacity: 0, y: 8 },
  shown: { opacity: 1, y: 0, transition: { duration: 0.35, ease: [0.22, 1, 0.36, 1] as const } },
};
/** Same two states, no travel — the card still fades, it just doesn't fly. */
const fadeOnly = { hidden: { opacity: 0 }, shown: { opacity: 1 } };

export function FreeAssessmentPrompt() {
  const [location] = useLocation();
  const { lang } = useI18n();
  const [show, setShow] = useState(false);
  // Framer only honours the OS setting if we ask it to; the blur-and-spring
  // entrance below is exactly the sort of thing the setting exists to stop.
  const reduced = useReducedMotion();
  // Sama sääntö kuin etusivun osiossa: lehdet syksyllä, lumi talvella, muuten
  // ei mitään. Kortti ei saa kertoa eri vuodenaikaa kuin sivu sen takana.
  const season = currentSeason();
  const fallVariant = season === "syksy" ? "leaves" : season === "talvi" ? "snow" : null;

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
          initial={reduced ? { opacity: 0 } : { opacity: 0, y: 22, scale: 0.96, filter: "blur(6px)" }}
          animate={reduced ? { opacity: 1 } : { opacity: 1, y: 0, scale: 1, filter: "blur(0px)" }}
          exit={reduced ? { opacity: 0 } : { opacity: 0, y: 12, scale: 0.97, filter: "blur(4px)" }}
          transition={
            reduced
              ? { duration: 0.2 }
              : { type: "spring", stiffness: 260, damping: 26, mass: 0.9 }
          }
          role="dialog"
          aria-label={tr.title}
          className="fixed z-[55] top-[4.75rem] left-3 right-3 md:top-auto md:bottom-6 md:left-6 md:right-auto md:w-[360px] rounded-2xl bg-card border border-border shadow-2xl overflow-hidden"
          data-testid="assessment-prompt"
        >
          {/* Accent hairline — inside the rounded clip, so it follows the card. */}
          <span
            aria-hidden="true"
            className="pp-accent absolute inset-x-0 top-0 h-[2px] overflow-hidden bg-gradient-to-r from-primary via-primary/70 to-transparent"
          />

          {/* A couple of leaves behind the copy: the same autumn cue as the
              before/after section, at a whisper so it never fights the text. */}
          {fallVariant && <LeafFall className="opacity-[0.18]" count={5} size={11} variant={fallVariant} />}

          <button
            onClick={dismiss}
            aria-label={tr.close}
            className="absolute z-10 top-3 right-3 w-8 h-8 rounded-full bg-muted/70 hover:bg-muted text-muted-foreground hover:text-foreground flex items-center justify-center transition-colors"
          >
            <X className="w-4 h-4" />
          </button>

          <motion.div
            className="relative p-4 pr-12"
            initial="hidden"
            animate="shown"
            variants={{
              shown: reduced ? {} : { transition: { delayChildren: 0.12, staggerChildren: 0.06 } },
            }}
          >
            <motion.div className="flex items-start gap-3" variants={reduced ? fadeOnly : fadeUp}>
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
            </motion.div>

            <motion.div className="flex items-center gap-3 mt-4" variants={reduced ? fadeOnly : fadeUp}>
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
            </motion.div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
