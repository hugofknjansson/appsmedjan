export function Logo({ small = false }: { small?: boolean }) {
  return (
    <span className={small ? 'logo small' : 'logo'}>
      <svg viewBox="0 0 32 32" aria-hidden="true">
        <rect width="32" height="32" rx="8" fill="var(--accent)" />
        <path d="M9 13h10l4-4v6h-3v3h-3v8h-4v-8H9z" fill="#fff" />
      </svg>
      <span>Appsmedjan</span>
    </span>
  );
}
