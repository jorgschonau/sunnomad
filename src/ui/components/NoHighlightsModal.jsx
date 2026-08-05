import React from 'react';
import { View, Text, Image, StyleSheet, TouchableOpacity } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useTranslation } from 'react-i18next';

const EMPTY_IMAGE = require('../../../assets/no_highlights_goldie.jpg');

const CARD_IMAGE_HEIGHT = 148;

/**
 * Empty trophy-filter state — same card language as LoadingModal.
 */
const NoHighlightsModal = ({
  visible,
  radiusLabel,
  onExpandRadius,
  onShowAll,
}) => {
  const { t } = useTranslation();

  if (!visible) return null;

  return (
    <View style={styles.overlay} pointerEvents="box-none">
      <View style={styles.box}>
        <Image source={EMPTY_IMAGE} style={styles.image} resizeMode="cover" />
        <LinearGradient
          colors={['transparent', 'rgba(0, 0, 0, 0.55)']}
          style={styles.scrim}
          pointerEvents="none"
        />
        <View style={styles.overlayContent}>
          <View style={styles.accentLine} />
          <Text style={styles.title} numberOfLines={2}>
            {t('map.noHighlights')}
          </Text>
          {radiusLabel ? (
            <Text style={styles.subtitle} numberOfLines={1}>
              {radiusLabel}
            </Text>
          ) : null}
        </View>
      </View>

      <View style={styles.actions}>
        <TouchableOpacity
          style={styles.primaryButton}
          activeOpacity={0.85}
          onPress={onExpandRadius}
        >
          <Text style={styles.primaryButtonText}>{t('map.expandRadius')}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.secondaryButton}
          activeOpacity={0.7}
          onPress={onShowAll}
        >
          <Text style={styles.secondaryButtonText}>{t('map.showAllPlaces')}</Text>
        </TouchableOpacity>
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
    paddingHorizontal: 24,
  },
  box: {
    width: '100%',
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
    height: '68%',
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
  accentLine: {
    width: '62%',
    height: 5,
    borderRadius: 3,
    backgroundColor: '#C87840',
    marginBottom: 10,
  },
  title: {
    color: 'rgba(255, 255, 255, 0.96)',
    fontSize: 15,
    fontWeight: '600',
    textAlign: 'center',
    letterSpacing: 0.1,
  },
  subtitle: {
    marginTop: 4,
    color: 'rgba(255, 255, 255, 0.72)',
    fontSize: 13,
    fontWeight: '500',
    textAlign: 'center',
  },
  actions: {
    width: '100%',
    maxWidth: 340,
    marginTop: 14,
    gap: 10,
  },
  primaryButton: {
    backgroundColor: '#C87840',
    paddingVertical: 13,
    borderRadius: 12,
    alignItems: 'center',
  },
  primaryButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  secondaryButton: {
    backgroundColor: 'rgba(255, 255, 255, 0.92)',
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: 'center',
  },
  secondaryButtonText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#2C3E6A',
  },
});

export default NoHighlightsModal;
