import type React from "react";
export function SiteFooter(): React.JSX.Element {
  return (
    <footer className="site-footer">
      <h2>Support</h2>
      <p>
        Please contact me at{" "}
        <a href="mailto:stefan.church@gmail.com">stefan.church@gmail.com</a> if you have any issues or questions.
      </p>
      <p className="footer-links">
        <a href="./privacy-policy.html">Privacy Policy</a>
      </p>
    </footer>
  );
}
