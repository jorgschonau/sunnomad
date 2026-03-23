import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
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
  { id: 'standard', name: 'Standard', icon: '🌱' },
  { id: 'dark', name: 'Dunkel', icon: '🌙' },
  { id: 'blue', name: 'Blau', icon: '🌊' },
  { id: 'amber', name: 'Gold', icon: '✨' },
];

const UNIT_OPTIONS = [
  { id: 'metric', label: 'km / °C', icon: '🌡️' },
  { id: 'imperial', label: 'mi / °F', icon: '🌡️' },
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

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: theme.background }]}
      showsVerticalScrollIndicator={false}
      showsHorizontalScrollIndicator={false}
    >
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
              {themeOption.name}
            </Text>
            {currentTheme === themeOption.id && (
              <Text style={[styles.checkmark, { color: theme.primary }]}>✓</Text>
            )}
          </TouchableOpacity>
        ))}
      </View>

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
              <Text style={styles.settingItemFlag}>{option.icon}</Text>
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

      {/* Account Section */}
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
            <Text style={styles.settingItemFlag}>👤</Text>
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

      <Text style={[styles.attribution, { color: theme.textTertiary }]}>
        Weather data by Open-Meteo.com
      </Text>

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
  attribution: {
    fontSize: 12,
    textAlign: 'center',
    marginTop: 32,
    marginBottom: 24,
    opacity: 0.5,
  },
});

export default SettingsScreen;

