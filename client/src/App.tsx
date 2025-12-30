import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/lib/theme";
import { LiquidGlassNav } from "@/components/liquid-glass-nav";
import { ProtectedRoute } from "@/components/protected-route";

import LandingPage from "@/pages/landing";
import BookingPage from "@/pages/booking";
import ConfirmationPage from "@/pages/confirmation";
import AboutPage from "@/pages/about";
import AdminLoginPage from "@/pages/admin/login";
import AdminDashboard from "@/pages/admin/dashboard";
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
      <Route path="/tietoja">
        <PublicLayout>
          <AboutPage />
        </PublicLayout>
      </Route>
      
      <Route path="/admin/login" component={AdminLoginPage} />
      
      <Route path="/admin/dashboard">
        <ProtectedRoute>
          <AdminDashboard />
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
        <TooltipProvider>
          <Toaster />
          <Router />
        </TooltipProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

export default App;
