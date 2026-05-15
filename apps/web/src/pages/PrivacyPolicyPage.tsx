import type React from "react";
import { AppPromo } from "../components/AppPromo";
import { SiteFooter } from "../components/SiteFooter";
import { SiteHeading } from "../components/SiteHeading";

export function PrivacyPolicyPage(): React.JSX.Element {
  return (
    <main>
      <SiteHeading />
      <div className="content-with-promo">
        <div className="primary-content">
          <article className="panel policy">
            <header className="policy-header">
              <p className="policy-kicker">Effective date: April 27, 2026</p>
              <h1>Privacy Policy</h1>
              <p>
                This Privacy Policy explains how Scottish Ferries handles information in the iOS, Android, and web
                versions of the app.
              </p>
            </header>

            <section>
              <h2>Overview</h2>
              <p>
                Scottish Ferries provides ferry service information and does not require user accounts, names, email
                addresses, payment details, or location access to use the app.
              </p>
              <p>
                We do not sell personal information, use advertising trackers, or use app data for cross-app or
                cross-site tracking.
              </p>
            </section>

            <section>
              <h2>Information We Collect</h2>
              <p>
                We do not collect personal information such as your name, email address, phone number, contacts,
                photos, payment information, or precise location.
              </p>
              <p>
                The app may request ferry service data from our servers so that it can show current routes, schedules,
                disruption details, and related operational information. These requests are used to provide the app's
                core functionality.
              </p>
            </section>

            <section>
              <h2>Crash and Diagnostic Data</h2>
              <p>
                The native iOS and Android apps use Sentry, a third-party crash reporting and monitoring service, to
                help us identify and fix errors. If the app encounters a crash or technical issue, Sentry may receive
                diagnostic information such as:
              </p>
              <ul>
                <li>Crash logs and stack traces</li>
                <li>Device type and operating system version</li>
                <li>App version</li>
                <li>Error timestamps and general diagnostic information</li>
              </ul>
              <p>
                This diagnostic information is used only to improve app stability, performance, and reliability. It is
                not used to identify you personally, track you across apps or websites, or serve advertising.
              </p>
            </section>

            <section>
              <h2>How We Use Information</h2>
              <p>Information handled by the app is used to:</p>
              <ul>
                <li>Provide ferry service information and app functionality</li>
                <li>Identify and fix bugs</li>
                <li>Improve app stability and performance</li>
                <li>Protect the reliability and security of the service</li>
              </ul>
            </section>

            <section>
              <h2>Data Sharing</h2>
              <p>
                Crash and diagnostic data may be shared with Sentry for the purposes described in this policy. Sentry
                processes this data as a service provider. You can read Sentry's privacy policy at{" "}
                <a href="https://sentry.io/privacy/" target="_blank" rel="noreferrer">
                  https://sentry.io/privacy/
                </a>
                .
              </p>
              <p>We do not sell your data or share it with advertisers or data brokers.</p>
            </section>

            <section>
              <h2>Data Storage, Retention, and Deletion</h2>
              <p>
                We do not store personal user account data because the app does not provide user accounts. Crash and
                diagnostic data may be retained by Sentry for a limited period so we can investigate and resolve issues.
              </p>
              <p>
                If you contact us about a privacy request, we will respond using the contact details you provide and
                delete any support correspondence when it is no longer needed.
              </p>
            </section>

            <section>
              <h2>Security</h2>
              <p>
                Data transmitted by the app is sent using standard HTTPS encryption in transit. We limit third-party
                sharing to the service providers needed to operate and maintain the app.
              </p>
            </section>

            <section>
              <h2>Your Choices and Rights</h2>
              <p>
                Because Scottish Ferries does not require accounts or collect personal profile information, there is
                generally no account data to access, modify, or delete. You can stop future diagnostic data collection
                by uninstalling the app.
              </p>
              <p>
                If you have a privacy question or request, contact us at{" "}
                <a href="mailto:stefan.church@gmail.com">stefan.church@gmail.com</a>.
              </p>
            </section>

            <section>
              <h2>Children's Privacy</h2>
              <p>
                Scottish Ferries is a general audience app and is not directed at children. We do not knowingly collect
                personal information from children.
              </p>
            </section>

            <section>
              <h2>Changes to This Policy</h2>
              <p>
                We may update this Privacy Policy from time to time. Changes will be posted on this page with an
                updated effective date.
              </p>
            </section>

            <section>
              <h2>Contact</h2>
              <p>
                Developer: Stefan Church
                <br />
                Privacy contact: <a href="mailto:stefan.church@gmail.com">stefan.church@gmail.com</a>
              </p>
            </section>
          </article>
        </div>
        <aside className="promo-column">
          <AppPromo />
        </aside>
      </div>
      <SiteFooter />
    </main>
  );
}
