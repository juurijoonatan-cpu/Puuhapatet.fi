import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/lib/theme";
import { I18nProvider } from "@/lib/i18n";
import { LiquidGlassNav } from "@/components/liquid-glass-nav";
import { ProtectedRoute, ProfileSetupRoute } from "@/components/protected-route";

import LandingPage from "@/pages/landing";
import ServicesPage from "@/pages/services";
import FAQPage from "@/pages/faq";
import AboutPage from "@/pages/about";
import BookingPage from "@/pages/booking";
import ConfirmationPage from "@/pages/confirmation";
import EhdotPage from "@/pages/ehdot";
import TietosuojaPage from "@/pages/tietosuoja";
import AdminLoginPage from "@/pages/admin/login";
import AdminProfileSetup from "@/pages/admin/profile-setup";
import AdminDashboard from "@/pages/admin/dashboard";
import AdminNewJobPage from "@/pages/admin/new-job";
import AdminCalendarPage from "@/pages/admin/calendar";
import AdminJobsPage from "@/pages/admin/jobs";
import AdminPackagesPage from "@/pages/admin/packages";
import AdminSettingsPage from "@/pages/admin/settings";
import NotFound from "@/pages/not-found";

function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <LiquidGlassNav />
      {children}
    </>
  );
}

function Router() {
  return (
    <Switch>
      <Route path="/">
        <PublicLayout>
          <LandingPage />
        </PublicLayout>
      </Route>
      <Route path="/palvelut">
        <PublicLayout>
          <ServicesPage />
        </PublicLayout>
      </Route>
      <Route path="/ukk">
        <PublicLayout>
          <FAQPage />
        </PublicLayout>
      </Route>
      <Route path="/meista">
        <PublicLayout>
          <AboutPage />
        </PublicLayout>
      </Route>
      <Route path="/tilaus">
        <PublicLayout>
          <BookingPage />
        </PublicLayout>
      </Route>
      <Route path="/kiitos">
        <PublicLayout>
          <ConfirmationPage />
        </PublicLayout>
      </Route>
      <Route path="/ehdot">
        <PublicLayout>
          <EhdotPage />
        </PublicLayout>
      </Route>
      <Route path="/tietosuoja">
        <PublicLayout>
          <TietosuojaPage />
        </PublicLayout>
      </Route>
      
      <Route path="/admin/login" component={AdminLoginPage} />
      
      <Route path="/admin/profile-setup">
        <ProfileSetupRoute>
          <AdminProfileSetup />
        </ProfileSetupRoute>
      </Route>

      <Route path="/admin/dashboard">
        <ProtectedRoute>
          <AdminDashboard />
        </ProtectedRoute>
      </Route>
      <Route path="/admin/new">
        <ProtectedRoute>
          <AdminNewJobPage />
        </ProtectedRoute>
      </Route>
      <Route path="/admin/calendar">
        <ProtectedRoute>
          <AdminCalendarPage />
        </ProtectedRoute>
      </Route>
      <Route path="/admin/jobs">
        <ProtectedRoute>
          <AdminJobsPage />
        </ProtectedRoute>
      </Route>
      <Route path="/admin/packages">
        <ProtectedRoute>
          <AdminPackagesPage />
        </ProtectedRoute>
      </Route>
      <Route path="/admin/settings">
        <ProtectedRoute>
          <AdminSettingsPage />
        </ProtectedRoute>
      </Route>
      <Route path="/admin">
        <ProtectedRoute>
          <AdminDashboard />
        </ProtectedRoute>
      </Route>
      
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <I18nProvider>
          <TooltipProvider>
            <Toaster />
            <Router />
          </TooltipProvider>
        </I18nProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

export default App;
