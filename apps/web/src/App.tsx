import type React from "react";
import { useEffect, useState } from "react";
import { HashRouter, Navigate, Route, Routes } from "react-router-dom";
import { AdditionalInfoPage } from "./pages/AdditionalInfoPage";
import { PrivacyPolicyPage } from "./pages/PrivacyPolicyPage";
import { ServiceDetailsPage } from "./pages/ServiceDetailsPage";
import { ServicesPage } from "./pages/ServicesPage";

export function App(): React.JSX.Element {
  const [systemPrefersDark, setSystemPrefersDark] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return window.matchMedia("(prefers-color-scheme: dark)").matches;
  });

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = (event: MediaQueryListEvent) => setSystemPrefersDark(event.matches);
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    const resolvedTheme = systemPrefersDark ? "dark" : "light";
    document.documentElement.setAttribute("data-theme", resolvedTheme);
  }, [systemPrefersDark]);

  return (
    <HashRouter>
      <Routes>
        <Route path="/" element={<ServicesPage />} />
        <Route path="/privacy-policy" element={<PrivacyPolicyPage />} />
        <Route path="/service/:id" element={<ServiceDetailsPage />} />
        <Route path="/service/:id/info" element={<AdditionalInfoPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </HashRouter>
  );
}
