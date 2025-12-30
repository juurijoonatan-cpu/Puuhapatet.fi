import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { isAdminAuthenticated } from "@/pages/admin/login";
import { AdminNav } from "./admin-nav";
import { PageLoadingSkeleton } from "./loading-skeleton";

interface ProtectedRouteProps {
  children: React.ReactNode;
}

export function ProtectedRoute({ children }: ProtectedRouteProps) {
  const [, navigate] = useLocation();
  const [isChecking, setIsChecking] = useState(true);
  const [isAuthenticated, setIsAuthenticated] = useState(false);

  useEffect(() => {
    const checkAuth = () => {
      const authenticated = isAdminAuthenticated();
      setIsAuthenticated(authenticated);
      setIsChecking(false);
      
      if (!authenticated) {
        navigate("/admin/login");
      }
    };

    checkAuth();
  }, [navigate]);

  if (isChecking) {
    return <PageLoadingSkeleton />;
  }

  if (!isAuthenticated) {
    return null;
  }

  return (
    <>
      <AdminNav />
      {children}
    </>
  );
}
