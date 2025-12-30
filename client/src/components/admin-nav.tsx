import { Link, useLocation } from "wouter";
import { LayoutDashboard, ClipboardList, Package, Settings, Sun, Moon, LogOut } from "lucide-react";
import { useTheme } from "@/lib/theme";
import { clearAdminSession } from "@/pages/admin/login";
import { cn } from "@/lib/utils";

interface NavItem {
  icon: typeof LayoutDashboard;
  label: string;
  href: string;
}

const adminNavItems: NavItem[] = [
  { icon: LayoutDashboard, label: "Dashboard", href: "/admin/dashboard" },
  { icon: ClipboardList, label: "Tilaukset", href: "/admin/jobs" },
  { icon: Package, label: "Paketit", href: "/admin/packages" },
  { icon: Settings, label: "Asetukset", href: "/admin/settings" },
];

export function AdminNav() {
  const [location, navigate] = useLocation();
  const { theme, toggleTheme } = useTheme();

  const handleLogout = () => {
    clearAdminSession();
    navigate("/admin/login");
  };

  return (
    <>
      <nav 
        className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 glass-nav rounded-[20px] px-2 py-2 md:hidden"
        role="navigation"
        aria-label="Admin-valikko"
      >
        <div className="flex items-center gap-1">
          {adminNavItems.map((item) => {
            const isActive = location === item.href;
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
                  data-testid={`admin-nav-${item.label.toLowerCase()}`}
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
            data-testid="admin-nav-theme-toggle"
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
          <Link href="/admin/dashboard">
            <span className="text-xl font-semibold text-foreground tracking-tight cursor-pointer" data-testid="admin-logo-text">
              Puuhapatet <span className="text-muted-foreground font-normal">Admin</span>
            </span>
          </Link>
          
          <nav className="flex items-center gap-1" role="navigation" aria-label="Admin-valikko">
            {adminNavItems.map((item) => {
              const isActive = location === item.href;
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
                    data-testid={`admin-nav-desktop-${item.label.toLowerCase()}`}
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
              data-testid="admin-nav-desktop-theme-toggle"
            >
              {theme === "light" ? (
                <Moon className="w-4 h-4" />
              ) : (
                <Sun className="w-4 h-4" />
              )}
            </button>
            
            <button
              onClick={handleLogout}
              className="flex items-center justify-center w-10 h-10 rounded-xl text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-all duration-200"
              aria-label="Kirjaudu ulos"
              data-testid="admin-nav-desktop-logout"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </nav>
        </div>
      </header>
    </>
  );
}
