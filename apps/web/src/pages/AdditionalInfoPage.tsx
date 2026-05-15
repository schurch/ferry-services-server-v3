import type React from "react";
import { Navigate, useLocation } from "react-router-dom";
import { AppPromo } from "../components/AppPromo";
import { SiteFooter } from "../components/SiteFooter";
import { SiteHeading } from "../components/SiteHeading";

export function AdditionalInfoPage(): React.JSX.Element {
  const location = useLocation();
  const state = location.state as { html?: string; area?: string } | null;

  if (!state?.html) {
    return <Navigate to="/" replace />;
  }

  return (
    <main>
      <SiteHeading />
      <div className="content-with-promo">
        <div className="primary-content">
          <div className="header">
            <h1 className="title">{state.area ? `${state.area} Info` : "Service Info"}</h1>
          </div>
          <section className="panel">
            <div dangerouslySetInnerHTML={{ __html: state.html }} />
          </section>
        </div>
        <aside className="promo-column">
          <AppPromo />
        </aside>
      </div>
      <SiteFooter />
    </main>
  );
}
