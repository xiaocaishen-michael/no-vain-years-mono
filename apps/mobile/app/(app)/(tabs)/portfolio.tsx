// PHASE 1 PLACEHOLDER — business flow validated; visuals pending mockup.
// 投资 (portfolio) tab：内容页 (自选 / 市场 / 股票详情 / 券商绑定) 见 portfolio
// handoff bundle，后续独立 feature 实现。
import { Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

export default function PortfolioTab() {
  return (
    <SafeAreaView style={{ flex: 1 }}>
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <Text>投资内容即将推出</Text>
      </View>
    </SafeAreaView>
  );
}
