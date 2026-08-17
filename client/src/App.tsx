import { Switch, Route, useLocation } from "wouter";
import { trackPageView } from "@/lib/track";
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
import { lazyRetry, isStaleBuildError, recoverFromStaleBuild } from "@/lib/stale-build";

type ErrorBoundaryProps = {
  children: ReactNode;
  /** Muuttuessaan nollaa virhetilan. Reitin osoite: yhden rikkinäisen sivun ei
   *  pidä jättää koko sovellusta jumiin, joten esim. takaisin-painike toipuu. */
  resetKey?: string;
};

class ErrorBoundary extends Component<ErrorBoundaryProps, { error: Error | null; healing: boolean; reloading: boolean }> {
  /** Jos uudelleenlataus ei ehdi tapahtua, näytä virhe — ei ikuista latausta. */
  private healTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { error: null, healing: false, reloading: false };
  }
  static getDerivedStateFromError(error: Error) {
    // Vanhentunut build ei ole sovellusvirhe vaan merkki siitä että käsissä on
    // eilisen versio (uusi julkaisu poisti vanhat koodipalaset). Se korjaantuu
    // itsestään, joten näytetään lataus eikä virhettä.
    return { error, healing: isStaleBuildError(error) };
  }
  componentDidCatch(err: Error, info: ErrorInfo) {
    // Diagnostiikka konsoliin: ilman tätä virheen alkuperä katosi kokonaan eikä
    // vikaa voinut jäljittää etänä.
    // eslint-disable-next-line no-console
    console.error("[ErrorBoundary]", err, info?.componentStack);
    if (!isStaleBuildError(err)) return;
    if (!recoverFromStaleBuild()) {
      // Uudelleenlataus tehtiin juuri eikä auttanut — näytä virhe normaalisti,
      // ettei käyttäjä jää tyhjän latausruudun kanssa jumiin.
      this.setState({ healing: false });
      return;
    }
    this.healTimer = setTimeout(() => this.setState({ healing: false }), 6000);
  }
  componentDidUpdate(prev: ErrorBoundaryProps) {
    // Reitti vaihtui (esim. takaisin-painike) → yritä uudelleen puhtaalta
    // pöydältä. Latautuvaa korjausta ei keskeytetä.
    if (this.state.error && !this.state.healing && prev.resetKey !== this.props.resetKey) {
      this.setState({ error: null, healing: false, reloading: false });
    }
  }
  componentWillUnmount() {
    if (this.healTimer) clearTimeout(this.healTimer);
  }
  render() {
    if (this.state.error) {
      if (this.state.healing) {
        return (
          <div style={{ padding: 32, fontFamily: "sans-serif", textAlign: "center" }}>
            <p style={{ color: "#888" }}>Päivitetään uuteen versioon…</p>
          </div>
        );
      }
      return (
        <div style={{ padding: 32, fontFamily: "sans-serif", textAlign: "center" }}>
          <p style={{ marginBottom: 16, color: "#888" }}>Jotain meni pieleen.</p>
          <p style={{ fontSize: 12, color: "#aaa", marginBottom: 24, wordBreak: "break-all" }}>
            {this.state.error.message}
          </p>
          {/* Tyhjennä välimuisti ennen latausta: pelkkä reload tarjoili ennen
              saman rikkinäisen palasen uudelleen. Siivous kestää jopa 1,5 s,
              joten nappi kuittaa painalluksen heti — muuten se näyttää
              reagoimattomalta ja tulee painetuksi monta kertaa. */}
          <button
            disabled={this.state.reloading}
            onClick={() => { this.setState({ reloading: true }); recoverFromStaleBuild(true); }}
            style={{ padding: "12px 24px", minHeight: 44, background: "#2d5016", color: "#fff", border: "none", borderRadius: 8, fontSize: 16, opacity: this.state.reloading ? 0.6 : 1 }}
          >
            {this.state.reloading ? "Päivitetään…" : "Lataa uudelleen"}
          </button>
          {/* Varapoistumistie: jos yksi sivu on rikki, etusivulle pääsee aina. */}
          <p style={{ marginTop: 16 }}>
            <a href="/" style={{ fontSize: 13, color: "#888" }}>Etusivulle</a>
          </p>
        </div>
      );
    }
    return this.props.children;
  }
}

