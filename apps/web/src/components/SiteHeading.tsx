import type React from "react";
import { Link } from "react-router-dom";

export function SiteHeading({ children }: { children?: React.ReactNode }): React.JSX.Element {
  return (
    <section className="page-intro">
      <h1 className="title">
        <Link className="title-link" to="/">
          Scottish Ferries
        </Link>
      </h1>
      <p className="page-subtitle">The latest disruption information</p>
      {children}
    </section>
  );
}
