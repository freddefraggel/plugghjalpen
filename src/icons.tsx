const base = { fill: 'none', stroke: 'currentColor', strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true } as const;

export const BookIcon = ({ size = 22 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" strokeWidth={2} {...base}>
    <path d="M2 6s2-2 5-2 5 2 5 2v14s-2-1.5-5-1.5S2 20 2 20z" />
    <path d="M12 6s2-2 5-2 5 2 5 2v14s-2-1.5-5-1.5-5 1.5-5 1.5z" />
  </svg>
);
export const UploadIcon = () => (
  <svg width={40} height={40} viewBox="0 0 24 24" strokeWidth={1.8} {...base}>
    <path d="M12 16V4" /><path d="m6 10 6-6 6 6" /><path d="M4 20h16" />
  </svg>
);
export const CloseIcon = () => (
  <svg width={18} height={18} viewBox="0 0 24 24" strokeWidth={2} {...base}><path d="M6 6l12 12M18 6 6 18" /></svg>
);
export const CheckIcon = ({ size = 20 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" strokeWidth={2.5} {...base}><path d="M20 6 9 17l-5-5" /></svg>
);
export const CrossIcon = ({ size = 20 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" strokeWidth={2.5} {...base}><path d="M6 6l12 12M18 6 6 18" /></svg>
);
export const AlertIcon = () => (
  <svg width={20} height={20} viewBox="0 0 24 24" strokeWidth={2.5} {...base}><circle cx="12" cy="12" r="9" /><path d="M12 8v5M12 16.5v.01" /></svg>
);
export const BackIcon = () => (
  <svg width={20} height={20} viewBox="0 0 24 24" strokeWidth={2} {...base}><path d="m15 18-6-6 6-6" /></svg>
);
export const CurriculumIcon = () => (
  <svg width={20} height={20} viewBox="0 0 24 24" strokeWidth={2} style={{ flexShrink: 0, marginTop: 2 }} {...base}>
    <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V3H6.5A2.5 2.5 0 0 0 4 5.5z" />
  </svg>
);
