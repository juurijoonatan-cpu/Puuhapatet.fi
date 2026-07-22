import { Switch, Route, useLocation } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/lib/theme";
import { I18nProvider } from "@/lib/i18n";
import { LiquidGlassNav } from "@/components/liquid-glass-nav";
import { ProtectedRoute } from "@/components/protected-route";
import { ChatWidget } from "@/components/chat-widget";
import { FreeAssessmentPrompt } from "@/components/free-assessment-prompt";
import { PageLoadingSkeleton } from "@/components/loading-skeleton";
import { useEffect, Component, lazy, Suspense } from "react";
import type { ReactNode, ErrorInfo } from "react";

class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidCatch(_err: Error, _info: ErrorInfo) {}
  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: 32, fontFamily: "sans-serif", textAlign: "center" }}>
          <p style={{ marginBottom: 16, color: "#888" }}>Jotain meni pieleen.</p>
          <p style={{ fontSize: 12, color: "#aaa", marginBottom: 24, wordBreak: "break-all" }}>
            {this.state.error.message}
          </p>
          <button
            onClick={() => window.location.reload()}
            style={{ padding: "10px 24px", background: "#2d5016", color: "#fff", border: "none", borderRadius: 8, fontSize: 16 }}
          >
            Lataa uudelleen
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

// Routes are code-split (React.lazy): a visitor on the public site never
// downloads the admin ERP bundle, and each heavy page loads on demand. This
// keeps the initial paint fast and the app feeling instant. Suspense fallbacks
// live below the nav (see layouts + ProtectedRoute) so navigation never flashes
// the chrome.
const LandingPage = lazy(() => import("@/pages/landing"));
const ServicesPage = lazy(() => import("@/pages/services"));
const FAQPage = lazy(() => import("@/pages/faq"));
const AboutPage = lazy(() => import("@/pages/about"));
const BookingPage = lazy(() => import("@/pages/booking"));
const ConfirmationPage = lazy(() => import("@/pages/confirmation"));
const EhdotPage = lazy(() => import("@/pages/ehdot"));
const TietosuojaPage = lazy(() => import("@/pages/tietosuoja"));
const LaskuriPage = lazy(() => import("@/pages/laskuri"));
const AdminLoginPage = lazy(() => import("@/pages/admin/login"));
const AdminDashboard = lazy(() => import("@/pages/admin/dashboard"));
const AdminNewJobPage = lazy(() => import("@/pages/admin/new-job"));
const AdminNewGigPage = lazy(() => import("@/pages/admin/new-gig"));
const AdminWelcomePage = lazy(() => import("@/pages/admin/welcome"));
const AdminGigTrackerPage = lazy(() => import("@/pages/admin/gig-tracker"));
const AdminProjectPage = lazy(() => import("@/pages/admin/project"));
const GigLivePage = lazy(() => import("@/pages/gig-live"));
const WorkerPage = lazy(() => import("@/pages/worker"));
const AdminCrewPage = lazy(() => import("@/pages/admin/crew"));
const AdminCalendarPage = lazy(() => import("@/pages/admin/calendar"));
const AdminJobsPage = lazy(() => import("@/pages/admin/jobs"));
const AdminSellPage = lazy(() => import("@/pages/admin/sell"));
const AdminLeadTriagePage = lazy(() => import("@/pages/admin/lead-triage"));
const AdminPackagesPage = lazy(() => import("@/pages/admin/packages"));
const AdminSettingsPage = lazy(() => import("@/pages/admin/settings"));
const AdminCustomersPage = lazy(() => import("@/pages/admin/customers"));
const AdminQuotesPage = lazy(() => import("@/pages/admin/quotes"));
const AdminGuidePage = lazy(() => import("@/pages/admin/guide"));
const AdminTaxExportPage = lazy(() => import("@/pages/admin/tax-export"));
const AdminWorkerDetailPage = lazy(() => import("@/pages/admin/worker-detail"));
const AdminInvestmentsPage = lazy(() => import("@/pages/admin/investments"));
const AdminInboxPage = lazy(() => import("@/pages/admin/inbox"));
const QuotePage = lazy(() => import("@/pages/quote"));
const ITPage = lazy(() => import("@/pages/it"));
const CVDemoPage = lazy(() => import("@/pages/cv-demo"));
const RecruitmentPage = lazy(() => import("@/pages/recruitment"));
const NotFound = lazy(() => import("@/pages/not-found"));

function ScrollToTop() {
  const [location] = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [location]);
  return null;
}

function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <LiquidGlassNav />
      {/* Suspense sits below the nav so a lazy page load never flashes the chrome. */}
      <Suspense fallback={<PageLoadingSkeleton />}>{children}</Suspense>
      <ChatWidget />
      <FreeAssessmentPrompt />
    </>
  );
}

