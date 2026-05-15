import type React from "react";
import appStoreBadge from "../assets/app-store.png";
import playStoreBadge from "../assets/play-store.png";
import screenshotDark from "../assets/screenshot-dark.png";
import screenshotLight from "../assets/screenshot.png";

export function AppPromo(): React.JSX.Element {
  return (
    <section className="app-promo">
      <picture>
        <source media="(prefers-color-scheme: dark)" srcSet={screenshotDark} />
        <img
          className="app-promo-shot"
          src={screenshotLight}
          alt="Scottish Ferries app screenshot"
          loading="lazy"
        />
      </picture>
      <div className="app-promo-content">
        <h2>Get the App</h2>
        <p>Get notified about the latest disruptions with the app.</p>
        <div className="store-links">
          <a
            href="https://apps.apple.com/nz/app/scottish-ferries/id861271891"
            target="_blank"
            rel="noreferrer"
            aria-label="Download on the App Store"
          >
            <img src={appStoreBadge} alt="Download on the App Store" />
          </a>
          <a
            href="https://play.google.com/store/apps/details?id=com.stefanchurch.ferryservices"
            target="_blank"
            rel="noreferrer"
            aria-label="Get it on Google Play"
          >
            <img src={playStoreBadge} alt="Get it on Google Play" />
          </a>
        </div>
      </div>
    </section>
  );
}
