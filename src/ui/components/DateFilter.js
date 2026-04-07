import React, { useState, useEffect, useRef, useCallback } from 'react';
import { View, Text, TouchableOpacity, ScrollView, Animated, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';

const getDatePresets = (t) => [
  { value: 0, line1: t('destination.today'), line2: null },
  { value: 1, line1: t('destination.tomorrow'), line2: null },
  { value: 3, line1: '+3', line2: t('dateFilter.days') },
  { value: 5, line1: '+5', line2: t('dateFilter.days') },
  { value: 7, line1: '+7', line2: t('dateFilter.days') },
  { value: 10, line1: '+10', line2: t('dateFilter.days') },
];

const formatDateLabel = (offset, t, i18n) => {
  if (offset === 0) return t('destination.today');
  if (offset === 1) return t('destination.tomorrow');
  const dateLocale = i18n.language === 'de' ? 'de-DE' : i18n.language === 'fr' ? 'fr-FR' : 'en-US';
  const date = new Date();
  date.setDate(date.getDate() + offset);
  return date.toLocaleDateString(dateLocale, { weekday: 'short', day: 'numeric', month: 'short' });
};

/**
 * Convert offset to YYYY-MM-DD date string
 */
export const getTargetDate = (offset) => {
  const date = new Date();
  date.setDate(date.getDate() + offset);
  return date.toISOString().split('T')[0];
};

const SCROLL_THRESHOLD = 4;

const DateFilter = ({ selectedDateOffset, onDateOffsetChange }) => {
  const { t, i18n } = useTranslation();
  const DATE_PRESETS = getDatePresets(t);
  const [localOffset, setLocalOffset] = useState(selectedDateOffset);
  const callbackRef = useRef(null);
  const fadeLeft = useRef(new Animated.Value(0)).current;
  const fadeRight = useRef(new Animated.Value(0)).current;
  const scrollMetrics = useRef({ offset: 0, contentWidth: 0, containerWidth: 0 });

  useEffect(() => {
    setLocalOffset(selectedDateOffset);
  }, [selectedDateOffset]);

  useEffect(() => {
    return () => {
      if (callbackRef.current) cancelAnimationFrame(callbackRef.current);
    };
  }, []);

  const updateFades = useCallback(() => {
    const { offset, contentWidth, containerWidth } = scrollMetrics.current;
    const maxScroll = contentWidth - containerWidth;
    if (maxScroll <= 0) {
      Animated.timing(fadeLeft, { toValue: 0, duration: 150, useNativeDriver: true }).start();
      Animated.timing(fadeRight, { toValue: 0, duration: 150, useNativeDriver: true }).start();
      return;
    }
    const showLeft = offset > SCROLL_THRESHOLD ? 1 : 0;
    const showRight = offset < maxScroll - SCROLL_THRESHOLD ? 1 : 0;
    Animated.timing(fadeLeft, { toValue: showLeft, duration: 150, useNativeDriver: true }).start();
    Animated.timing(fadeRight, { toValue: showRight, duration: 150, useNativeDriver: true }).start();
  }, [fadeLeft, fadeRight]);

  const handleScroll = useCallback((e) => {
    scrollMetrics.current.offset = e.nativeEvent.contentOffset.x;
    updateFades();
  }, [updateFades]);

  const handleContentSizeChange = useCallback((w) => {
    scrollMetrics.current.contentWidth = w;
    updateFades();
  }, [updateFades]);

  const handleLayout = useCallback((e) => {
    scrollMetrics.current.containerWidth = e.nativeEvent.layout.width;
    updateFades();
  }, [updateFades]);

  const handlePress = (value) => {
    setLocalOffset(value);
    if (callbackRef.current) cancelAnimationFrame(callbackRef.current);
    callbackRef.current = requestAnimationFrame(() => {
      onDateOffsetChange(value);
    });
  };

  return (
    <View style={styles.container}>
      <Text style={styles.label}>
        {t('dateFilter.weatherFor')} {formatDateLabel(localOffset, t, i18n)}
      </Text>
      <View style={styles.optionsWrapper}>
        <ScrollView
          horizontal
          showsVerticalScrollIndicator={false}
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: 4, gap: 8 }}
          onScroll={handleScroll}
          onContentSizeChange={handleContentSizeChange}
          onLayout={handleLayout}
          scrollEventThrottle={16}
        >
          {DATE_PRESETS.map((preset) => {
            const isSelected = localOffset === preset.value;
            return (
              <TouchableOpacity
                key={preset.value}
                style={[styles.option, isSelected && styles.optionSelected]}
                onPress={() => handlePress(preset.value)}
              >
                <Text style={[styles.optionText, isSelected && styles.optionTextSelected]}>
                  {preset.line1}
                </Text>
                {preset.line2 && (
                  <Text style={[styles.optionTextSmall, isSelected && styles.optionTextSelected]}>
                    {preset.line2}
                  </Text>
                )}
              </TouchableOpacity>
            );
          })}
        </ScrollView>

        {/* Left fade indicator */}
        <Animated.View
          pointerEvents="none"
          style={[styles.fadeEdge, styles.fadeLeft, { opacity: fadeLeft }]}
        >
          <Text style={styles.fadeArrow}>‹</Text>
        </Animated.View>

        {/* Right fade indicator */}
        <Animated.View
          pointerEvents="none"
          style={[styles.fadeEdge, styles.fadeRight, { opacity: fadeRight }]}
        >
          <Text style={styles.fadeArrow}>›</Text>
        </Animated.View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    marginBottom: 16,
  },
  label: {
    fontSize: 16,
    fontWeight: '700',
    color: '#1565C0',
    marginBottom: 10,
  },
  dateSubLabel: {
    fontSize: 13,
    fontWeight: '500',
    color: '#666',
  },
  optionsWrapper: {
    borderRadius: 12,
    borderWidth: 2,
    borderColor: '#FF8C42',
    backgroundColor: 'white',
    padding: 4,
  },
  option: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'white',
    minHeight: 44,
    minWidth: 56,
  },
  optionSelected: {
    backgroundColor: '#FF8C42',
  },
  optionText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#1565C0',
  },
  optionTextSmall: {
    fontSize: 11,
    fontWeight: '600',
    color: '#1565C0',
    marginTop: 1,
  },
  optionTextSelected: {
    color: 'white',
  },
  fadeEdge: {
    position: 'absolute',
    top: 4,
    bottom: 4,
    width: 26,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 8,
  },
  fadeLeft: {
    left: 4,
    backgroundColor: 'rgba(255,255,255,0.85)',
  },
  fadeRight: {
    right: 4,
    backgroundColor: 'rgba(255,255,255,0.85)',
  },
  fadeArrow: {
    fontSize: 22,
    fontWeight: '900',
    color: '#FF8C42',
  },
});

export default React.memo(DateFilter);
