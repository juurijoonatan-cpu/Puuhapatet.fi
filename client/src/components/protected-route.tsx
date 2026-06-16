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
import { AdminNav } from "./admin-nav";
import { AdminAssistant } from "./admin-assistant";
import { PageLoadingSkeleton } from "./loading-skeleton";

interface ProtectedRouteProps {
  children: React.ReactNode;
  requireProfile?: boolean;
  /** Render as a full-screen tool view without the admin nav chrome. */
  bare?: boolean;
}

export function ProtectedRoute({ children, requireProfile = true, bare = false }: ProtectedRouteProps) {
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

      if (requireProfile) {
        const profile = getAdminProfile();
        if (!isProfileComplete(profile)) {
          setAuthState("unauthenticated");
          navigate("/admin/login", { replace: true });
          return;
        }
      }
      
      setAuthState("ready");
    };

    checkAuth();
  }, [navigate, requireProfile]);

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
