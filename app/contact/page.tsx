import type { Metadata } from "next";
import { InfoPage, Section, textLink } from "@/components/InfoPage";
import { CONTACT } from "@/components/info-links";
import { GithubIcon, MailIcon, type IconComponent } from "@/components/icons";

export const metadata: Metadata = { title: "Contact", description: "How to report a bug, suggest a feature or request data deletion." };

function Row({ icon: Icon, label, href, text }: { icon: IconComponent; label: string; href: string; text: string }) {
  const external = href.startsWith("http");
  return (
    <li className="flex items-center gap-3 rounded-xl border border-border bg-card px-4 py-3">
      <Icon className="size-5 text-muted-foreground" />
      <span className="w-20 shrink-0 text-sm text-muted-foreground">{label}</span>
      <a href={href} {...(external ? { target: "_blank", rel: "noreferrer" } : {})} className={`${textLink} min-w-0 break-all`}>
        {text}
      </a>
    </li>
  );
}

export default function ContactPage() {
  return (
    <InfoPage title="Contact" subtitle="Questions, feedback or a data request? Get in touch.">
      <ul className="space-y-2">
        {CONTACT.email && <Row icon={MailIcon} label="Email" href={`mailto:${CONTACT.email}`} text={CONTACT.email} />}
        <Row icon={GithubIcon} label="GitHub" href={CONTACT.repo} text="Startup Finder on GitHub" />
      </ul>

      <Section title="Bugs and feature ideas">
        <p>
          The quickest way is to{" "}
          <a href={`${CONTACT.repo}/issues/new/choose`} target="_blank" rel="noreferrer" className={textLink}>
            open an issue on GitHub
          </a>
          . Please don&apos;t paste your private link in an issue: it gives access to your profile.
        </p>
      </Section>

      <Section title="Deleting your data">
        <p>
          Ask the operator of this deployment to delete your profile and tracking, and include your private link so it can be
          matched. {!CONTACT.email && "(The operator can set NEXT_PUBLIC_CONTACT_EMAIL to show an email address here.)"}
        </p>
      </Section>
    </InfoPage>
  );
}
