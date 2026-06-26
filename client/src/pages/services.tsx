import { useState } from "react";
import { Link } from "wouter";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  ArrowRight, Sparkles, Snowflake, Car, Building2, Check, Leaf, PaintBucket,
  ShieldCheck, Shovel, ClipboardCheck, BadgePercent, ChevronDown, X, Tag, Sun,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { useI18n } from "@/lib/i18n";

type ServiceKey = "windows" | "signs" | "gutters";

export default function ServicesPage() {
  const { t } = useI18n();
  const [activeService, setActiveService] = useState<ServiceKey | null>(null);
  const [moreOpen, setMoreOpen] = useState(false);

  const mainServices = [
    {
      key: "windows" as ServiceKey,
      photo: "/work-highrise.jpg",
      videoSrc: "/work-window.mov",
      icon: Sparkles,
      iconColor: "text-white/90",
      titleKey: "service.basic.title",
      descKey: "service.basic.desc",
      popupDescKey: "service.basic.popup",
      bullets: ["service.basic.1", "service.basic.2", "service.basic.3"],
      badge: t("service.basic.popular"),
    },
    {
      key: "signs" as ServiceKey,
      photo: "/work-sign.jpg",
      icon: Tag,
      iconColor: "text-amber-300",
      titleKey: "service.signs.title",
      descKey: "service.signs.desc",
      popupDescKey: "service.signs.popup",
      bullets: ["service.signs.1", "service.signs.2", "service.signs.3"],
    },
    {
      key: "gutters" as ServiceKey,
      photo: "/work-gutter.jpg",
      icon: Sun,
      iconColor: "text-yellow-300",
      titleKey: "service.gutters.title",
      descKey: "service.gutters.desc",
      popupDescKey: "service.gutters.popup",
      bullets: ["service.gutters.1", "service.gutters.2", "service.gutters.3"],
    },
  ];

  const active = mainServices.find(s => s.key === activeService) ?? null;

  return (
    <div className="min-h-screen bg-background pt-20 md:pt-24 pb-28">
      <div className="container mx-auto px-4 max-w-4xl">

        {/* Header */}
        <div className="text-center mb-10">
          <h1 className="text-3xl md:text-4xl font-semibold text-foreground mb-4">
            {t("services.title")}
          </h1>
          <p className="text-lg text-muted-foreground max-w-xl mx-auto leading-relaxed">
            {t("services.subtitle")}
          </p>
        </div>

        {/* ── Main services ── */}
        <div className="mb-10">
          <h2 className="text-lg font-semibold text-foreground mb-4">{t("services.main.title")}</h2>
          <div className="grid md:grid-cols-3 gap-4">
            {mainServices.map((svc) => {
              const Icon = svc.icon;
              return (
                <button
                  key={svc.key}
                  onClick={() => setActiveService(svc.key)}
                  className="group relative rounded-2xl overflow-hidden premium-shadow aspect-[4/3] text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                  data-testid={`service-main-${svc.key}`}
                >
                  <img
                    src={svc.photo}
                    alt={t(svc.titleKey as any)}
                    className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-[1.04]"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/15 to-transparent" />
                  <div className="absolute bottom-0 left-0 right-0 p-4">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <Icon className={`w-4 h-4 ${svc.iconColor} flex-shrink-0`} />
                      <h3 className="text-white font-semibold text-sm leading-tight">{t(svc.titleKey as any)}</h3>
                      {svc.badge && (
                        <span className="ml-auto text-[9px] font-bold text-primary bg-white rounded-full px-2 py-0.5 flex-shrink-0">
                          {svc.badge}
                        </span>
                      )}
                    </div>
                    <p className="text-white/70 text-xs leading-relaxed line-clamp-2 mb-3">
                      {t(svc.descKey as any)}
                    </p>
                    <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-white bg-white/20 backdrop-blur-sm group-hover:bg-white/30 rounded-full px-3 py-1.5 transition-all">
                      Lue lisää
                      <ArrowRight className="w-3.5 h-3.5" />
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Promise */}
        <div className="rounded-2xl bg-primary/5 border border-primary/10 p-5 md:p-6 mb-6 flex gap-4 items-start">
          <ShieldCheck className="w-6 h-6 text-primary flex-shrink-0 mt-0.5" />
          <p className="text-sm text-muted-foreground leading-relaxed">
            {t("services.promise")}
          </p>
        </div>

        {/* Trust band */}
        <div className="grid gap-3 sm:grid-cols-3 mb-10">
          {[
            { icon: ClipboardCheck, titleKey: "trustband.assessment.title", descKey: "trustband.assessment.desc" },
            { icon: BadgePercent, titleKey: "trustband.deduction.title", descKey: "trustband.deduction.desc" },
            { icon: ShieldCheck, titleKey: "trustband.guarantee.title", descKey: "trustband.guarantee.desc" },
          ].map(({ icon: Icon, titleKey, descKey }) => (
            <Card key={titleKey} className="p-5 bg-card border-0 premium-shadow">
              <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center mb-3">
                <Icon className="w-5 h-5 text-primary" />
              </div>
              <h3 className="text-sm font-semibold text-foreground mb-1">{t(titleKey as any)}</h3>
              <p className="text-xs text-muted-foreground leading-relaxed">{t(descKey as any)}</p>
            </Card>
          ))}
        </div>

        {/* ── More services collapsible ── */}
        <div className="mb-12">
          <button
            onClick={() => setMoreOpen(v => !v)}
            className="w-full flex items-center justify-between p-4 rounded-2xl border border-border bg-card hover:bg-muted/40 transition-colors"
            aria-expanded={moreOpen}
          >
            <span className="font-semibold text-foreground">{t("services.more.label")}</span>
            <ChevronDown
              className={`w-5 h-5 text-muted-foreground transition-transform duration-200 ${moreOpen ? "rotate-180" : ""}`}
            />
          </button>

          <AnimatePresence initial={false}>
            {moreOpen && (
              <motion.div
                key="more-services"
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.28, ease: "easeInOut" }}
                className="overflow-hidden"
              >
                <div className="space-y-4 pt-4">

                  {/* Talvikiilto */}
                  <Card className="p-6 md:p-8 bg-gradient-to-br from-blue-50 to-blue-100/50 dark:from-blue-950/30 dark:to-blue-900/20 border-0 premium-shadow" data-testid="service-talvikiilto">
                    <div className="flex items-start gap-4">
                      <div className="w-12 h-12 rounded-xl bg-blue-500/20 flex items-center justify-center flex-shrink-0">
                        <Snowflake className="w-6 h-6 text-blue-600 dark:text-blue-400" />
                      </div>
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-2">
                          <h2 className="text-xl font-semibold text-foreground">{t("service.talvikiilto.title")}</h2>
                        </div>
                        <p className="text-muted-foreground mb-3">{t("service.talvikiilto.desc")}</p>
                        <p className="text-sm font-medium text-blue-700 dark:text-blue-300 mb-4">{t("service.talvikiilto.why")}</p>
                        <ul className="space-y-2">
                          {(["1","2","3"] as const).map(n => (
                            <li key={n} className="flex items-start gap-2 text-muted-foreground text-sm">
                              <Check className="w-4 h-4 text-blue-600 dark:text-blue-400 flex-shrink-0 mt-0.5" />
                              <span>{t(`service.talvikiilto.${n}` as any)}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    </div>
                  </Card>

                  {/* Lumityöt */}
                  <Card className="p-6 md:p-8 bg-card border-0 premium-shadow" data-testid="service-lumityot">
                    <div className="flex items-start gap-4">
                      <div className="w-12 h-12 rounded-xl bg-sky-100 dark:bg-sky-900/30 flex items-center justify-center flex-shrink-0">
                        <Shovel className="w-6 h-6 text-sky-600 dark:text-sky-400" />
                      </div>
                      <div className="flex-1">
                        <h2 className="text-xl font-semibold text-foreground mb-2">{t("service.lumityot.title")}</h2>
                        <p className="text-muted-foreground mb-3">{t("service.lumityot.desc")}</p>
                        <ul className="space-y-2">
                          {(["1","2","3"] as const).map(n => (
                            <li key={n} className="flex items-center gap-2 text-muted-foreground text-sm">
                              <Check className="w-4 h-4 text-sky-600 dark:text-sky-400 flex-shrink-0" />
                              <span>{t(`service.lumityot.${n}` as any)}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    </div>
                  </Card>

                  {/* Piha & puutarha */}
                  <Card className="p-6 md:p-8 bg-card border-0 premium-shadow" data-testid="service-gardening">
                    <div className="flex items-start gap-4">
                      <div className="w-12 h-12 rounded-xl bg-lime-100 dark:bg-lime-900/30 flex items-center justify-center flex-shrink-0">
                        <Leaf className="w-6 h-6 text-lime-700 dark:text-lime-400" />
                      </div>
                      <div className="flex-1">
                        <h2 className="text-xl font-semibold text-foreground mb-2">{t("service.gardening.title")}</h2>
                        <p className="text-muted-foreground mb-3">{t("service.gardening.desc")}</p>
                        <ul className="space-y-2">
                          {(["1","2","3","4"] as const).map(n => (
                            <li key={n} className="flex items-center gap-2 text-muted-foreground text-sm">
                              <Check className="w-4 h-4 text-lime-700 dark:text-lime-400 flex-shrink-0" />
                              <span>{t(`service.gardening.${n}` as any)}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    </div>
                  </Card>

                  {/* Auton sisäfreesaus */}
                  <Card className="p-6 md:p-8 bg-card border-0 premium-shadow" data-testid="service-cardetailing">
                    <div className="flex items-start gap-4">
                      <div className="w-12 h-12 rounded-xl bg-green-100 dark:bg-green-900/30 flex items-center justify-center flex-shrink-0">
                        <Car className="w-6 h-6 text-green-700 dark:text-green-400" />
                      </div>
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1 flex-wrap">
                          <h2 className="text-xl font-semibold text-foreground">{t("service.cardetailing.title")}</h2>
                          <Badge variant="outline" className="text-green-700 border-green-300 bg-green-50 dark:bg-green-900/30 dark:border-green-800 text-xs">
                            {t("service.cardetailing.partner")}
                          </Badge>
                          <span className="text-sm font-semibold text-green-700 dark:text-green-400">{t("service.cardetailing.price")}</span>
                        </div>
                        <p className="text-muted-foreground mb-3">{t("service.cardetailing.desc")}</p>
                        <ul className="space-y-2">
                          {(["1","2","3","4","5"] as const).map(n => (
                            <li key={n} className="flex items-center gap-2 text-muted-foreground text-sm">
                              <Check className="w-4 h-4 text-green-700 dark:text-green-400 flex-shrink-0" />
                              <span>{t(`service.cardetailing.${n}` as any)}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    </div>
                  </Card>

                  {/* Erikoistyöt */}
                  <Card className="p-6 md:p-8 bg-card border-0 premium-shadow" data-testid="service-special">
                    <div className="flex items-start gap-4">
                      <div className="w-12 h-12 rounded-xl bg-orange-100 dark:bg-orange-900/30 flex items-center justify-center flex-shrink-0">
                        <Building2 className="w-6 h-6 text-orange-600 dark:text-orange-400" />
                      </div>
                      <div className="flex-1">
                        <h2 className="text-xl font-semibold text-foreground mb-2">{t("service.special.title")}</h2>
                        <p className="text-muted-foreground mb-3">{t("service.special.desc")}</p>
                        <ul className="space-y-2 mb-4">
                          {(["1","2","3"] as const).map(n => (
                            <li key={n} className="flex items-center gap-2 text-muted-foreground text-sm">
                              <Check className="w-4 h-4 text-orange-600 dark:text-orange-400 flex-shrink-0" />
                              <span>{t(`service.special.${n}` as any)}</span>
                            </li>
                          ))}
                        </ul>
                        <Link href="/tilaus">
                          <Button variant="outline" size="sm" className="text-orange-600 border-orange-300 hover:bg-orange-50 dark:text-orange-400 dark:border-orange-800 dark:hover:bg-orange-900/20">
                            {t("service.special.cta")}
                            <ArrowRight className="w-4 h-4 ml-1" />
                          </Button>
                        </Link>
                      </div>
                    </div>
                  </Card>

                  {/* Maalaus */}
                  <Card className="p-6 md:p-8 bg-card border-0 premium-shadow" data-testid="service-painting">
                    <div className="flex items-start gap-4">
                      <div className="w-12 h-12 rounded-xl bg-yellow-100 dark:bg-yellow-900/30 flex items-center justify-center flex-shrink-0">
                        <PaintBucket className="w-6 h-6 text-yellow-700 dark:text-yellow-400" />
                      </div>
                      <div className="flex-1">
                        <h2 className="text-xl font-semibold text-foreground mb-2">{t("service.painting.title")}</h2>
                        <p className="text-muted-foreground mb-3">{t("service.painting.desc")}</p>
                        <ul className="space-y-2 mb-4">
                          {(["1","2","3"] as const).map(n => (
                            <li key={n} className="flex items-center gap-2 text-muted-foreground text-sm">
                              <Check className="w-4 h-4 text-yellow-700 dark:text-yellow-400 flex-shrink-0" />
                              <span>{t(`service.painting.${n}` as any)}</span>
                            </li>
                          ))}
                        </ul>
                        <Link href="/tilaus">
                          <Button variant="outline" size="sm" className="text-yellow-700 border-yellow-300 hover:bg-yellow-50 dark:text-yellow-400 dark:border-yellow-800 dark:hover:bg-yellow-900/20">
                            {t("service.painting.4" as any)}
                            <ArrowRight className="w-4 h-4 ml-1" />
                          </Button>
                        </Link>
                      </div>
                    </div>
                  </Card>

                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Packages */}
        <div className="mb-12">
          <h2 className="text-2xl font-semibold text-foreground mb-2 text-center">{t("packages.title")}</h2>
          <p className="text-muted-foreground text-center mb-6">
            <Badge variant="outline" className="mr-2">{t("packages.coming")}</Badge>
            {t("packages.note")}
          </p>
          <div className="grid md:grid-cols-3 gap-4">
            <Card className="p-5 bg-card border-0 premium-shadow opacity-80" data-testid="package-single">
              <h3 className="font-semibold text-foreground mb-2">{t("package.single.title")}</h3>
              <p className="text-sm text-muted-foreground">{t("package.single.desc")}</p>
            </Card>
            <Card className="p-5 bg-card border-0 premium-shadow opacity-80" data-testid="package-recurring">
              <h3 className="font-semibold text-foreground mb-2">{t("package.recurring.title")}</h3>
              <p className="text-sm text-muted-foreground">{t("package.recurring.desc")}</p>
            </Card>
            <Card className="p-5 bg-card border-0 premium-shadow opacity-80" data-testid="package-kiilto">
              <div className="flex items-center gap-2 mb-2">
                <h3 className="font-semibold text-foreground">{t("package.kiilto.title")}</h3>
                <Badge variant="outline" className="text-xs">{t("packages.coming")}</Badge>
              </div>
              <p className="text-sm text-muted-foreground">{t("package.kiilto.desc")}</p>
            </Card>
          </div>
        </div>

        {/* CTA */}
        <div className="text-center">
          <Link href="/tilaus">
            <Button size="lg" data-testid="services-cta">
              {t("hero.cta")}
              <ArrowRight className="w-5 h-5 ml-2" />
            </Button>
          </Link>
          <p className="text-xs text-muted-foreground mt-4">
            Kaikki työmme tehdään vastuuvakuutuksen alaisena.{" "}
            <Link href="/ehdot">
              <span className="underline underline-offset-2 hover:text-foreground transition-colors cursor-pointer">Lue sopimusehdot</span>
            </Link>
          </p>
        </div>
      </div>

      {/* ── Service detail popup ── */}
      <AnimatePresence>
        {active && (
          <motion.div
            className="fixed inset-0 z-[80] flex items-end md:items-center justify-center md:p-6"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            onClick={() => setActiveService(null)}
          >
            <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
            <motion.div
              className="relative w-full md:max-w-[480px] max-h-[92dvh] rounded-t-2xl md:rounded-2xl bg-card shadow-2xl overflow-hidden flex flex-col"
              initial={{ y: 48, opacity: 0, scale: 0.98 }}
              animate={{ y: 0, opacity: 1, scale: 1 }}
              exit={{ y: 48, opacity: 0, scale: 0.98 }}
              transition={{ type: "spring", stiffness: 300, damping: 30 }}
              onClick={e => e.stopPropagation()}
            >
              {/* Media: video for windows, photo for others */}
              <div className="relative aspect-video flex-shrink-0">
                {active.videoSrc ? (
                  <video
                    autoPlay
                    muted
                    loop
                    playsInline
                    className="w-full h-full object-cover"
                    poster={active.photo}
                  >
                    <source src={active.videoSrc} type="video/mp4" />
                    <source src={active.videoSrc} type="video/quicktime" />
                  </video>
                ) : (
                  <img
                    src={active.photo}
                    alt={t(active.titleKey as any)}
                    className="w-full h-full object-cover"
                  />
                )}
                <div className="absolute inset-0 bg-gradient-to-t from-black/30 to-transparent pointer-events-none" />
                <button
                  onClick={() => setActiveService(null)}
                  className="absolute top-3 right-3 w-8 h-8 rounded-full bg-black/50 backdrop-blur-sm flex items-center justify-center text-white hover:bg-black/70 transition-colors"
                  aria-label="Sulje"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Content */}
              <div className="flex-1 overflow-y-auto p-5 space-y-3">
                <h2 className="text-xl font-semibold text-foreground">{t(active.titleKey as any)}</h2>
                <p className="text-muted-foreground text-sm leading-relaxed">
                  {t(active.popupDescKey as any)}
                </p>
                <ul className="space-y-2 pt-1">
                  {active.bullets.map(bulletKey => (
                    <li key={bulletKey} className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Check className="w-4 h-4 text-primary flex-shrink-0" />
                      <span>{t(bulletKey as any)}</span>
                    </li>
                  ))}
                </ul>
              </div>

              {/* CTA */}
              <div className="p-5 border-t border-border flex-shrink-0">
                <Link href="/tilaus" onClick={() => setActiveService(null)}>
                  <Button className="w-full">
                    {t("hero.cta")}
                    <ArrowRight className="w-4 h-4 ml-2" />
                  </Button>
                </Link>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
