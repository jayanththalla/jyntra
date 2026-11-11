import type { CandidateProfile, StartupView, JobView } from "@/lib/types";

export interface OutreachContext {
  profile: CandidateProfile;
  startup: {
    name: string;
    description?: string | null;
    industry?: string | null;
    website?: string | null;
    funding_round?: string | null;
    last_funding_amount?: string | null;
  };
  job?: {
    title: string;
    skills?: string[];
  } | null;
  recipientName?: string;
  recipientEmail?: string;
}

export type OutreachStyle = "founder_pitch" | "engineering_application" | "linkedin_dm" | "follow_up";

export interface GeneratedOutreach {
  subject: string;
  body: string;
  channel: "email" | "linkedin_dm" | "twitter_dm";
}

export function generateOutreach(ctx: OutreachContext, style: OutreachStyle): GeneratedOutreach {
  const { profile, startup, job, recipientName } = ctx;

  const candidateName = profile.name || "Software Engineer";
  const targetRole = job?.title || (profile.target_roles && profile.target_roles[0]) || "Software Engineer";
  const salutation = recipientName ? `Hi ${recipientName},` : `Hi ${startup.name} team,`;

  // Links block
  const links: string[] = [];
  if (profile.github_url) links.push(`• GitHub: ${profile.github_url}`);
  if (profile.linkedin_url) links.push(`• LinkedIn: ${profile.linkedin_url}`);
  if (profile.medium_url) links.push(`• Technical Writing: ${profile.medium_url}`);
  if (profile.portfolio_url) links.push(`• Portfolio: ${profile.portfolio_url}`);
  const linksSection = links.length ? `\n\nMy work & profiles:\n${links.join("\n")}` : "";

  // Tech stack string
  const keySkills = (profile.skills || []).slice(0, 5).join(", ");
  const skillMention = keySkills ? `specializing in ${keySkills}` : "with strong hands-on experience";

  // Project highlight
  const topProject = (profile.projects || [])[0];
  const projectMention = topProject
    ? `Recently, I built ${topProject.name}${topProject.description ? ` (${topProject.description})` : ""}${topProject.link ? ` [${topProject.link}]` : ""}.`
    : "";

  // Funding mention if available
  const fundingCongrats =
    startup.last_funding_amount && startup.funding_round
      ? `Congrats on your recent ${startup.funding_round} round (${startup.last_funding_amount})! `
      : startup.funding_round
      ? `Congrats on your recent ${startup.funding_round} raise! `
      : "";

  switch (style) {
    case "founder_pitch": {
      const subject = `${targetRole} interested in ${startup.name}’s mission — ${candidateName}`;
      const body = `${salutation}

${fundingCongrats}I’ve been closely following what you’re building at ${startup.name}${startup.description ? ` around ${startup.description}` : ""}, and I love your product approach.

I am a ${targetRole} ${skillMention}. ${projectMention}

Given where ${startup.name} is heading, I'd love to contribute to your engineering velocity. I thrive in high-ownership startup environments and ship fast.
${linksSection}

Would you be open to a quick 10-minute chat this week to see if my background aligns with your engineering needs?

Best regards,
${candidateName}
${profile.personal_email || ""}`;

      return { subject, body, channel: "email" };
    }

    case "engineering_application": {
      const subject = `Application: ${targetRole} — ${candidateName}`;
      const body = `${salutation}

I am writing to express my strong interest in joining ${startup.name} as a ${targetRole}.

With ${profile.tech_experience_years || 1}+ years of engineering experience and a core focus on ${keySkills || "modern full-stack web and systems"}, I believe I can make an immediate impact on your team.

${projectMention ? `Key highlight: ${projectMention}\n` : ""}${linksSection}

I have attached my details and would welcome the opportunity to discuss how my technical skills match ${startup.name}'s roadmap.

Thank you for your time and consideration!

Sincerely,
${candidateName}
${profile.personal_email || ""}`;

      return { subject, body, channel: "email" };
    }

    case "linkedin_dm": {
      const dmSalutation = recipientName ? `Hi ${recipientName}` : `Hi`;
      const body = `${dmSalutation} — saw what you’re building at ${startup.name} and love the direction! I’m a ${targetRole} ${skillMention}.${topProject ? ` Recently shipped ${topProject.name}.` : ""} Would love to connect and see if you’re looking for engineers. ${profile.github_url || profile.portfolio_url || ""}`.trim();

      return {
        subject: `Quick connect regarding ${startup.name}`,
        body,
        channel: "linkedin_dm",
      };
    }

    case "follow_up": {
      const subject = `Following up: ${targetRole} for ${startup.name} — ${candidateName}`;
      const body = `${salutation}

I wanted to quickly bump my note from last week regarding the ${targetRole} role at ${startup.name}.

I know you're super busy scaling the team, so no worries if the timing isn't right. Just wanted to reiterate my excitement about what you are building.
${linksSection}

Either way, wishing you continued success with ${startup.name}!

Best,
${candidateName}`;

      return { subject, body, channel: "email" };
    }
  }
}
