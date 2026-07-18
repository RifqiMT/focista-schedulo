import type { ReactNode } from "react";

const LINKEDIN_URL = "https://www.linkedin.com/in/rifqi-tjahjono/";
const WEBSITE_URL = "https://rifqi-tjahyono.com/";
const ARTICLE_URL =
  "https://rifqi-tjahyono.com/%f0%9f%93%9d-to-do-list-avalanche-to-dashboard-zen-tame-task-chaos-without-the-app-circus-%f0%9f%8e%af%f0%9f%a7%a0/";
const GITHUB_URL = "https://github.com/RifqiMT/focista-schedulo";

function LinkedInIcon() {
  return (
    <svg viewBox="0 0 24 24" focusable="false" aria-hidden="true">
      <path d="M6.94 8.5H3.75V20.25h3.19V8.5zM5.35 3.75a1.85 1.85 0 1 0 0 3.7 1.85 1.85 0 0 0 0-3.7zM20.25 20.25h-3.19v-6.14c0-1.46-.03-3.34-2.03-3.34-2.04 0-2.35 1.59-2.35 3.23v6.25H9.5V8.5h3.06v1.61h.04c.43-.81 1.47-1.66 3.02-1.66 3.23 0 3.83 2.13 3.83 4.9v6.9z" />
    </svg>
  );
}

function WebsiteIcon() {
  return (
    <svg viewBox="0 0 24 24" focusable="false" aria-hidden="true">
      <circle cx="12" cy="12" r="8.25" />
      <path d="M3.75 12h16.5M12 3.75c2.4 2.55 3.6 5.4 3.6 8.25s-1.2 5.7-3.6 8.25M12 3.75C9.6 6.3 8.4 9.15 8.4 12s1.2 5.7 3.6 8.25" />
    </svg>
  );
}

function ArticleIcon() {
  return (
    <svg viewBox="0 0 24 24" focusable="false" aria-hidden="true">
      <path d="M7 4.75h7.5L17.25 7.5V19.25H7z" />
      <path d="M14.25 4.75V7.5h2.75" />
      <path d="M9.25 11h5.5M9.25 14h5.5M9.25 17h3.25" />
    </svg>
  );
}

function GitHubIcon() {
  return (
    <svg viewBox="0 0 24 24" focusable="false" aria-hidden="true">
      <path d="M12 2.75c-5.1 0-9.25 4.15-9.25 9.25 0 4.09 2.65 7.55 6.32 8.77.46.09.63-.2.63-.44v-1.55c-2.57.56-3.11-1.24-3.11-1.24-.42-1.07-1.03-1.35-1.03-1.35-.84-.58.06-.57.06-.57.93.07 1.42.96 1.42.96.83 1.42 2.18 1.01 2.71.77.08-.6.32-1.01.59-1.24-2.05-.23-4.21-1.03-4.21-4.57 0-1.01.36-1.84.95-2.49-.1-.23-.41-1.18.09-2.46 0 0 .78-.25 2.55.95a8.86 8.86 0 0 1 4.64 0c1.77-1.2 2.55-.95 2.55-.95.5 1.28.19 2.23.09 2.46.59.65.95 1.48.95 2.49 0 3.55-2.16 4.33-4.22 4.56.33.29.63.85.63 1.71v2.54c0 .24.17.54.64.44A9.26 9.26 0 0 0 21.25 12c0-5.1-4.15-9.25-9.25-9.25z" />
    </svg>
  );
}

type FooterLink = {
  href: string;
  label: string;
  icon: "fill" | "stroke";
  children: ReactNode;
};

const FOOTER_LINKS: FooterLink[] = [
  {
    href: LINKEDIN_URL,
    label: "Rifqi Tjahyono on LinkedIn",
    icon: "fill",
    children: <LinkedInIcon />
  },
  {
    href: WEBSITE_URL,
    label: "Rifqi Tjahyono personal website",
    icon: "stroke",
    children: <WebsiteIcon />
  },
  {
    href: ARTICLE_URL,
    label: "Read: To-Do List Avalanche to Dashboard Zen",
    icon: "stroke",
    children: <ArticleIcon />
  },
  {
    href: GITHUB_URL,
    label: "Focista Schedulo on GitHub",
    icon: "fill",
    children: <GitHubIcon />
  }
];

export function AppFooter() {
  return (
    <footer className="app-footer" role="contentinfo">
      <div className="app-footer-inner">
        <p className="app-footer-credit">
          Developed, managed, and maintained by{" "}
          <span className="app-footer-name">Rifqi Tjahyono</span>
        </p>
        <nav className="app-footer-links" aria-label="Creator links">
          {FOOTER_LINKS.map((link) => (
            <a
              key={link.href}
              className={`app-footer-link app-footer-link--${link.icon}`}
              href={link.href}
              target="_blank"
              rel="noopener noreferrer"
              title={link.label}
              aria-label={link.label}
            >
              {link.children}
            </a>
          ))}
        </nav>
      </div>
    </footer>
  );
}
