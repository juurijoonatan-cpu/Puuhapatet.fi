import { Link, useLocation } from "wouter";
import { Home, Grid3X3, HelpCircle, Users } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";

interface NavItem {
  icon: typeof Home;
  labelKey: string;
  href: string;
}

const publicNavItems: NavItem[] = [
  { icon: Home, labelKey: "nav.home", href: "/" },
  { icon: Grid3X3, labelKey: "nav.services", href: "/palvelut" },
  { icon: HelpCircle, labelKey: "nav.faq", href: "/ukk" },
  { icon: Users, labelKey: "nav.about", href: "/meista" },
];

export function LiquidGlassNav() {
  const [location] = useLocation();
  const { lang, toggleLang, t } = useI18n();

  return (
    <>
      <header className="fixed top-0 left-0 right-0 z-50 glass-nav md:hidden">
        <div className="flex items-center justify-center h-14 px-4">
          <Link href="/">
            <span className="text-lg font-semibold text-foreground tracking-tight cursor-pointer" data-testid="logo-text-mobile">
              Puuhapatet.
            </span>
          </Link>
        </div>
      </header>

      <nav 
        className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 glass-nav rounded-[20px] px-2 py-2 md:hidden"
        role="navigation"
        aria-label="Päävalikko"
      >
        <div className="flex items-center gap-1">
          {publicNavItems.map((item) => {
            const isActive = location === item.href || 
              (item.href !== "/" && location.startsWith(item.href));
            const Icon = item.icon;
            
            return (
              <Link key={item.href} href={item.href}>
                <button
                  className={cn(
                    "flex items-center justify-center w-12 h-12 rounded-2xl transition-all duration-200",
                    isActive 
                      ? "text-primary scale-105" 
                      : "text-muted-foreground"
                  )}
                  aria-label={t(item.labelKey)}
                  aria-current={isActive ? "page" : undefined}
                  data-testid={`nav-${item.labelKey}`}
                >
                  <Icon className="w-6 h-6" strokeWidth={isActive ? 2.5 : 2} />
                </button>
              </Link>
            );
          })}
          
          <button
            onClick={toggleLang}
            className="flex items-center justify-center w-12 h-12 rounded-2xl text-muted-foreground transition-all duration-200 font-medium text-sm"
            aria-label={lang === "fi" ? "Switch to English" : "Vaihda suomeksi"}
            data-testid="nav-lang-toggle"
          >
            {lang.toUpperCase()}
          </button>
        </div>
      </nav>

      <header className="hidden md:flex fixed top-0 left-0 right-0 z-50 glass-nav border-b border-transparent">
        <div className="container mx-auto px-6 h-16 flex items-center justify-between">
          <Link href="/">
            <span className="text-xl font-semibold text-foreground tracking-tight cursor-pointer" data-testid="logo-text">
              Puuhapatet.
            </span>
          </Link>
          
          <nav className="flex items-center gap-1" role="navigation" aria-label="Päävalikko">
            {publicNavItems.map((item) => {
              const isActive = location === item.href || 
                (item.href !== "/" && location.startsWith(item.href));
              const Icon = item.icon;
              
              return (
                <Link key={item.href} href={item.href}>
                  <button
                    className={cn(
                      "flex items-center gap-2 px-4 py-2 rounded-xl transition-all duration-200",
                      isActive 
                        ? "text-primary bg-primary/5" 
                        : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                    )}
                    data-testid={`nav-desktop-${item.labelKey}`}
                  >
                    <Icon className="w-4 h-4" />
                    <span className="text-sm font-medium">{t(item.labelKey)}</span>
                  </button>
                </Link>
              );
            })}
            
            <button
              onClick={toggleLang}
              className="flex items-center justify-center px-4 py-2 rounded-xl text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-all duration-200 ml-2 font-medium text-sm"
              aria-label={lang === "fi" ? "Switch to English" : "Vaihda suomeksi"}
              data-testid="nav-desktop-lang-toggle"
            >
              {lang.toUpperCase()}
            </button>
          </nav>
        </div>
      </header>
    </>
  );
}
