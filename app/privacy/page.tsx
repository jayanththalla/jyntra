import type { Metadata } from "next";
import { Bullets, InfoPage, Section } from "@/components/InfoPage";

export const metadata: Metadata = { title: "Privacy", description: "What Jyntra stores, what it doesn't, and who processes it." };

export default function PrivacyPage() {
  return (
    <InfoPage title="Privacy" subtitle="Last updated October 2026">
      <Section title="In short">
        <p>
          There are no accounts and no passwords. Jyntra stores the profile you give it so it can match jobs to you. It doesn&apos;t
          use ads or tracking, and it doesn&apos;t sell your data.
        </p>
      </Section>

      <Section title="What is stored">
        <Bullets>
          <li>
            <b>Your profile:</b> skills, target roles, experience, preferred locations and startup types, optional links (GitHub,
            LinkedIn, portfolio), a short bio and your name if you add it.
          </li>
          <li>
            <b>Your tracking:</b> startups and jobs you save, application statuses and notes, pins, and outreach drafts and messages
            you record.
          </li>
          <li>
            <b>A login cookie</b> (<code>sf_uid</code>): a random token that links this browser to your profile. Page scripts can&apos;t
            read it. The database keeps only a one-way hash of it, and signing out deletes that session on the server.
          </li>
          <li>
            <b>Browser storage</b> on your device only: your theme, sidebar state and similar preferences.
          </li>
        </Bullets>
      </Section>

      <Section title="Gmail app password (optional)">
        <p>
          If you add a Gmail address and app password so Jyntra can send emails you confirm, the password is kept in your profile
          record in the database <b>as plain text</b> and is never sent back to your browser. Use a dedicated app password, not your
          account password, and remove it on My Profile when you no longer need it.
        </p>
      </Section>

      <Section title="Your resume">
        <p>
          If you upload a resume, the PDF is read in memory to suggest skills and roles, then discarded. The file is never saved.
          Only what you confirm becomes part of your profile.
        </p>
      </Section>

      <Section title="Your private link">
        <p>
          Your private link carries its own random token, separate from your login cookie, and the database keeps only a hash of it.
          Anyone with the link can open your profile, so keep it to yourself. Getting a new link on My Profile turns the old one off.
        </p>
      </Section>

      <Section title="AI outreach">
        <p>
          When you ask for an outreach draft, the startup&apos;s public details and the relevant parts of your profile are sent to the
          configured AI provider (Groq or Google Gemini) to write the draft. Don&apos;t put anything in your profile you wouldn&apos;t want
          processed that way.
        </p>
      </Section>

      <Section title="Rate limiting">
        <p>Your IP address is kept briefly in memory to limit how often requests can be made. It isn&apos;t written to the database.</p>
      </Section>

      <Section title="Where data is hosted">
        <p>The database is PostgreSQL (hosted on Neon, or wherever the operator of this deployment runs it).</p>
      </Section>

      <Section title="Company information">
        <p>
          Startup details, founder names and LinkedIn profiles come from public sources such as Y Combinator company pages. Company
          emails are shown only when the company publishes them on its own website.
        </p>
      </Section>

      <Section title="Deleting your data">
        <p>
          Signing out removes the cookie and the session. To have your profile and tracking deleted from the database, ask the operator
          of this deployment (see the Contact page).
        </p>
      </Section>
    </InfoPage>
  );
}
