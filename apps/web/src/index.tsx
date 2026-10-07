import { logoMarkup, PALETTES } from '@reilai/brand';
import { translate } from '@reilai/i18n';
import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';

import './index.css';
import { App, Svg } from './shell/App';
import { checkToken, Connection, readToken, saveToken } from './shell/connection';
import { applyShellTheme, attachConnection, currentLang, installCopyCleanup, setLangPref, themeState } from './shell/lynx';
import { installTooltips } from './shell/tooltip';

applyShellTheme();
installTooltips();
installCopyCleanup();

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}

function Login({ onToken }: { onToken: (token: string) => void }) {
  const lang = currentLang();
  const [value, setValue] = useState('');
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    const ok = await checkToken(value.trim());
    setBusy(false);
    if (ok) onToken(value.trim());
    else setError(true);
  };
  return (
    <div className="login">
      <div className="login-card">
        <div className="placeholder-art">
          <Svg markup={logoMarkup(PALETTES[themeState().effective].primary)} size={46} />
        </div>
        <h1>{translate(lang, 'login.title')}</h1>
        <p>{translate(lang, 'login.body')}</p>
        <input
          autoFocus
          placeholder={translate(lang, 'login.token')}
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            setError(false);
          }}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
        />
        {error && <div className="login-error">{translate(lang, 'login.invalid')}</div>}
        <button type="button" className="primary-btn" disabled={!value.trim() || busy} onClick={submit}>
          {translate(lang, 'login.submit')}
        </button>
      </div>
    </div>
  );
}

function Root() {
  const [token, setToken] = useState<string | null>(() => readToken());
  const [conn, setConn] = useState<Connection | null>(null);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    if (!token) return setChecked(true);
    let cancelled = false;
    checkToken(token).then((ok) => {
      if (cancelled) return;
      if (!ok) {
        saveToken(null);
        setToken(null);
        setChecked(true);
        return;
      }
      const c = new Connection(token);
      attachConnection(c);
      c.rpc('hello', { client: 'web' }).then((r) => {
        if (!r.ok) return;
        const hello = r.result as { machine: { name: string }; settings: { language: 'en' | 'pt' | 'system' } };
        c.machine = hello.machine.name;
        setLangPref(hello.settings.language);
        document.title = `ReilAI · ${hello.machine.name}`;
      });
      setConn(c);
      setChecked(true);
    });
    return () => {
      cancelled = true;
    };
  }, [token]);

  if (!checked) return null;
  if (!token || !conn) {
    return (
      <Login
        onToken={(t) => {
          saveToken(t);
          setChecked(false);
          setToken(t);
        }}
      />
    );
  }
  return (
    <App
      conn={conn}
      onLogout={() => {
        saveToken(null);
        location.href = '/';
      }}
    />
  );
}

const el =
  document.getElementById('root') ??
  document.body.appendChild(Object.assign(document.createElement('div'), { id: 'root' }));
createRoot(el).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
