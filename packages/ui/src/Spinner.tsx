import { useEffect, useRef } from 'react';
import { Animated, Easing } from 'react-native';

export type SpinnerTone = 'white' | 'muted' | 'brand';

export interface SpinnerProps {
  size?: number;
  tone?: SpinnerTone;
}

export function Spinner({ size = 16, tone = 'white' }: SpinnerProps) {
  const rotation = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const anim = Animated.loop(
      Animated.timing(rotation, {
        toValue: 1,
        duration: 700,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    );
    anim.start();
    return () => anim.stop();
  }, [rotation]);

  const spin = rotation.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg'],
  });

  const ring =
    tone === 'white'
      ? 'border-white/30 border-t-white'
      : tone === 'brand'
        ? 'border-brand-200 border-t-brand-500'
        : 'border-line border-t-ink-subtle';

  return (
    <Animated.View
      style={[{ width: size, height: size }, { transform: [{ rotate: spin }] }]}
      className={`rounded-full border-2 ${ring}`}
    />
  );
}
