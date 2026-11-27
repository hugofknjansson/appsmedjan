// What Apple said, word for word, when it turned something down: kept out of the way behind a press,
// since it is in Apple's own English and full of its own words, but there for whoever wants it. The
// people who are shown more than the first level have it open from the start.
import { api } from './api';
import { t } from './i18n';
import { useLevel } from './level';

export function Detail({ text }: { text: string | undefined }) {
  const level = useLevel().level;
  if (!text?.trim()) return null;
  return (
    <details
      className="detail"
      open={level >= 2 || undefined}
      onToggle={(e) => {
        // Someone who goes looking for Apple's own words may well want more of the kind.
        if (level === 1 && e.currentTarget.open) void api.levelAct('details').catch(() => undefined);
      }}
    >
      <summary>{t.showDetails}</summary>
      <span>{text}</span>
    </details>
  );
}
