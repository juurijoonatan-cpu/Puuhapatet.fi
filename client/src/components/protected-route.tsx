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
import { PageLoadingSkeleton } from "./loading-skeleton";

interface ProtectedRouteProps {
  children: React.ReactNode;
  requireProfile?: boolean;
}

export function ProtectedRoute({ children, requireProfile = true }: ProtectedRouteProps) {
  const [, navigate] = useLocation();
  const [authState, setAuthState] = useState<"checking" | "unauthenticated" | "no-profile" | "ready">("checking");

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
        const complete = isProfileComplete(profile);
        
        if (!complete) {
          setAuthState("no-profile");
          navigate("/admin/profile-setup", { replace: true });
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

  if (authState === "unauthenticated" || authState === "no-profile") {
    return <PageLoadingSkeleton />;
  }

  return (
    <>
      <AdminNav />
      {children}
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
