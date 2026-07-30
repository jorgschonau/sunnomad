import React, { useState, useCallback } from 'react';
import { View, Text, StyleSheet, LayoutChangeEvent } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';

interface TemperatureGradientBarProps {
  min: number;
  max: number;
  current: number;
  unit?: string;
}

const GRADIENT_COLORS = ['#3B82F6', '#22C55E', '#EAB308', '#F97316', '#EF4444'] as const;

const MARKER_SIZE = 12;

export default function TemperatureGradientBar({
  min,
  max,
  current,
  unit = '°C',
}: TemperatureGradientBarProps) {
  const [barWidth, setBarWidth] = useState(0);

  const onBarLayout = useCallback((event: LayoutChangeEvent) => {
    setBarWidth(event.nativeEvent.layout.width);
  }, []);

  const clamped = Math.min(Math.max(current, min), max);
  const range = max - min;
  const ratio = range > 0 ? (clamped - min) / range : 0;
  const markerLeft = barWidth > 0 ? ratio * barWidth - MARKER_SIZE / 2 : 0;

  return (
    <View style={styles.container}>
      <View style={styles.headerRow}>
        <Text style={styles.label}>Temperature</Text>
        <Text style={styles.currentValue}>
          {Math.round(current)}
          {unit}
        </Text>
      </View>

      <View style={styles.barWrapper} onLayout={onBarLayout}>
        <LinearGradient
          colors={GRADIENT_COLORS}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={styles.gradientBar}
        />
        {barWidth > 0 && (
          <View style={[styles.marker, { left: markerLeft }]} />
        )}
      </View>

      <View style={styles.footerRow}>
        <Text style={styles.rangeLabel}>
          {Math.round(min)}
          {unit}
        </Text>
        <Text style={styles.rangeLabel}>
          {Math.round(max)}
          {unit}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: '100%',
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    marginBottom: 10,
  },
  label: {
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    color: '#9CA3AF',
  },
  currentValue: {
    fontFamily: 'Georgia',
    fontSize: 28,
    color: '#1F2937',
  },
  barWrapper: {
    width: '100%',
    height: MARKER_SIZE,
    justifyContent: 'center',
  },
  gradientBar: {
    height: 6,
    borderRadius: 3,
    width: '100%',
  },
  marker: {
    position: 'absolute',
    top: 0,
    width: MARKER_SIZE,
    height: MARKER_SIZE,
    backgroundColor: '#FFFFFF',
    borderWidth: 1.5,
    borderColor: '#1F2937',
    transform: [{ rotate: '45deg' }],
  },
  footerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 8,
  },
  rangeLabel: {
    fontSize: 12,
    color: '#9CA3AF',
  },
});
