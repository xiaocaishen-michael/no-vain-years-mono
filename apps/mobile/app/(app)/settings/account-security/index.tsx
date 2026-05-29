import { ScrollView } from 'react-native';

import { useAuthStore } from '~/auth/store';
import { maskPhone } from '~/format/phone';
import { Card, Divider, Row } from '~/settings/primitives';

const COPY = {
  phone: '手机号',
  realname: '实名认证',
  thirdPartyBinding: '第三方账号绑定',
  loginManagement: '登录管理',
  deleteAccount: '注销账号',
  securityTips: '安全小知识',
};

export default function AccountSecurityIndex() {
  const phone = useAuthStore((s) => s.phone);

  return (
    <ScrollView
      className="flex-1 bg-surface-sunken"
      contentContainerClassName="px-md pt-md pb-xl gap-md"
    >
      <Card>
        {/* 手机号 disabled until a dedicated phone-management feature ships */}
        <Row label={COPY.phone} value={maskPhone(phone)} disabled />
        <Divider />
        <Row label={COPY.realname} disabled />
        <Divider />
        <Row label={COPY.thirdPartyBinding} disabled />
      </Card>

      <Card>
        {/* B2 (device-management amend 005) 激活：去 disabled + onPress → router.push('login-management') */}
        <Row label={COPY.loginManagement} disabled />
      </Card>

      <Card>
        {/* B3 (account-deletion settings 入口 amend 004) 激活：去 disabled + onPress → router.push('delete-account') */}
        <Row label={COPY.deleteAccount} destructive disabled />
        <Divider />
        <Row label={COPY.securityTips} disabled />
      </Card>
    </ScrollView>
  );
}
