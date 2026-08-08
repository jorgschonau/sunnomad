import React, { useEffect, useRef } from 'react';
import { View, Text, Image, Animated, StyleSheet, Platform } from 'react-native';

/**
 * animate:
 * - true   — full fade + spring (detail / few badges)
 * - 'light'— short fade only, no spring/shadow (map: many markers)
 * - false  — static
 */
const AnimatedBadge = ({ icon, color, delay = 0, onImageLoad, animate = true }) => {
  const light = animate === 'light';
  const enabled = animate === true || light;
  const fadeAnim = useRef(new Animated.Value(enabled ? 0 : 1)).current;
  const scaleAnim = useRef(new Animated.Value(enabled && !light ? 0 : 1)).current;

  useEffect(() => {
    if (!enabled) return undefined;

    fadeAnim.setValue(0);
    if (!light) scaleAnim.setValue(0);

    const startDelay = light
      ? Math.min(delay, 120)
      : (Platform.OS === 'android' ? 50 : 100 + delay);

    const fade = Animated.timing(fadeAnim, {
      toValue: 1,
      duration: light ? 180 : (Platform.OS === 'android' ? 300 : 500),
      useNativeDriver: true,
    });

    const entryAnimation = light
      ? Animated.sequence([Animated.delay(startDelay), fade])
      : Animated.sequence([
        Animated.delay(startDelay),
        Animated.parallel([
          fade,
          Animated.spring(scaleAnim, {
            toValue: 1,
            tension: Platform.OS === 'android' ? 80 : 50,
            friction: Platform.OS === 'android' ? 8 : 7,
            useNativeDriver: true,
          }),
        ]),
      ]);

    entryAnimation.start();
    return () => entryAnimation.stop();
  }, [enabled, light, icon, color, delay, fadeAnim, scaleAnim]);

  const body = typeof icon === 'string' ? (
    <Text style={styles.badgeIcon}>{icon}</Text>
  ) : (
    <Image source={icon} style={styles.badgeImage} onLoad={onImageLoad} />
  );

  if (!enabled) {
    return (
      <View style={[styles.badgeOverlay, styles.badgeOverlayMap, { backgroundColor: color }]}>
        {body}
      </View>
    );
  }

  return (
    <Animated.View
      style={[
        styles.badgeOverlay,
        light && styles.badgeOverlayMap,
        {
          backgroundColor: color,
          opacity: fadeAnim,
          transform: light ? undefined : [{ scale: scaleAnim }],
        },
      ]}
    >
      {body}
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  badgeOverlay: {
    borderRadius: 14,
    width: 28,
    height: 28,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.9)',
    overflow: 'hidden',
    ...Platform.select({
      android: {
        elevation: 4,
      },
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.18,
        shadowRadius: 2,
      },
    }),
  },
  badgeOverlayMap: {
    shadowOpacity: 0,
    shadowRadius: 0,
    elevation: 0,
  },
  badgeIcon: {
    fontSize: Platform.OS === 'android' ? 17 : 15,
  },
  badgeImage: {
    width: Platform.OS === 'android' ? 26 : 24,
    height: Platform.OS === 'android' ? 26 : 24,
    resizeMode: 'cover',
    borderRadius: Platform.OS === 'android' ? 13 : 12,
  },
});

export default AnimatedBadge;
