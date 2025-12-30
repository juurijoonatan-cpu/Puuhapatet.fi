import { Link, useLocation } from "wouter";
import { Home, ClipboardList, Info, Lock, Sun, Moon } from "lucide-react";
import { useTheme } from "@/lib/theme";
import { cn } from "@/lib/utils";

interface NavItem {
  icon: typeof Home;
  label: string;
  href: string;
  isAdmin?: boolean;
}

const publicNavItems: NavItem[] = [
  { icon: Home, label: "Etusivu", href: "/" },
  { icon: ClipboardList, label: "Tilaus", href: "/tilaus" },
  { icon: Info, label: "Tietoja", href: "/tietoja" },
  { icon: Lock, label: "Admin", href: "/admin/login", isAdmin: true },
];

export function LiquidGlassNav() {
  const [location] = useLocation();
  const { theme, toggleTheme } = useTheme();

  return (
    <>
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
                  aria-label={item.label}
                  aria-current={isActive ? "page" : undefined}
                  data-testid={`nav-${item.label.toLowerCase()}`}
                >
                  <Icon className="w-6 h-6" strokeWidth={isActive ? 2.5 : 2} />
                </button>
              </Link>
            );
          })}
          
          <button
            onClick={toggleTheme}
            className="flex items-center justify-center w-12 h-12 rounded-2xl text-muted-foreground transition-all duration-200"
            aria-label={theme === "light" ? "Vaihda tummaan tilaan" : "Vaihda vaaleaan tilaan"}
            data-testid="nav-theme-toggle"
          >
            {theme === "light" ? (
              <Moon className="w-5 h-5" />
            ) : (
              <Sun className="w-5 h-5" />
            )}
          </button>
        </div>
      </nav>

      <header className="hidden md:flex fixed top-0 left-0 right-0 z-50 glass-nav border-b border-transparent">
        <div className="container mx-auto px-6 h-16 flex items-center justify-between">
          <Link href="/">
            <span className="text-xl font-semibold text-foreground tracking-tight cursor-pointer" data-testid="logo-text">
              Puuhapatet
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
                    data-testid={`nav-desktop-${item.label.toLowerCase()}`}
                  >
                    <Icon className="w-4 h-4" />
                    <span className="text-sm font-medium">{item.label}</span>
                  </button>
                </Link>
              );
            })}
            
            <button
              onClick={toggleTheme}
              className="flex items-center justify-center w-10 h-10 rounded-xl text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-all duration-200 ml-2"
              aria-label={theme === "light" ? "Vaihda tummaan tilaan" : "Vaihda vaaleaan tilaan"}
              data-testid="nav-desktop-theme-toggle"
            >
              {theme === "light" ? (
                <Moon className="w-4 h-4" />
              ) : (
                <Sun className="w-4 h-4" />
              )}
            </button>
          </nav>
        </div>
      </header>
    </>
  );
}
