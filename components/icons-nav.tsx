// Jyntra's own navigation icons: 24px, rounded geometry, one outline and one filled state per icon.
// The same component draws both: a stroke width of 2 or more (what the nav passes for the active item) switches to the filled state,
// so no call site needs a second icon. Original artwork, no third-party paths.
import type { SVGProps } from "react";
import type { IconComponent } from "@/components/icons";

type P = SVGProps<SVGSVGElement> & { size?: number | string; strokeWidth?: number | string };

function build(shapes: (f: { fill: string; fo: number }) => React.ReactNode, name: string): IconComponent {
  const Icon = ({ size = 16, strokeWidth = 1.8, className, ...rest }: P) => {
    const filled = Number(strokeWidth) >= 2;
    const f = { fill: filled ? "currentColor" : "none", fo: filled ? 0.2 : 0 };
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={filled ? 1.9 : 1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={className} data-icon={name} {...rest}>
        {shapes(f)}
      </svg>
    );
  };
  return Icon as unknown as IconComponent;
}

export const HomeNavIcon = build(({ fill, fo }) => (<>
  <rect x="3.5" y="3.5" width="7" height="7" rx="2" fill={fill} fillOpacity={fo} /><rect x="13.5" y="3.5" width="7" height="7" rx="2" fill={fill} fillOpacity={fo} />
  <rect x="3.5" y="13.5" width="7" height="7" rx="2" fill={fill} fillOpacity={fo} /><rect x="13.5" y="13.5" width="7" height="7" rx="2" fill={fill} fillOpacity={fo} />
</>), "home");

export const DiscoverNavIcon = build(({ fill, fo }) => (<>
  <circle cx="11" cy="11" r="6.5" fill={fill} fillOpacity={fo} /><path d="M16 16l4.5 4.5" />
</>), "discover");

export const AtlasNavIcon = build(({ fill, fo }) => (<>
  <path d="M12 3c.7 4.6 2.4 6.3 7 7-4.6.7-6.3 2.4-7 7-.7-4.6-2.4-6.3-7-7 4.6-.7 6.3-2.4 7-7z" fill={fill} fillOpacity={fo} /><path d="M19 17v4M17 19h4" />
</>), "atlas");

export const InterviewNavIcon = build(({ fill, fo }) => (<>
  <rect x="9" y="3" width="6" height="11" rx="3" fill={fill} fillOpacity={fo} /><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21M9 21h6" />
</>), "interview");

export const OpenSourceNavIcon = build(() => (<>
  <path d="M8 7l-5 5 5 5M16 7l5 5-5 5M13.5 5l-3 14" />
</>), "oss");

export const NewsNavIcon = build(({ fill, fo }) => (<>
  <rect x="4" y="4" width="16" height="16" rx="3.5" fill={fill} fillOpacity={fo} /><path d="M8 9h8M8 12.5h8M8 16h5" />
</>), "news");

export const ProfileNavIcon = build(({ fill, fo }) => (<>
  <circle cx="12" cy="8" r="4" fill={fill} fillOpacity={fo} /><path d="M4.5 20.5c.6-3.8 3.6-6 7.5-6s6.9 2.2 7.5 6" fill={fill} fillOpacity={fo} />
</>), "profile");
