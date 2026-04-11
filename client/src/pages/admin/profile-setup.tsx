// Profile setup no longer needed — users are hard-coded in admin-profile.ts
import { useEffect } from "react";
import { useLocation } from "wouter";

export default function AdminProfileSetup() {
  const [, navigate] = useLocation();
  useEffect(() => { navigate("/admin/dashboard", { replace: true }); }, [navigate]);
  return null;
}
