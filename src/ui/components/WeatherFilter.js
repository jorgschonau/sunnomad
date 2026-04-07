import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

const WEATHER_CONDITIONS = [
  { value: null, key: 'all', icon: 'globe-outline', iconColor: '#fff', bg: '#3B4FBF', text: '#fff', activeBg: '#3B4FBF', activeText: '#fff', activeIcon: '#fff' },
  { value: 'sunny', key: 'sunny', icon: 'sunny', iconColor: '#F5C400', bg: '#FFF0B0', text: '#7A5500', activeBg: '#FFD600', activeText: '#5A3E00', activeIcon: '#E8A800' },
  { value: 'rainy', key: 'rainy', icon: 'rainy', iconColor: '#1A5FB4', bg: '#D6EAFF', text: '#1A5FB4', activeBg: '#1A5FB4', activeText: '#fff', activeIcon: '#fff' },
  { value: 'snowy', key: 'snowy', icon: 'snow', iconColor: '#1B7A4A', bg: '#D4F5E5', text: '#1B7A4A', activeBg: '#1B7A4A', activeText: '#fff', activeIcon: '#fff' },
];

const WeatherFilter = ({ selectedCondition, onConditionChange }) => {
  const { t } = useTranslation();

  return (
    <View style={styles.container}>
      <Text style={styles.label}>WEATHER TYPE</Text>
      <View style={styles.grid}>
        {WEATHER_CONDITIONS.map((c) => {
          const active = selectedCondition === c.value;
          return (
            <TouchableOpacity
              key={c.value || 'all'}
              style={[styles.cell, { backgroundColor: active ? c.activeBg : c.bg }]}
              onPress={() => onConditionChange(c.value)}
              activeOpacity={0.7}
            >
              <Ionicons name={c.icon} size={18} color={active ? c.activeIcon : c.iconColor} />
              <Text style={[styles.cellText, { color: active ? c.activeText : c.text }]}>
                {t(`weather.${c.key}`)}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    marginTop: 8,
  },
  label: {
    fontSize: 11,
    fontWeight: '600',
    color: '#8E8E93',
    letterSpacing: 0.8,
    marginBottom: 8,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  cell: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    width: '47%',
    paddingVertical: 11,
    paddingHorizontal: 16,
    borderRadius: 999,
    gap: 8,
  },
  cellText: {
    fontSize: 15,
    fontWeight: '500',
  },
});

export default React.memo(WeatherFilter);
