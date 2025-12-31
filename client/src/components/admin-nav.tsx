/**
 * Admin Navigation
 * 
 * Liquid glass bottom nav for mobile, header nav for desktop.
 * Items: Dashboard, Uusi (New Job), Kalenteri, Keikat, Asetukset
 */

import { Link, useLocation } from "wouter";
import { LayoutDashboard, Plus, Calendar, ClipboardList, Settings, Sun, Moon, LogOut } from "lucide-react";
import { useTheme } from "@/lib/theme";
import { clearAdminSession } from "@/pages/admin/login";
import { clearAdminProfile, getAdminProfile } from "@/lib/admin-profile";
import { cn } from "@/lib/utils";

interface NavItem {
  icon: typeof LayoutDashboard;
  label: string;
  href: string;
}

const adminNavItems: NavItem[] = [
  { icon: LayoutDashboard, label: "Dashboard", href: "/admin/dashboard" },
  { icon: Plus, label: "Uusi", href: "/admin/new" },
  { icon: Calendar, label: "Kalenteri", href: "/admin/calendar" },
  { icon: ClipboardList, label: "Keikat", href: "/admin/jobs" },
  { icon: Settings, label: "Asetukset", href: "/admin/settings" },
];

export function AdminNav() {
  const [location, navigate] = useLocation();
  const { theme, toggleTheme } = useTheme();
  
  const currentPath = location || "";
  const profile = typeof window !== "undefined" ? getAdminProfile() : null;

  const handleLogout = () => {
    clearAdminSession();
    clearAdminProfile();
    navigate("/admin/login");
  };

  const isActive = (href: string) => {
    if (!currentPath) return false;
    if (href === "/admin/dashboard") {
      return currentPath === "/admin/dashboard" || currentPath === "/admin";
    }
    return currentPath === href || currentPath.startsWith(href + "/");
  };

  return (
    <>
      <header className="fixed top-0 left-0 right-0 z-50 glass-nav md:hidden">
        <div className="flex items-center justify-center h-14 px-4">
          <span className="text-lg font-semibold text-foreground tracking-tight">
            Puuhapatet <span className="text-muted-foreground font-normal text-sm">Admin</span>
          </span>
        </div>
      </header>

      <nav 
        className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 glass-nav rounded-[20px] px-2 py-2 md:hidden"
        role="navigation"
        aria-label="Admin-valikko"
      >
        <div className="flex items-center gap-1">
          {adminNavItems.map((item) => {
            const active = isActive(item.href);
            const Icon = item.icon;
            
            return (
              <Link key={item.href} href={item.href}>
                <button
                  className={cn(
                    "flex items-center justify-center w-12 h-12 rounded-2xl transition-all duration-200",
                    active 
                      ? "text-primary scale-105" 
                      : "text-muted-foreground"
                  )}
                  aria-label={item.label}
                  aria-current={active ? "page" : undefined}
                  data-testid={`admin-nav-${item.label.toLowerCase()}`}
                >
                  <Icon className="w-6 h-6" strokeWidth={active ? 2.5 : 2} />
                </button>
              </Link>
            );
          })}
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
              const active = isActive(item.href);
              const Icon = item.icon;
              
              return (
                <Link key={item.href} href={item.href}>
                  <button
                    className={cn(
                      "flex items-center gap-2 px-4 py-2 rounded-xl transition-all duration-200",
                      active 
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

            {profile?.photoUrl && (
              <Link href="/admin/settings">
                <img 
                  src={profile.photoUrl} 
                  alt={profile.name}
                  className="w-8 h-8 rounded-full object-cover ml-2 cursor-pointer"
                  data-testid="admin-nav-profile-photo"
                />
              </Link>
            )}
            
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
