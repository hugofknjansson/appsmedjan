import { MascotBadge } from './Mascot';

/** The name people see. */
export const NAME = 'App Dance';

export function Logo({ small = false }: { small?: boolean }) {
  return (
    <span className={small ? 'logo small' : 'logo'}>
      <MascotBadge />
      <span>{NAME}</span>
    </span>
  );
}
