import type { ReactNode, SVGProps } from 'react';

type IconProps = SVGProps<SVGSVGElement> & { size?: number };
const base = (p: IconProps, children: ReactNode) => {
  const { size = 18, ...rest } = p;
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...rest}>
      {children}
    </svg>
  );
};

export const IconPrev = (p: IconProps) => base(p, <><path d="M6 5v14" /><path d="M19 5.5 9 12l10 6.5z" fill="currentColor" stroke="none" /></>);
export const IconNext = (p: IconProps) => base(p, <><path d="M18 5v14" /><path d="M5 5.5 15 12 5 18.5z" fill="currentColor" stroke="none" /></>);
export const IconPlay = (p: IconProps) => base(p, <path d="M7 4.8v14.4L19 12z" fill="currentColor" stroke="none" />);
export const IconPause = (p: IconProps) => base(p, <><rect x="6" y="5" width="4" height="14" rx="1" fill="currentColor" stroke="none" /><rect x="14" y="5" width="4" height="14" rx="1" fill="currentColor" stroke="none" /></>);
export const IconRestart = (p: IconProps) => base(p, <><path d="M4 12a8 8 0 1 0 2.6-5.9" /><path d="M4 4v4.6h4.6" /></>);
export const IconLabels = (p: IconProps) => base(p, <><path d="M3.5 12.2V5.5h6.7l9.3 9.3-6.7 6.7z" /><circle cx="8" cy="9.8" r="1.2" fill="currentColor" stroke="none" /></>);
export const IconPath = (p: IconProps) => base(p, <><path d="M3 18 9 7l5 9 7-12" /><circle cx="9" cy="7" r="1.6" fill="currentColor" stroke="none" /><circle cx="14" cy="16" r="1.6" fill="currentColor" stroke="none" /></>);
export const IconFlask = (p: IconProps) => base(p, <><path d="M9.5 3.5h5" /><path d="M10.5 3.5v6L5 18.8a1.8 1.8 0 0 0 1.6 2.7h10.8a1.8 1.8 0 0 0 1.6-2.7L13.5 9.5v-6" /><path d="M8 15h8" /></>);
export const IconPanel = (p: IconProps) => base(p, <><rect x="3.5" y="4.5" width="17" height="15" rx="2" /><path d="M14.5 4.5v15" /></>);
export const IconClose = (p: IconProps) => base(p, <><path d="M6 6l12 12M18 6 6 18" /></>);
export const IconChevron = (p: IconProps & { up?: boolean }) => {
  const { up, ...rest } = p;
  return base(rest, <path d={up ? 'M6 14.5 12 8.5l6 6' : 'M6 9.5l6 6 6-6'} />);
};
export const IconTarget = (p: IconProps) => base(p, <><circle cx="12" cy="12" r="7.5" /><circle cx="12" cy="12" r="2.2" fill="currentColor" stroke="none" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3" /></>);
export const IconExpand = (p: IconProps) => base(p, <><path d="M14 4h6v6M10 20H4v-6M20 4l-7 7M4 20l7-7" /></>);
export const IconGear = (p: IconProps) => base(p, <><circle cx="12" cy="12" r="3" /><path d="M12 3v2.5M12 18.5V21M3 12h2.5M18.5 12H21M5.6 5.6l1.8 1.8M16.6 16.6l1.8 1.8M18.4 5.6l-1.8 1.8M7.4 16.6l-1.8 1.8" /></>);

/** Small logo: a collector arc focusing rays onto a point. */
export function Logo() {
  return (
    <svg width="26" height="26" viewBox="0 0 32 32" fill="none" aria-hidden="true">
      <circle cx="16" cy="16" r="14.5" stroke="#314564" />
      <path d="M6 7.5c6 3 6 14 0 17" stroke="#9db8ff" strokeWidth="2" strokeLinecap="round" />
      <path d="M9 11.5 24 16M9 20.5 24 16M9 16h15" stroke="#3fe0ff" strokeWidth="1.4" strokeLinecap="round" />
      <circle cx="24" cy="16" r="2.6" fill="#e56bff" />
    </svg>
  );
}