/** Recruitment landing: site nav for findability, but no chat widget so the
    single WhatsApp call-to-action stays unmistakable. */
function RecruitmentLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <LiquidGlassNav />
      <Suspense fallback={<PageLoadingSkeleton />}>{children}</Suspense>
    </>
  );
}

function Router() {
  return (
    // Outer boundary catches the standalone routes below that render without a
    // layout (they have no nav to flash). Layout- and admin-wrapped routes have
    // their own inner Suspense so their chrome stays put during a lazy load.
    <Suspense fallback={<PageLoadingSkeleton />}>
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
      <Route path="/laskuri">
        <PublicLayout>
          <LaskuriPage />
        </PublicLayout>
      </Route>
      
      <Route path="/toihin">
        <RecruitmentLayout>
          <RecruitmentPage />
        </RecruitmentLayout>
      </Route>
      <Route path="/rekry">
        <RecruitmentLayout>
          <RecruitmentPage />
        </RecruitmentLayout>
      </Route>

      <Route path="/it" component={ITPage} />
      <Route path="/cv" component={CVDemoPage} />

      <Route path="/tarjous/:token" component={QuotePage} />
      <Route path="/seuranta/:token" component={GigLivePage} />
      <Route path="/tyo/:token" component={WorkerPage} />

      <Route path="/admin/login" component={AdminLoginPage} />

      <Route path="/admin/tervetuloa">
        <ProtectedRoute bare gateAgreement={false}>
          <AdminWelcomePage />
        </ProtectedRoute>
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
      <Route path="/admin/new-gig">
        <ProtectedRoute>
          <AdminNewGigPage />
        </ProtectedRoute>
      </Route>
      <Route path="/admin/gig/:id/projekti">
        <ProtectedRoute bare>
          <AdminProjectPage />
        </ProtectedRoute>
      </Route>
      <Route path="/admin/gig/:id/tiimi">
        <ProtectedRoute>
          <AdminCrewPage />
        </ProtectedRoute>
      </Route>
      <Route path="/admin/gig/:id">
        <ProtectedRoute>
          <AdminGigTrackerPage />
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
      <Route path="/admin/myynti">
        <ProtectedRoute bare gateAgreement={false}>
          <AdminSellPage />
        </ProtectedRoute>
      </Route>
      <Route path="/admin/liidit">
        <ProtectedRoute>
          <AdminLeadTriagePage />
        </ProtectedRoute>
      </Route>
      <Route path="/admin/packages">
        <ProtectedRoute>
          <AdminPackagesPage />
        </ProtectedRoute>
      </Route>
      <Route path="/admin/customers">
        <ProtectedRoute>
          <AdminCustomersPage />
        </ProtectedRoute>
      </Route>
      <Route path="/admin/quotes">
        <ProtectedRoute>
          <AdminQuotesPage />
        </ProtectedRoute>
      </Route>
      <Route path="/admin/settings">
        <ProtectedRoute>
          <AdminSettingsPage />
        </ProtectedRoute>
      </Route>
      <Route path="/admin/guide">
        <ProtectedRoute>
          <AdminGuidePage />
        </ProtectedRoute>
      </Route>
      {/* /admin/talous is the current URL; /admin/tax-export kept as an alias
          so old bookmarks/links keep working. */}
      <Route path="/admin/talous">
        <ProtectedRoute>
          <AdminTaxExportPage />
        </ProtectedRoute>
      </Route>
      <Route path="/admin/tax-export">
        <ProtectedRoute>
          <AdminTaxExportPage />
        </ProtectedRoute>
      </Route>
      <Route path="/admin/tiimi/:workerId">
        <ProtectedRoute>
          <AdminWorkerDetailPage />
        </ProtectedRoute>
      </Route>
      <Route path="/admin/investments">
        <ProtectedRoute>
          <AdminInvestmentsPage />
        </ProtectedRoute>
      </Route>
      <Route path="/admin/inbox">
        <ProtectedRoute>
          <AdminInboxPage />
        </ProtectedRoute>
      </Route>
      <Route path="/admin">
        <ProtectedRoute>
          <AdminDashboard />
        </ProtectedRoute>
      </Route>
      
      <Route component={NotFound} />
    </Switch>
    </Suspense>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <ThemeProvider>
          <I18nProvider>
            <TooltipProvider>
              <ErrorBoundary>
                <Toaster />
                <ScrollToTop />
                <Router />
              </ErrorBoundary>
            </TooltipProvider>
          </I18nProvider>
        </ThemeProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}

export default App;
