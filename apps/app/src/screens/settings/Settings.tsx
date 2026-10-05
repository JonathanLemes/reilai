import { useCallback, useEffect, useInitData, useLynxGlobalEventListener, useState } from '@lynx-js/react';
import type { ThemePref } from '@reilai/brand';
import { LANGUAGES, type LanguagePref, relativeTime } from '@reilai/i18n';
import type { Device } from '@reilai/protocol';

import { useHello } from '../../shared/data';
import { rpc, setThemePref } from '../../shared/host';
import { useConnection, useLanguage, useLayout, useServerEvent } from '../../shared/hooks';
import { C } from '../../shared/theme';
import { AgentAvatar } from '../../ui/agent';
import { Button, Cell, ConfirmDialog, Divider, Icon, Logo, Segmented, Toast } from '../../ui/kit';

export function Settings() {
  const init = useInitData();
  const { t, lang } = useLanguage();
  const { safeTop, safeBottom, web } = useLayout();
  const conn = useConnection();
  const hello = useHello();
  const [theme, setTheme] = useState<ThemePref>(init.theme?.pref ?? 'system');
  const [devices, setDevices] = useState<Device[] | null>(null);
  const [revoking, setRevoking] = useState<Device | null>(null);
  const [confirmUnpair, setConfirmUnpair] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const loadDevices = useCallback(() => {
    rpc('devices.list', {})
      .then(setDevices)
      .catch(() => setDevices([]));
  }, []);
  useEffect(loadDevices, [loadDevices]);
  useServerEvent((event, data) => {
    if (event === 'devices.changed') setDevices(data as Device[]);
  });
  useLynxGlobalEventListener('reil:theme', (arg: unknown) => {
    const v = (Array.isArray(arg) ? arg[0] : arg) as { pref?: ThemePref } | undefined;
    if (v?.pref) setTheme(v.pref);
  });

  const language = hello?.settings.language ?? init.langPref ?? 'system';
  const setLanguage = (value: LanguagePref) =>
    rpc('settings.set', { language: value }).catch((e: Error) => {
      setToast(e.message);
      setTimeout(() => setToast(null), 2500);
    });

  return (
    <view className="root">
      <view style={{ height: `${safeTop}px` }} />
      <view className="large-title">
        <text className="t-title grow">{t('settings.title')}</text>
      </view>
      <scroll-view scroll-orientation="vertical" style={{ flex: 1, width: '100%' }}>
        <text className="t-section group-label">{t('settings.language').toUpperCase()}</text>
        <view style={{ padding: '0 16px' }}>
          <Segmented<LanguagePref>
            value={language}
            onChange={setLanguage}
            options={[{ value: 'system', label: t('common.system') }, ...LANGUAGES.map((l) => ({ value: l.code as LanguagePref, label: l.label }))]}
          />
          <text className="t-caption" style={{ marginTop: '8px', paddingLeft: '4px' }}>
            {t('settings.languageHint')}
          </text>
        </view>

        <text className="t-section group-label">{t('settings.theme').toUpperCase()}</text>
        <view style={{ padding: '0 16px' }}>
          <Segmented<ThemePref>
            value={theme}
            onChange={(v) => {
              setTheme(v);
              setThemePref(v);
            }}
            options={[
              { value: 'system', label: t('common.system'), icon: 'palette' },
              { value: 'light', label: t('settings.theme.light'), icon: 'sun' },
              { value: 'dark', label: t('settings.theme.dark'), icon: 'moon' },
            ]}
          />
        </view>

        <text className="t-section group-label">{t('settings.machine').toUpperCase()}</text>
        <view className="card" style={{ margin: '0 16px' }}>
          <Cell
            icon="laptop"
            title={hello?.machine.name ?? conn.machine ?? '…'}
            subtitle={hello ? `${hello.machine.platform} · ${hello.machine.home}` : undefined}
            right={
              <view className="pill" style={{ backgroundColor: conn.state === 'connected' ? C['success-soft'] : C['warning-soft'] }}>
                <view className="dot" style={{ backgroundColor: conn.state === 'connected' ? C.success : C.warning }} />
                <text className="t-caption" style={{ marginLeft: '6px', color: conn.state === 'connected' ? C.success : C.warning }}>
                  {t(conn.state === 'connected' ? 'conn.connected' : conn.state === 'connecting' ? 'conn.connecting' : 'conn.offline')}
                </text>
              </view>
            }
          />
          <Divider />
          <Cell icon="cpu" title={t('settings.version')} value={hello ? `v${hello.machine.version}` : '…'} />
          {hello?.agents.map((a) => (
            <view key={a.agent}>
              <Divider />
              <view className="cell">
                <view style={{ marginRight: '12px' }}>
                  <AgentAvatar agent={a.agent} size={30} />
                </view>
                <text className="t-body grow">{a.agent === 'claude' ? t('agent.claude') : t('agent.codex')}</text>
                <text className="t-callout" style={{ color: a.installed ? C['text-secondary'] : C.danger }}>
                  {a.installed ? `v${a.version ?? '?'}` : t('agent.notInstalled')}
                </text>
              </view>
            </view>
          ))}
        </view>

        <text className="t-section group-label">{t('settings.devices').toUpperCase()}</text>
        <view className="card" style={{ margin: '0 16px' }}>
          {devices && devices.length === 0 && (
            <text className="t-sub" style={{ padding: '14px 16px' }}>
              {t('settings.devicesEmpty')}
            </text>
          )}
          {devices?.map((d, i) => (
            <view key={d.id}>
              {i > 0 && <Divider />}
              <Cell
                icon="phone"
                title={d.name}
                subtitle={d.lastSeenAt ? t('settings.lastSeen', { when: relativeTime(lang, d.lastSeenAt) }) : t('settings.neverSeen')}
                right={<Button small variant="danger" label={t('settings.revoke')} onTap={() => setRevoking(d)} />}
              />
            </view>
          ))}
        </view>

        <view style={{ padding: '18px 16px 0 16px' }}>
          {web ? (
            NativeModules.ReilHost?.logout && (
              <Button variant="secondary" icon="logout" label={t('settings.logout')} onTap={() => NativeModules.ReilHost?.logout?.()} />
            )
          ) : (
            <Button variant="danger" icon="logout" label={t('settings.unpair')} onTap={() => setConfirmUnpair(true)} />
          )}
        </view>

        <text className="t-section group-label">{t('settings.about').toUpperCase()}</text>
        <view className="card" style={{ margin: '0 16px', padding: '18px', alignItems: 'center' }}>
          <Logo size={44} />
          <text className="t-headline" style={{ marginTop: '10px' }}>
            ReilAI
          </text>
          <text className="t-caption">{init.appVersion ?? ''}</text>
          <text className="t-sub" style={{ marginTop: '8px', textAlign: 'center' }}>
            {t('settings.aboutBody')}
          </text>
          <view className="row hov" style={{ marginTop: '12px' }} bindtap={() => NativeModules.ReilHost?.openURL?.('https://github.com/JonathanLemes/reilai')}>
            <Icon name="link" size={15} color={C.primary} />
            <text className="t-callout accent" style={{ marginLeft: '6px' }}>
              github.com/JonathanLemes/reilai
            </text>
          </view>
        </view>
        <view style={{ height: `${40 + safeBottom}px` }} />
      </scroll-view>

      <ConfirmDialog
        open={!!revoking}
        title={t('settings.revokeConfirm', { name: revoking?.name ?? '' })}
        confirmLabel={t('settings.revoke')}
        cancelLabel={t('common.cancel')}
        danger
        onClose={() => setRevoking(null)}
        onConfirm={() => revoking && rpc('devices.revoke', { id: revoking.id }).then(loadDevices)}
      />
      <ConfirmDialog
        open={confirmUnpair}
        title={`${t('settings.unpair')}?`}
        confirmLabel={t('settings.unpair')}
        cancelLabel={t('common.cancel')}
        danger
        onClose={() => setConfirmUnpair(false)}
        onConfirm={() => NativeModules.ReilHost?.unpair?.()}
      />
      <Toast text={toast} />
    </view>
  );
}
