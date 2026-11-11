// Layout for the plain text pages linked from Settings (About, Privacy, Terms, Contact).
import type { ReactNode } from "react";
import { PageHeader } from "./PageHeader";

export function InfoPage({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  return (
    <article className="mx-auto max-w-3xl space-y-8">
      <PageHeader title={title} subtitle={subtitle} />
      <div className="space-y-7 text-[15px] leading-relaxed text-foreground/85">{children}</div>
    </article>
  );
}

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-2">
      <h2 className="text-lg font-semibold text-foreground">{title}</h2>
      {children}
    </section>
  );
}

export function Bullets({ children }: { children: ReactNode }) {
  return <ul className="list-disc space-y-1.5 pl-5">{children}</ul>;
}

export const textLink = "font-medium text-primary underline-offset-2 hover:underline";
