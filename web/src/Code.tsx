// The app's source, for the people who are shown everything: the files the builder has written, to
// read, copy and take away as an Xcode project. Nothing is changed from here; the builder does that.
import { useEffect, useMemo, useState } from 'react';
import type { PublishState } from '../../shared/protocol';
import { ApiError, api } from './api';
import { Waiting } from './Waiting';
import { apiErrorText, t } from './i18n';

interface Props {
  id: string;
  /** Changes when the builder has changed a file, which is a reason to read them again. */
  version: number;
  publish: PublishState;
}

export function Code({ id, version, publish }: Props) {
  const [files, setFiles] = useState<Record<string, string> | null>(null);
  const [bundleId, setBundleId] = useState('');
  const [chosen, setChosen] = useState('');
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const text = t.level;

  useEffect(() => {
    let gone = false;
    api
      .files(id)
      .then((loaded) => {
        if (gone) return;
        setFiles(loaded.files);
        setBundleId(loaded.bundleId ?? '');
        setError('');
      })
      .catch((err) => {
        if (!gone) setError(apiErrorText(err instanceof ApiError ? err.code : 'internal'));
      });
    return () => {
      gone = true;
    };
  }, [id, version]);

  const paths = useMemo(() => Object.keys(files ?? {}).sort((a, b) => a.localeCompare(b)), [files]);
  // The file that was open stays open; a file that is gone gives way to the app's starting point.
  const open = files && chosen in files ? chosen : (paths.find((path) => path.endsWith('App.swift')) ?? paths[0] ?? '');
  const lines = useMemo(() => Object.values(files ?? {}).reduce((sum, content) => sum + content.split('\n').length, 0), [files]);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1600);
    return () => clearTimeout(timer);
  }, [copied]);

  if (error && !files) {
    return (
      <p className="form-error" role="alert">
        {error}
      </p>
    );
  }
  if (!files) return <Waiting />;
  const content = files[open] ?? '';
  return (
    <div className="code">
      <header className="code-head">
        <div>
          <p className="muted fine">{text.codeHelp}</p>
          <dl className="code-facts">
            <dt>{text.bundleId}</dt>
            <dd>
              <code>{bundleId}</code>
            </dd>
            {publish.build && (
              <>
                <dt>{text.latestBuild}</dt>
                <dd>
                  <code>{publish.build}</code>
                </dd>
              </>
            )}
            <dt>{text.files}</dt>
            <dd>{text.codeCount.replace('{files}', String(paths.length)).replace('{lines}', String(lines))}</dd>
          </dl>
        </div>
        <a className="btn" href={`/api/projects/${id}/source.zip`} download>
          {text.download}
        </a>
      </header>
      <div className="code-body">
        <nav className="code-files" aria-label={text.files}>
          {paths.map((path) => (
            <button key={path} aria-current={path === open || undefined} onClick={() => setChosen(path)}>
              {path.replace(/^Sources\//, '')}
            </button>
          ))}
        </nav>
        <div className="code-file">
          <div className="code-file-head">
            <code>{open}</code>
            <button
              className="link"
              onClick={() => {
                void navigator.clipboard?.writeText(content).then(() => setCopied(true));
              }}
            >
              {copied ? text.copied : text.copy}
            </button>
          </div>
          <pre tabIndex={0}>
            <code>{content}</code>
          </pre>
        </div>
      </div>
    </div>
  );
}
