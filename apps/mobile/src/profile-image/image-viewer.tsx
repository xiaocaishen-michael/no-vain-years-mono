// 查看大图全屏 Modal（009 US5，P2）。基础版：全屏 expo-image 原图 + 点击 / 返回关闭。
// pinch-zoom（react-native-reanimated，零新依赖）于 T014 增强。
import { Image } from 'expo-image';
import { Modal, Pressable, Text, View } from 'react-native';

interface ImageViewerProps {
  visible: boolean;
  uri: string | null;
  onClose: () => void;
}

export function ImageViewer({ visible, uri, onClose }: ImageViewerProps) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View className="flex-1 bg-black justify-center">
        <Pressable className="absolute inset-0" accessibilityLabel="关闭" onPress={onClose} />
        {uri ? (
          <Image
            source={{ uri }}
            style={{ width: '100%', height: '100%' }}
            contentFit="contain"
            accessibilityLabel="查看大图"
          />
        ) : null}
        <Pressable
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="关闭大图"
          className="absolute top-12 right-md w-10 h-10 items-center justify-center rounded-full bg-modal-overlay"
        >
          <Text className="text-white-strong text-xl">✕</Text>
        </Pressable>
      </View>
    </Modal>
  );
}
