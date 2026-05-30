import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert, Platform, ScrollView } from 'react-native';

import { logoutAll } from '~/auth/logout-all';

import { Card, Divider, Row } from '~/settings/primitives';

const COPY = {
  cards: {
    accountSecurity: '账号与安全',
    general: '通用',
    notifications: '通知',
    privacy: '隐私与权限',
    about: '关于',
    switchAccount: '切换账号',
    logout: '退出登录',
  },
  logoutConfirm: '确定要退出登录?',
  logoutCancel: '取消',
  logoutOk: '确定',
};

export default function SettingsIndex() {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(false);

  async function handleLogout() {
    if (isLoading) return;
    setIsLoading(true);
    try {
      await logoutAll();
    } catch {
      // logoutAll swallows server errors internally and always clears the
      // local session in finally — so this outer catch is an extra safety net.
    }
    // logoutAll clears the session; AuthGate will redirect to login.
    // The explicit replace here is a belt-and-suspenders guard for timing
    // edge cases on web where AuthGate's redirect may be slightly delayed.
    router.replace('/(auth)/login');
  }

  function confirmLogout() {
    // react-native-web Alert.alert falls back to a single-button window.alert,
    // ignoring the buttons array — onPress never fires on web. Use
    // window.confirm explicitly so the user can actually cancel on web.
    if (Platform.OS === 'web') {
      if (typeof window !== 'undefined' && window.confirm(COPY.logoutConfirm)) {
        void handleLogout();
      }
      return;
    }
    Alert.alert(COPY.logoutConfirm, undefined, [
      { text: COPY.logoutCancel, style: 'cancel' },
      { text: COPY.logoutOk, style: 'destructive', onPress: handleLogout },
    ]);
  }

  return (
    <ScrollView
      className="flex-1 bg-surface-sunken"
      contentContainerClassName="px-md pt-md pb-xl gap-md"
    >
      <Card>
        <Row
          label={COPY.cards.accountSecurity}
          onPress={() => router.push('/(app)/settings/account-security')}
        />
        <Divider />
        <Row label={COPY.cards.general} disabled />
        <Divider />
        <Row label={COPY.cards.notifications} disabled />
      </Card>

      <Card>
        <Row label={COPY.cards.privacy} disabled />
        <Divider />
        <Row label={COPY.cards.about} disabled />
      </Card>

      <Card>
        <Row label={COPY.cards.switchAccount} disabled showChevron={false} align="center" />
        <Divider />
        <Row
          label={COPY.cards.logout}
          destructive
          showChevron={false}
          align="center"
          busy={isLoading}
          onPress={confirmLogout}
        />
      </Card>
    </ScrollView>
  );
}
