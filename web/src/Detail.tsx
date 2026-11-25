// What Apple said, word for word, when it turned something down: kept out of the way behind a press,
// since it is in Apple's own English and full of its own words, but there for whoever wants it.
import { t } from './i18n';

export function Detail({ text }: { text: string | undefined }) {
  if (!text?.trim()) return null;
  return (
    <details className="detail">
      <summary>{t.showDetails}</summary>
      <span>{text}</span>
    </details>
  );
}
