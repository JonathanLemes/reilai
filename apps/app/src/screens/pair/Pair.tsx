import { useEffect, useInitData, useState } from '@lynx-js/react';

import { copyText } from '../../shared/host';
import { useLanguage, useLayout } from '../../shared/hooks';
import { C } from '../../shared/theme';
import { Button, Icon, Logo, Pressable } from '../../ui/kit';

/** Native-only gate: pair this phone with a computer (QR deep link or pasted link). */
export function Pair() {
  const init = useInitData();
  const { t } = useLanguage();
  const { safeTop, safeBottom } = useLayout();
  const [link, setLink] = useState(init.link ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(init.error ?? null);
  const [copied, setCopied] = useState(false);

  const connect = (value = link) => {
    const v = value.trim();
    if (!v.startsWith('reilai://pair')) {
      setError(t('pair.failed', { error: 'reilai://pair?…' }));
      return;
    }
    setBusy(true);
    setError(null);
    NativeModules.ReilHost?.pair?.(v, (result) => {
      setBusy(false);
      if (!result.ok) setError(t('pair.failed', { error: result.error ?? '?' }));
    });
  };

  // opened from the QR code (deep link): connect right away
  useEffect(() => {
    if (init.link) connect(init.link);
  }, []);

  return (
    <view className="root" style={{ paddingTop: `${safeTop + 24}px`, paddingBottom: `${safeBottom + 24}px` }}>
      <scroll-view scroll-orientation="vertical" style={{ flex: 1, width: '100%' }}>
        <view className="col" style={{ alignItems: 'center', padding: '24px 28px 0 28px' }}>
          <view className="empty-art" style={{ width: '96px', height: '96px', borderRadius: '30px' }}>
            <Logo size={50} />
          </view>
          <text className="t-title" style={{ textAlign: 'center', marginTop: '6px' }}>
            {t('pair.title')}
          </text>
          <text className="t-sub" style={{ textAlign: 'center', marginTop: '10px', maxWidth: '320px' }}>
            {t('pair.body')}
          </text>

          <Pressable
            className="row"
            style={{
              marginTop: '22px',
              padding: '14px 18px',
              borderRadius: '14px',
              backgroundColor: C['code-bg'],
              borderWidth: '1px',
              borderStyle: 'solid',
              borderColor: C.border,
              alignSelf: 'stretch',
            }}
            onTap={() => {
              copyText(t('pair.command'));
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            }}
          >
            <text className="t-mono" style={{ color: C['text-tertiary'] }}>
              ${' '}
            </text>
            <text className="t-mono grow" style={{ fontSize: '15px' }}>
              {t('pair.command')}
            </text>
            <Icon name={copied ? 'check' : 'copy'} size={18} color={copied ? C.success : C['text-tertiary']} />
          </Pressable>

          <view className="row" style={{ marginTop: '18px', alignSelf: 'stretch' }}>
            <Icon name="qr" size={20} color={C.primary} />
            <text className="t-callout" style={{ marginLeft: '10px', flex: 1 }}>
              {t('cli.pairScan')}
            </text>
          </view>

          <text className="t-section" style={{ alignSelf: 'flex-start', marginTop: '26px', marginBottom: '8px' }}>
            {t('pair.orPaste').toUpperCase()}
          </text>
          <view className="field" style={{ alignSelf: 'stretch' }}>
            <input
              className="field-input"
              placeholder={t('pair.placeholder')}
              default-value={init.link ?? ''}
              bindinput={(e: { detail: { value: string } }) => setLink(e.detail.value)}
              bindconfirm={() => connect()}
            />
          </view>
          {!!error && (
            <text className="t-callout danger" style={{ marginTop: '10px', alignSelf: 'flex-start' }}>
              {error}
            </text>
          )}
          <Button
            label={busy ? t('pair.connecting') : t('pair.connect')}
            icon="link"
            loading={busy}
            onTap={() => connect()}
            style={{ marginTop: '16px', alignSelf: 'stretch' }}
          />
          <view className="row" style={{ marginTop: '22px', alignSelf: 'stretch' }}>
            <Icon name="lock" size={16} color={C.success} />
            <text className="t-caption" style={{ marginLeft: '8px', flex: 1 }}>
              {t('pair.secure')}
            </text>
          </view>
        </view>
      </scroll-view>
    </view>
  );
}
