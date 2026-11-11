/** Contact details and the plain info pages. Linked from Settings only (there is no page footer). */
export const CONTACT = {
  email: process.env.NEXT_PUBLIC_CONTACT_EMAIL || "",
  repo: "https://github.com/SakshiGaikwad05/startup-finder",
};

export const INFO_LINKS = [
  { href: "/about", label: "About" },
  { href: "/privacy", label: "Privacy" },
  { href: "/terms", label: "Terms" },
  { href: "/contact", label: "Contact" },
];
