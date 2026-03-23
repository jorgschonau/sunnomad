import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';

const WEATHER_CONDITIONS = [
  { value: null, key: 'all', icon: '🌍' },
  { value: 'sunny', key: 'sunny', icon: '☀️' },
  { value: 'rainy', key: 'rainy', icon: '🌧️' },
  { value: 'snowy', key: 'snowy', icon: '❄️' },
  { value: 'windy', key: 'windy', icon: '💨' },
];

const WeatherFilter = ({ selectedCondition, onConditionChange }) => {
  const { t } = useTranslation();
  
  return (
    <View style={styles.container}>
      <Text style={styles.label}>Wetter</Text>
      <View style={styles.optionsContainer}>
        {WEATHER_CONDITIONS.map((condition) => {
          const isSelected = selectedCondition === condition.value;
          return (
            <TouchableOpacity
              key={condition.value || 'all'}
              style={[
                styles.option,
                isSelected && styles.optionSelected
              ]}
              onPress={() => onConditionChange(condition.value)}
            >
              <Text style={styles.optionIcon}>{condition.icon}</Text>
              <Text
                style={[
                  styles.optionText,
                  isSelected && styles.optionTextSelected
                ]}
              >
                {t(`weather.${condition.key}`)}
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
    fontSize: 18,
    fontWeight: '700',
    color: '#1565C0',
    marginBottom: 10,
  },
  optionsContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 24,
    borderWidth: 2,
    borderColor: '#1976D2',
    backgroundColor: 'white',
  },
  optionSelected: {
    backgroundColor: '#1976D2',
    borderColor: '#1976D2',
  },
  optionIcon: {
    fontSize: 22,
    marginRight: 6,
  },
  optionText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1976D2',
  },
  optionTextSelected: {
    color: 'white',
  },
});

export default React.memo(WeatherFilter);



