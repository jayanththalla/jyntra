"use client";
import { useState } from "react";
import type { FoundEmail } from "@/lib/types";
import { emailLabel } from "@/lib/emails/labels";
import { AlertCircleIcon, CheckIcon, CopyIcon, MailIcon } from "@/components/icons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";


export function CopyButton({ text, label = "Copy email" }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label={done ? "Copied" : label}
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(text);
              setDone(true);
              setTimeout(() => setDone(false), 1200);
            } catch {}
          }}
        >
          {done ? <CheckIcon className="text-success" /> : <CopyIcon />}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{done ? "Copied" : label}</TooltipContent>
    </Tooltip>
  );
}

/** Emails found on the startup's own site. `limit` keeps cards compact. */
export function Emails({ emails, limit, checked }: { emails: FoundEmail[]; limit?: number; checked?: boolean }) {
  if (!emails.length) {
    return checked ? <p className="text-sm text-muted-foreground">No email address is published on their website.</p> : null;
  }
  const shown = limit ? emails.slice(0, limit) : emails;
  return (
    <ul className="space-y-1.5">
      {shown.map((e) => (
        <li key={e.email} className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
          <MailIcon className="text-muted-foreground" />
          <a href={`mailto:${e.email}`} className="min-w-0 font-medium break-all hover:underline">
            {e.email}
          </a>
          <Badge variant="secondary">{emailLabel(e)}</Badge>
          {e.domain_accepts_mail === true && (
            <span className="inline-flex items-center gap-1 text-xs text-success" title="The domain has mail servers (MX records), so it can receive email">
              <CheckIcon className="size-3.5" strokeWidth={2.5} />
              Receives mail
            </span>
          )}
          {e.domain_accepts_mail === false && (
            <span className="inline-flex items-center gap-1 text-xs text-destructive" title="The domain has no mail servers, so email may bounce">
              <AlertCircleIcon className="size-3.5" />
              No mail server
            </span>
          )}
          <a href={e.source_url} target="_blank" rel="noreferrer" className="text-xs text-muted-foreground underline hover:text-foreground" title="Where this email was found">
            source
          </a>
          <CopyButton text={e.email} />
        </li>
      ))}
      {limit && emails.length > limit && <li className="pl-6 text-xs text-muted-foreground">+{emails.length - limit} more on the details page</li>}
    </ul>
  );
}
