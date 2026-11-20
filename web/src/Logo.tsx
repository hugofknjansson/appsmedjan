export function Logo({ small = false }: { small?: boolean }) {
  return (
    <span className={small ? 'logo small' : 'logo'}>
      <svg viewBox="0 0 32 32" aria-hidden="true">
        <rect width="32" height="32" rx="8" fill="var(--accent)" />
        {/* An app tile mid-step. The same drawing as the iOS icon in scripts/ios-icon.swift. */}
        <g fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21.5 12.5 27.4 7.2M11 13.5 5.8 15.6 6.6 11.2M13.4 18 12.6 22.6 13.4 27.2H10.6M18 18.5 20.8 23.2 25.8 21.8" />
        </g>
        <g transform="translate(16 12.5) rotate(10)">
          <rect x="-6.5" y="-6.5" width="13" height="13" rx="3.6" fill="#fff" />
          <rect x="-3.05" y="-2.4" width="1.5" height="3" rx="0.75" fill="var(--accent)" />
          <rect x="1.55" y="-2.4" width="1.5" height="3" rx="0.75" fill="var(--accent)" />
        </g>
      </svg>
      <span>App Dance</span>
    </span>
  );
}
