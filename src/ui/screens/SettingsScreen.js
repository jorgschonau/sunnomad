import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Linking,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../../theme/ThemeProvider';
import { useAuth } from '../../contexts/AuthContext';
import { useUnits } from '../../contexts/UnitContext';

const LANGUAGES = [
  { code: 'de', name: 'Deutsch', flag: '🇩🇪' },
  { code: 'en', name: 'English', flag: '🇬🇧' },
  { code: 'fr', name: 'Français', flag: '🇫🇷' },
];

const THEMES = [
  { id: 'standard', nameKey: 'settings.themeStandard', icon: '🌱' },
  { id: 'dark', nameKey: 'settings.themeDark', icon: '🌙' },
  { id: 'blue', nameKey: 'settings.themeBlue', icon: '🌊' },
  { id: 'amber', nameKey: 'settings.themeAmber', icon: '✨' },
];

const UNIT_OPTIONS = [
  { id: 'metric', label: 'km / °C' },
  { id: 'imperial', label: 'mi / °F' },
];

const SettingsScreen = ({ navigation }) => {
  const { t, i18n } = useTranslation();
  const { theme, currentTheme, changeTheme } = useTheme();
  const { isAuthenticated, user, profile } = useAuth();
  const { useImperial, setUseImperial } = useUnits();

  const handleSelectLanguage = (langCode) => {
    i18n.changeLanguage(langCode);
  };

  const currentLanguage = LANGUAGES.find(lang => lang.code === i18n.language) || LANGUAGES[0];

  const handleSelectTheme = (themeId) => {
    changeTheme(themeId);
  };

  const getInitials = () => {
    const name = profile?.display_name || user?.email || '';
    const parts = name.trim().split(/\s+/);
    if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
    return name.slice(0, 2).toUpperCase();
  };

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: theme.background }]}
      showsVerticalScrollIndicator={false}
      showsHorizontalScrollIndicator={false}
    >
      {/* 1. Language */}
      <View style={[styles.section, { backgroundColor: theme.surface }]}>
        <Text style={[styles.sectionTitle, { backgroundColor: theme.background, color: theme.text }]}>
          {t('settings.language')}
        </Text>
        {LANGUAGES.map((lang) => (
          <TouchableOpacity
            key={lang.code}
            style={[
              styles.settingItem,
              { backgroundColor: theme.surface, borderBottomColor: theme.background },
              i18n.language === lang.code && { backgroundColor: theme.background }
            ]}
            onPress={() => handleSelectLanguage(lang.code)}
          >
            <Text style={styles.settingItemFlag}>{lang.flag}</Text>
            <Text style={[
              styles.settingItemText,
              { color: theme.textSecondary },
              i18n.language === lang.code && { fontWeight: '700', color: theme.primary }
            ]}>
              {lang.name}
            </Text>
            {i18n.language === lang.code && (
              <Text style={[styles.checkmark, { color: theme.primary }]}>✓</Text>
            )}
          </TouchableOpacity>
        ))}
      </View>

      {/* 2. Units */}
      <View style={[styles.section, { backgroundColor: theme.surface }]}>
        <Text style={[styles.sectionTitle, { backgroundColor: theme.background, color: theme.text }]}>
          {t('settings.units')}
        </Text>
        {UNIT_OPTIONS.map((option) => {
          const isSelected = option.id === 'imperial' ? useImperial : !useImperial;
          return (
            <TouchableOpacity
              key={option.id}
              style={[
                styles.settingItem,
                { backgroundColor: theme.surface, borderBottomColor: theme.background },
                isSelected && { backgroundColor: theme.background }
              ]}
              onPress={() => setUseImperial(option.id === 'imperial')}
            >
              <View style={styles.unitIcons}>
                <View style={styles.rulerBadge}>
                  <Text style={styles.unitIcon}>📏</Text>
                </View>
                <Text style={styles.unitSep}>/</Text>
                <Text style={styles.unitIcon}>🌡️</Text>
              </View>
              <Text style={[
                styles.settingItemText,
                { color: theme.textSecondary },
                isSelected && { fontWeight: '700', color: theme.primary }
              ]}>
                {option.label}
              </Text>
              {isSelected && (
                <Text style={[styles.checkmark, { color: theme.primary }]}>✓</Text>
              )}
            </TouchableOpacity>
          );
        })}
      </View>

      {/* 3. Theme */}
      <View style={[styles.section, { backgroundColor: theme.surface }]}>
        <Text style={[styles.sectionTitle, { backgroundColor: theme.background, color: theme.text }]}>
          {t('settings.theme')}
        </Text>
        {THEMES.map((themeOption) => (
          <TouchableOpacity
            key={themeOption.id}
            style={[
              styles.settingItem,
              { backgroundColor: theme.surface, borderBottomColor: theme.background },
              currentTheme === themeOption.id && { backgroundColor: theme.background }
            ]}
            onPress={() => handleSelectTheme(themeOption.id)}
          >
            <Text style={styles.settingItemFlag}>{themeOption.icon}</Text>
            <Text style={[
              styles.settingItemText,
              { color: theme.textSecondary },
              currentTheme === themeOption.id && { fontWeight: '700', color: theme.primary }
            ]}>
              {t(themeOption.nameKey)}
            </Text>
            {currentTheme === themeOption.id && (
              <Text style={[styles.checkmark, { color: theme.primary }]}>✓</Text>
            )}
          </TouchableOpacity>
        ))}
      </View>

      {/* 4. Account */}
      <View style={[styles.section, { backgroundColor: theme.surface }]}>
        <Text style={[styles.sectionTitle, { backgroundColor: theme.background, color: theme.text }]}>
          {t('settings.account')}
        </Text>
        {isAuthenticated ? (
          <TouchableOpacity
            style={[
              styles.settingItem,
              { backgroundColor: theme.surface, borderBottomColor: theme.background }
            ]}
            onPress={() => navigation.navigate('Profile')}
          >
            <View style={styles.initialsCircle}>
              <Text style={styles.initialsText}>{getInitials()}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.settingItemText, { color: theme.text }]}>
                {profile?.display_name || user?.email}
              </Text>
              <Text style={[styles.settingItemSubtext, { color: theme.textSecondary }]}>
                {t('profile.title', 'View Profile')}
              </Text>
            </View>
            <Text style={[styles.arrow, { color: theme.textSecondary }]}>›</Text>
          </TouchableOpacity>
        ) : null}
      </View>

      <TouchableOpacity onPress={() => Linking.openURL('https://open-meteo.com')}>
        <Text style={styles.attribution}>
          Weather data by Open-Meteo.com
        </Text>
      </TouchableOpacity>

    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  section: {
    marginTop: 24,
    paddingVertical: 8,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '700',
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  settingItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 20,
    minHeight: 72,
    borderBottomWidth: 1,
  },
  settingItemFlag: {
    fontSize: 32,
    marginRight: 16,
  },
  settingItemText: {
    flex: 1,
    fontSize: 20,
    fontWeight: '500',
  },
  checkmark: {
    fontSize: 28,
    fontWeight: 'bold',
  },
  settingItemSubtext: {
    fontSize: 14,
    marginTop: 4,
  },
  arrow: {
    fontSize: 32,
    fontWeight: '300',
  },
  placeholderItem: {
    paddingHorizontal: 20,
    paddingVertical: 32,
    alignItems: 'center',
  },
  placeholderText: {
    fontSize: 18,
    fontStyle: 'italic',
  },
  unitIcons: {
    flexDirection: 'row',
    alignItems: 'center',
    marginRight: 16,
  },
  rulerBadge: {
    backgroundColor: '#C8B560',
    borderRadius: 6,
    paddingHorizontal: 3,
    paddingVertical: 1,
  },
  unitIcon: {
    fontSize: 22,
  },
  unitSep: {
    fontSize: 16,
    color: '#999',
    marginHorizontal: 4,
  },
  initialsCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#3B4FBF',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 16,
  },
  initialsText: {
    color: 'white',
    fontSize: 15,
    fontWeight: '500',
  },
  attribution: {
    fontSize: 13,
    textAlign: 'center',
    marginTop: 32,
    marginBottom: 24,
    color: '#3B4FBF',
  },
});

export default SettingsScreen;

