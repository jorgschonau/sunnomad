import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';

interface DayForecast {
  label: string;
  date: string;
  tempMax: number;
  tempMin: number;
}

interface WeeklyForecastBarsProps {
  days: DayForecast[];
}

const MIN_BAR_HEIGHT = 40;
const MAX_BAR_HEIGHT = 120;

// Fixed absolute scale so colors are comparable across bars/days, not
// relative to the current week's range.
const TEMP_COLOR_STOPS: { temp: number; color: string }[] = [
  { temp: -5, color: '#2563EB' },
  { temp: 10, color: '#3B82F6' },
  { temp: 18, color: '#EAB308' },
  { temp: 26, color: '#F97316' },
  { temp: 34, color: '#EF4444' },
];

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgbToHex(r: number, g: number, b: number): string {
  const c = (v: number) => Math.round(v).toString(16).padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`;
}

function temperatureToColor(temp: number): string {
  const stops = TEMP_COLOR_STOPS;
  if (temp <= stops[0].temp) return stops[0].color;
  if (temp >= stops[stops.length - 1].temp) return stops[stops.length - 1].color;

  for (let i = 0; i < stops.length - 1; i++) {
    const a = stops[i];
    const b = stops[i + 1];
    if (temp >= a.temp && temp <= b.temp) {
      const t = (temp - a.temp) / (b.temp - a.temp);
      const [ar, ag, ab] = hexToRgb(a.color);
      const [br, bg, bb] = hexToRgb(b.color);
      return rgbToHex(
        ar + (br - ar) * t,
        ag + (bg - ag) * t,
        ab + (bb - ab) * t
      );
    }
  }
  return stops[stops.length - 1].color;
}

function getTodayDateString(): string {
  const now = new Date();
  return `${now.getMonth() + 1}/${now.getDate()}`;
}

export default function WeeklyForecastBars({ days }: WeeklyForecastBarsProps) {
  const todayDate = getTodayDateString();

  const maxTemps = days.map((d) => d.tempMax);
  const weekMin = Math.min(...maxTemps);
  const weekMax = Math.max(...maxTemps);
  const weekRange = weekMax - weekMin;

  return (
    <View style={styles.container}>
      {days.map((day, index) => {
        const ratio = weekRange > 0 ? (day.tempMax - weekMin) / weekRange : 0.5;
        const barHeight = MIN_BAR_HEIGHT + ratio * (MAX_BAR_HEIGHT - MIN_BAR_HEIGHT);
        const topColor = temperatureToColor(day.tempMax);
        const bottomColor = temperatureToColor(day.tempMin);
        const isToday = day.date === todayDate;

        return (
          <View key={`${day.label}-${day.date}-${index}`} style={styles.dayColumn}>
            <Text style={[styles.tempMax, isToday && styles.tempMaxToday]}>
              {Math.round(day.tempMax)}°
            </Text>

            <View style={styles.barTrack}>
              <LinearGradient
                colors={[topColor, bottomColor]}
                start={{ x: 0, y: 0 }}
                end={{ x: 0, y: 1 }}
                style={[styles.bar, { height: barHeight }]}
              />
            </View>

            <Text style={styles.tempMin}>{Math.round(day.tempMin)}°</Text>

            <View style={[styles.dayLabelWrap, isToday && styles.dayLabelWrapToday]}>
              <Text style={[styles.dayLabel, isToday && styles.dayLabelToday]}>
                {day.label}
              </Text>
              <Text style={[styles.dayDate, isToday && styles.dayDateToday]}>
                {day.date}
              </Text>
            </View>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
  },
  dayColumn: {
    flex: 1,
    alignItems: 'center',
  },
  tempMax: {
    fontSize: 13,
    fontWeight: '700',
    color: '#1F2937',
    marginBottom: 6,
  },
  tempMaxToday: {
    color: '#111827',
  },
  barTrack: {
    height: MAX_BAR_HEIGHT,
    justifyContent: 'flex-end',
  },
  bar: {
    width: 6,
    borderRadius: 3,
  },
  tempMin: {
    fontSize: 11,
    color: '#9CA3AF',
    marginTop: 6,
  },
  dayLabelWrap: {
    alignItems: 'center',
    marginTop: 10,
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 10,
  },
  dayLabelWrapToday: {
    backgroundColor: '#F3F4F6',
  },
  dayLabel: {
    fontSize: 10,
    fontWeight: '600',
    letterSpacing: 1,
    textTransform: 'uppercase',
    color: '#6B7280',
  },
  dayLabelToday: {
    color: '#111827',
    fontWeight: '700',
  },
  dayDate: {
    fontSize: 10,
    color: '#9CA3AF',
    marginTop: 2,
  },
  dayDateToday: {
    color: '#374151',
  },
});
