/**
 * Protected Route Component
 * 
 * Handles:
 * 1. Authentication check
 * 2. Profile completion gate
 * 3. Admin layout with nav
 */

import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { isAdminAuthenticated } from "@/pages/admin/login";
import { getAdminProfile, isProfileComplete } from "@/lib/admin-profile";
import { hasSignedCurrent, refreshSignatureState } from "@/lib/member-agreement";
import { api } from "@/lib/api";
import { AdminNav } from "./admin-nav";
import { AdminAssistant } from "./admin-assistant";
import { PageLoadingSkeleton } from "./loading-skeleton";

interface ProtectedRouteProps {
  children: React.ReactNode;
  requireProfile?: boolean;
  /** Render as a full-screen tool view without the admin nav chrome. */
  bare?: boolean;
  /** When true (default), members must have signed the current agreement. */
  gateAgreement?: boolean;
}

export function ProtectedRoute({ children, requireProfile = true, bare = false, gateAgreement = true }: ProtectedRouteProps) {
  const [location, navigate] = useLocation();
  const [authState, setAuthState] = useState<"checking" | "unauthenticated" | "ready">("checking");

  useEffect(() => {
    let cancelled = false;
    const checkAuth = async () => {
      if (typeof window === "undefined") {
        setAuthState("checking");
        return;
      }

      const authenticated = isAdminAuthenticated();

      if (!authenticated) {
        setAuthState("unauthenticated");
        navigate("/admin/login", { replace: true });
        return;
      }

      const profile = getAdminProfile();

      // Dashboard-only worker (e.g. Jani): never sees the admin. Bounce straight
      // to their own gig dashboard, whatever admin route they landed on.
      if (profile?.dashboardOnly) {
        const r = await api.getMyDashboard();
        if (cancelled) return;
        setAuthState("unauthenticated"); // keep the skeleton; never render admin
        navigate(r.ok && r.data?.token ? `/tyo/${r.data.token}` : "/admin/login", { replace: true });
        return;
      }

      if (requireProfile) {
        if (!isProfileComplete(profile)) {
          setAuthState("unauthenticated");
          navigate("/admin/login", { replace: true });
          return;
        }
      }

      // Member agreement gate — the first thing in the admin is signing.
      if (gateAgreement) {
        let signed = hasSignedCurrent(profile);
        if (!signed) signed = await refreshSignatureState(profile); // cross-device check
        if (cancelled) return;
        if (!signed) {
          setAuthState("unauthenticated");
          navigate("/admin/tervetuloa", { replace: true });
          return;
        }
      }

      if (!cancelled) setAuthState("ready");
    };

    checkAuth();
    return () => { cancelled = true; };
  }, [navigate, requireProfile, gateAgreement, location]);

  if (authState === "checking") {
    return <PageLoadingSkeleton />;
  }

  if (authState === "unauthenticated") {
    return <PageLoadingSkeleton />;
  }

  if (bare) {
    return <>{children}</>;
  }

  return (
    <>
      <AdminNav />
      {children}
      <AdminAssistant />
    </>
  );
}

export function ProfileSetupRoute({ children }: { children: React.ReactNode }) {
  const [, navigate] = useLocation();
  const [authState, setAuthState] = useState<"checking" | "unauthenticated" | "ready">("checking");

  useEffect(() => {
    const checkAuth = () => {
      if (typeof window === "undefined") {
        setAuthState("checking");
        return;
      }

      const authenticated = isAdminAuthenticated();
      
      if (!authenticated) {
        setAuthState("unauthenticated");
        navigate("/admin/login", { replace: true });
        return;
      }
      
      setAuthState("ready");
    };

    checkAuth();
  }, [navigate]);

  if (authState !== "ready") {
    return <PageLoadingSkeleton />;
  }

  return <>{children}</>;
}
