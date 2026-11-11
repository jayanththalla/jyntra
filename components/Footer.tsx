import Link from "next/link";

/** Contact details. Set NEXT_PUBLIC_CONTACT_EMAIL to show an email address; without it only the repo link is shown. */
export const CONTACT = {
  email: process.env.NEXT_PUBLIC_CONTACT_EMAIL || "",
  repo: "https://github.com/SakshiGaikwad05/startup-finder",
};

export const FOOTER_LINKS = [
  { href: "/about", label: "About" },
  { href: "/privacy", label: "Privacy" },
  { href: "/terms", label: "Terms" },
  { href: "/contact", label: "Contact" },
];

/** Subtle footer at the bottom of every app page. Extra bottom padding on phones so it clears the tab bar. */
export function Footer() {
  return (
    <footer className="border-t border-border/60 pb-6 pt-5 text-xs text-muted-foreground">
      <nav aria-label="Footer" className="mx-auto flex max-w-6xl flex-wrap items-center justify-center gap-x-5 gap-y-2 px-4 sm:justify-between">
        <span>© {new Date().getFullYear()} Jyntra</span>
        <ul className="flex flex-wrap items-center gap-x-5 gap-y-2">
          {FOOTER_LINKS.map((l) => (
            <li key={l.href}>
              <Link href={l.href} className="transition-colors hover:text-foreground">
                {l.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </footer>
  );
}