/** ErrorBoundary joka nollautuu reitinvaihdossa. */
function RouteErrorBoundary({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>;
}

// Routes are code-split (React.lazy): a visitor on the public site never
// downloads the admin ERP bundle, and each heavy page loads on demand. This
// keeps the initial paint fast and the app feeling instant. Suspense fallbacks
// live below the nav (see layouts + ProtectedRoute) so navigation never flashes
// the chrome.
const LandingPage = lazy(lazyRetry(() => import("@/pages/landing")));
const ServicesPage = lazy(lazyRetry(() => import("@/pages/services")));
const FAQPage = lazy(lazyRetry(() => import("@/pages/faq")));
const AboutPage = lazy(lazyRetry(() => import("@/pages/about")));
const BookingPage = lazy(lazyRetry(() => import("@/pages/booking")));
const ConfirmationPage = lazy(lazyRetry(() => import("@/pages/confirmation")));
const EhdotPage = lazy(lazyRetry(() => import("@/pages/ehdot")));
const TietosuojaPage = lazy(lazyRetry(() => import("@/pages/tietosuoja")));
const LaskuriPage = lazy(lazyRetry(() => import("@/pages/laskuri")));
const AdminLoginPage = lazy(lazyRetry(() => import("@/pages/admin/login")));
const AdminDashboard = lazy(lazyRetry(() => import("@/pages/admin/dashboard")));
const AdminNewJobPage = lazy(lazyRetry(() => import("@/pages/admin/new-job")));
const AdminNewGigPage = lazy(lazyRetry(() => import("@/pages/admin/new-gig")));
const AdminWelcomePage = lazy(lazyRetry(() => import("@/pages/admin/welcome")));
const AdminGigTrackerPage = lazy(lazyRetry(() => import("@/pages/admin/gig-tracker")));
const AdminProjectPage = lazy(lazyRetry(() => import("@/pages/admin/project")));
const GigLivePage = lazy(lazyRetry(() => import("@/pages/gig-live")));
const WorkerPage = lazy(lazyRetry(() => import("@/pages/worker")));
const AdminCrewPage = lazy(lazyRetry(() => import("@/pages/admin/crew")));
const AdminCalendarPage = lazy(lazyRetry(() => import("@/pages/admin/calendar")));
const AdminJobsPage = lazy(lazyRetry(() => import("@/pages/admin/jobs")));
const AdminGigsPage = lazy(lazyRetry(() => import("@/pages/admin/gigs")));
const AdminSellPage = lazy(lazyRetry(() => import("@/pages/admin/sell")));
const AdminLeadTriagePage = lazy(lazyRetry(() => import("@/pages/admin/lead-triage")));
const AdminPackagesPage = lazy(lazyRetry(() => import("@/pages/admin/packages")));
const AdminSettingsPage = lazy(lazyRetry(() => import("@/pages/admin/settings")));
const AdminCustomersPage = lazy(lazyRetry(() => import("@/pages/admin/customers")));
const AdminQuotesPage = lazy(lazyRetry(() => import("@/pages/admin/quotes")));
const AdminGuidePage = lazy(lazyRetry(() => import("@/pages/admin/guide")));
const AdminTaxExportPage = lazy(lazyRetry(() => import("@/pages/admin/tax-export")));
const AdminWorkerDetailPage = lazy(lazyRetry(() => import("@/pages/admin/worker-detail")));
const AdminInvestmentsPage = lazy(lazyRetry(() => import("@/pages/admin/investments")));
const AdminInboxPage = lazy(lazyRetry(() => import("@/pages/admin/inbox")));
const QuotePage = lazy(lazyRetry(() => import("@/pages/quote")));
const ITPage = lazy(lazyRetry(() => import("@/pages/it")));
const CVDemoPage = lazy(lazyRetry(() => import("@/pages/cv-demo")));
const RecruitmentPage = lazy(lazyRetry(() => import("@/pages/recruitment")));
const NotFound = lazy(lazyRetry(() => import("@/pages/not-found")));

function ScrollToTop() {
  const [location] = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [location]);
  return null;
}

/**
 * Evästeetön sivunlatauksen kirjaus. Ratsastaa samalla reittimuutoksella kuin
 * ScrollToTop, koska SPA:ssa "uusi sivu" on nimenomaan reitin vaihtuminen —
 * palvelin ei näe sitä lainkaan. Ks. lib/track.ts: ei evästeitä, ei
 * tunnistetta selaimeen, ja Do Not Track estää mittauksen kokonaan.
 */
function TrackPageViews() {
  const [location] = useLocation();
  useEffect(() => { trackPageView(location); }, [location]);
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
      {/* Urakkakeikkojen hakemisto. Ennen `/admin/gig/:id`-reittejä, jotta
          kirjaimellinen "gigs" ei voi joutua tulkituksi keikan id:ksi. */}
      <Route path="/admin/gigs">
        <ProtectedRoute>
          <AdminGigsPage />
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
              <RouteErrorBoundary>
                <Toaster />
                <ScrollToTop />
                <TrackPageViews />
                <Router />
              </RouteErrorBoundary>
            </TooltipProvider>
          </I18nProvider>
        </ThemeProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}

export default App;
