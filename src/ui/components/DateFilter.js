import React, { useState, useEffect, useRef } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';

const DATE_PRESETS = [
  { value: 0, line1: 'Heute', line2: null },
  { value: 1, line1: 'Morgen', line2: null },
  { value: 3, line1: '+3', line2: 'Tage' },
  { value: 5, line1: '+5', line2: 'Tage' },
];

/**
 * Format a date offset into a readable label
 * 0 → "Heute", 1 → "Morgen", 3+ → "Fr, 9. Feb"
 */
const formatDateLabel = (offset) => {
  if (offset === 0) return 'Heute';
  if (offset === 1) return 'Morgen';
  const date = new Date();
  date.setDate(date.getDate() + offset);
  return date.toLocaleDateString('de-DE', { weekday: 'short', day: 'numeric', month: 'short' });
};

/**
 * Convert offset to YYYY-MM-DD date string
 */
export const getTargetDate = (offset) => {
  const date = new Date();
  date.setDate(date.getDate() + offset);
  return date.toISOString().split('T')[0];
};

const DateFilter = ({ selectedDateOffset, onDateOffsetChange }) => {
  // Local state for instant visual feedback; synced from prop when parent catches up
  const [localOffset, setLocalOffset] = useState(selectedDateOffset);
  const callbackRef = useRef(null);

  useEffect(() => {
    setLocalOffset(selectedDateOffset);
  }, [selectedDateOffset]);

  useEffect(() => {
    return () => {
      if (callbackRef.current) cancelAnimationFrame(callbackRef.current);
    };
  }, []);

  const handlePress = (value) => {
    setLocalOffset(value);
    // Defer the heavy parent state update so this component re-renders first
    if (callbackRef.current) cancelAnimationFrame(callbackRef.current);
    callbackRef.current = requestAnimationFrame(() => {
      onDateOffsetChange(value);
    });
  };

  return (
    <View style={styles.container}>
      <Text style={styles.label}>
        Wetter für {formatDateLabel(localOffset)}
        {localOffset > 1 && (
          <Text style={styles.dateSubLabel}> ({getTargetDate(localOffset)})</Text>
        )}
      </Text>
      <View style={styles.optionsWrapper}>
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
    flexDirection: 'row',
    borderRadius: 12,
    borderWidth: 2,
    borderColor: '#FF8C42',
    backgroundColor: 'white',
    padding: 4,
    gap: 6,
  },
  option: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'white',
    minHeight: 44,
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
});

export default DateFilter;
