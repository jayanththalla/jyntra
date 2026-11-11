import type { Metadata } from "next";
import Link from "next/link";
import { Bullets, InfoPage, Section, textLink } from "@/components/InfoPage";
import { CONTACT } from "@/components/info-links";
import { settings } from "@/config/settings";

export const metadata: Metadata = {
  title: "About",
  description: "What Jyntra does and where its data comes from.",
};

export default function AboutPage() {
  return (
    <InfoPage title="About Jyntra" subtitle="Find startups that are hiring people like you, with the reason for every match.">
      <Section title="What it does">
        <p>
          Jyntra looks for recently funded startups and their open jobs, then scores every job against your profile: role, skills,
          location and experience. You see which jobs fit, why, and where to apply. It also tracks your applications and drafts
          outreach you review before anything is sent.
        </p>
      </Section>

      <Section title="What you see">
        <Bullets>
          <li>Startups funded in the last {Math.round(settings.addFundedWithinDays / 30)} months, plus every Y Combinator batch of this year.</li>
          <li>Jobs posted in the last {settings.newJobDays} days are shown by default; older roles that are still listed can be found by widening the filter. Listings with no posting date are labelled, never called new.</li>
          <li>Funding amounts and dates only as a source reported them. YC dates are marked as estimates.</li>
          <li>Contact emails only when a company publishes them on its own website.</li>
        </Bullets>
      </Section>

      <Section title="Where the data comes from">
        <Bullets>
          <li>The Y Combinator company directory and YC company pages.</li>
          <li>Funding news: Inc42, Economic Times, Entrackr, YourStory, TechCrunch and Crunchbase News.</li>
          <li>Company websites and careers pages, and the Himalayas remote-jobs board.</li>
        </Bullets>
        <p>
          Jyntra reads public pages only, respects robots.txt and waits between requests to the same site. It never invents jobs,
          funding or contact details.
        </p>
      </Section>

      <Section title="Open source">
        <p>
          Jyntra is built on the open-source Startup Finder project (MIT license).{" "}
          <a href={CONTACT.repo} target="_blank" rel="noreferrer" className={textLink}>
            See the original on GitHub
          </a>
          .{" "}
          <Link href="/contact" className={textLink}>
            Contact
          </Link>
        </p>
      </Section>
    </InfoPage>
  );
}
