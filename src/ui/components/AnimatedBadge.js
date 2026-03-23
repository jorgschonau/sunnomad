import React, { useEffect, useRef } from 'react';
import { View, Text, Image, Animated, StyleSheet, Platform } from 'react-native';

/**
 * Animated Badge Component with BIG pulse and fade-in effects
 */
const AnimatedBadge = ({ icon, color, delay = 0, onImageLoad }) => {
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const scaleAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    // Force reset to fully transparent and tiny
    fadeAnim.setValue(0);
    scaleAnim.setValue(0);
    pulseAnim.setValue(1);

    const isAndroid = Platform.OS === 'android';
    const startDelay = isAndroid ? 50 : (100 + delay);

    const entryAnimation = Animated.sequence([
      Animated.delay(startDelay),
      Animated.parallel([
        Animated.timing(fadeAnim, {
          toValue: 1,
          duration: isAndroid ? 300 : 800,
          useNativeDriver: true,
        }),
        Animated.spring(scaleAnim, {
          toValue: 1,
          tension: isAndroid ? 80 : 40,
          friction: isAndroid ? 8 : 5,
          useNativeDriver: true,
        }),
      ]),
    ]);
    entryAnimation.start();

    if (!isAndroid) {
      const pulse = Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, {
            toValue: 1.3,
            duration: 800,
            useNativeDriver: true,
          }),
          Animated.timing(pulseAnim, {
            toValue: 1,
            duration: 800,
            useNativeDriver: true,
          }),
        ])
      );

      const pulseTimeout = setTimeout(() => {
        pulse.start();
      }, 100 + delay + 800);

      return () => {
        entryAnimation.stop();
        clearTimeout(pulseTimeout);
        pulse.stop();
      };
    }

    return () => {
      entryAnimation.stop();
    };
  }, [icon, color]);

  return (
    <Animated.View
      style={[
        styles.badgeOverlay,
        {
          backgroundColor: color,
          opacity: fadeAnim,
          transform: [
            { scale: Animated.multiply(scaleAnim, pulseAnim) }
          ],
        },
      ]}
    >
      {typeof icon === 'string' ? (
        <Text style={styles.badgeIcon}>{icon}</Text>
      ) : (
        <Image source={icon} style={styles.badgeImage} onLoad={onImageLoad} />
      )}
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  badgeOverlay: {
    borderRadius: 16,
    width: 32,
    height: 32,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: '#fff',
    overflow: 'visible',
    ...Platform.select({
      android: {
        elevation: 8,
      },
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.3,
        shadowRadius: 3,
      },
    }),
  },
  badgeIcon: {
    fontSize: Platform.OS === 'android' ? 20 : 18,
  },
  badgeImage: {
    width: Platform.OS === 'android' ? 30 : 28,
    height: Platform.OS === 'android' ? 30 : 28,
    resizeMode: 'cover',
    borderRadius: Platform.OS === 'android' ? 15 : 14,
  },
});

export default AnimatedBadge;

