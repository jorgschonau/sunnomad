import React, { useEffect, useRef } from 'react';
import { View, Text, Image, StyleSheet, Animated, Easing } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useTranslation } from 'react-i18next';

const LOADING_IMAGES = {
  warmer: require('../../../assets/loading_goldie_warm.webp'),
  all: require('../../../assets/loading_goldie_spring.webp'),
  cooler: require('../../../assets/loading_goldie_heat.webp'),
};

const CARD_IMAGE_HEIGHT = 124;

const LoadingModal = ({ visible, mode = 'warmer', phaseKey = 'loadingCardPhaseLocation' }) => {
  const { t } = useTranslation();
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!visible) return undefined;

    progress.setValue(0);
    const anim = Animated.loop(
      Animated.timing(progress, {
        toValue: 1,
        duration: 1800,
        easing: Easing.linear,
        useNativeDriver: false,
      }),
    );
    anim.start();
    return () => anim.stop();
  }, [visible, mode, progress]);

  if (!visible) return null;

  const imageSource = LOADING_IMAGES[mode] ?? LOADING_IMAGES.warmer;
  const progressWidth = progress.interpolate({
    inputRange: [0, 1],
    outputRange: ['0%', '100%'],
  });

  return (
    <View style={styles.overlay}>
      <View style={styles.box}>
        <Image source={imageSource} style={styles.image} resizeMode="cover" />
        <LinearGradient
          colors={['transparent', 'rgba(0, 0, 0, 0.45)']}
          style={styles.scrim}
          pointerEvents="none"
        />
        <View style={styles.overlayContent}>
          <View style={styles.progressTrack}>
            <Animated.View style={[styles.progressFill, { width: progressWidth }]} />
          </View>
          <Text style={styles.overlayText} numberOfLines={2}>
            {t(`map.${phaseKey}`, { defaultValue: t('map.loadingCardPhaseLocation') })}
          </Text>
        </View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.22)',
  },
  box: {
    width: '86%',
    maxWidth: 340,
    height: CARD_IMAGE_HEIGHT,
    borderRadius: 15,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(0, 0, 0, 0.08)',
    backgroundColor: '#111',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 20,
    elevation: 4,
  },
  image: {
    ...StyleSheet.absoluteFillObject,
    width: '100%',
    height: '100%',
  },
  scrim: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: '62%',
  },
  overlayContent: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 18,
    paddingBottom: 14,
    paddingTop: 28,
    alignItems: 'center',
  },
  progressTrack: {
    width: '62%',
    height: 5,
    borderRadius: 3,
    backgroundColor: 'rgba(255, 255, 255, 0.25)',
    overflow: 'hidden',
    marginBottom: 10,
  },
  progressFill: {
    height: '100%',
    borderRadius: 3,
    backgroundColor: '#C87840',
  },
  overlayText: {
    color: 'rgba(255, 255, 255, 0.96)',
    fontSize: 14,
    fontWeight: '600',
    textAlign: 'center',
    letterSpacing: 0.1,
  },
});

export default LoadingModal;
