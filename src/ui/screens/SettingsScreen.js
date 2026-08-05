import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Linking,
} from 'react-native';
import Constants from 'expo-constants';
import { useFocusEffect } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useTheme } from '../../theme/ThemeProvider';
import { useAuth } from '../../contexts/AuthContext';
import { useUnits } from '../../contexts/UnitContext';
import { mixpanel } from '../../services/mixpanel';
import { getFavourites } from '../../usecases/favouritesUsecases';
import { resolveIronicBadges } from '../../utils/ironicProgress';

// Native binary values — expoConfig ios.buildNumber is stale with EAS remote versioning.
const APP_VERSION = Constants.nativeApplicationVersion
  ?? Constants.expoConfig?.version
  ?? '?';
const APP_BUILD = Constants.nativeBuildVersion ?? '—';

const LANGUAGES = [
  { code: 'de', name: 'Deutsch', flag: '🇩🇪' },
  { code: 'en', name: 'English', flag: '🇺🇸' },
  // { code: 'fr', name: 'Français', flag: '🇫🇷' }, // temporarily disabled
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
  const [badgeProgress, setBadgeProgress] = useState(null);

  useFocusEffect(
    useCallback(() => {
      if (!isAuthenticated) {
        setBadgeProgress(null);
        return undefined;
      }
      let active = true;
      (async () => {
        let favCount = 0;
        try {
          const favs = await getFavourites();
          favCount = favs.length;
        } catch {
          favCount = 0;
        }
        const { badges } = await resolveIronicBadges(
          {
            appOpens: profile?.app_open_count,
            favouriteCount: favCount,
            memberSince: profile?.created_at,
          },
          { persist: false }
        );
        if (!active) return;
        setBadgeProgress({
          earned: badges.filter((b) => b.earned).length,
          total: badges.length,
        });
      })().catch(() => {
        if (active) setBadgeProgress(null);
      });
      return () => {
        active = false;
      };
    }, [isAuthenticated, profile?.app_open_count, profile?.created_at])
  );

  const handleSelectLanguage = (langCode) => {
    if (i18n.language === langCode) return;
    i18n.changeLanguage(langCode);
    mixpanel.track('Settings Changed', { setting: 'language', value: langCode });
  };

  const handleSelectTheme = (themeId) => {
    if (currentTheme === themeId) return;
    changeTheme(themeId);
    mixpanel.track('Settings Changed', { setting: 'theme', value: themeId });
  };

  const rowBorder = { borderBottomColor: theme.background };

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: theme.background }]}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
      showsHorizontalScrollIndicator={false}
    >
      {isAuthenticated && (
        <View style={styles.sectionBlock}>
          <Text style={[styles.sectionTitle, { color: theme.textTertiary }]}>
            {t('settings.account')}
          </Text>
          <View style={[styles.card, { backgroundColor: theme.surface }]}>
            <TouchableOpacity
              activeOpacity={0.65}
              style={[styles.settingItem, styles.rowBorder, rowBorder]}
              onPress={() => navigation.navigate('Profile')}
            >
              <View style={[styles.profileAvatar, styles.profileAvatarFallback, { backgroundColor: theme.primary }]}>
                <Ionicons name="sunny" size={22} color="#FFFFFF" />
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
            <TouchableOpacity
              activeOpacity={0.65}
              style={styles.settingItem}
              onPress={() => {
                mixpanel.track('Achievements Teaser Tapped', { source: 'settings' });
                navigation.navigate('Achievements');
              }}
            >
              <View style={[styles.rowIconBubble, { backgroundColor: `${theme.primary}22` }]}>
                <Ionicons name="trophy" size={18} color={theme.primary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.settingItemText, { color: theme.text }]}>
                  {t('profile.badgesTitle')}
                </Text>
                <Text style={[styles.settingItemSubtext, { color: theme.primary }]}>
                  {badgeProgress
                    ? t('profile.badgesUnlockedCount', badgeProgress)
                    : t('settings.achievementsTeaserHint')}
                </Text>
              </View>
              <Text style={[styles.arrow, { color: theme.textSecondary }]}>›</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      <View style={styles.sectionBlock}>
        <Text style={[styles.sectionTitle, { color: theme.textTertiary }]}>
          {t('settings.theme')}
        </Text>
        <View style={[styles.card, { backgroundColor: theme.surface }]}>
          {THEMES.map((themeOption, index) => {
            const selected = currentTheme === themeOption.id;
            const isLast = index === THEMES.length - 1;
            return (
              <TouchableOpacity
                key={themeOption.id}
                activeOpacity={0.65}
                style={[
                  styles.settingItem,
                  !isLast && [styles.rowBorder, rowBorder],
                  selected && { backgroundColor: theme.background },
                ]}
                onPress={() => handleSelectTheme(themeOption.id)}
              >
                <Text style={styles.settingItemFlag}>{themeOption.icon}</Text>
                <Text style={[
                  styles.settingItemText,
                  { color: theme.textSecondary },
                  selected && { fontWeight: '700', color: theme.primary },
                ]}>
                  {t(themeOption.nameKey)}
                </Text>
                {selected && (
                  <Text style={[styles.checkmark, { color: theme.primary }]}>✓</Text>
                )}
              </TouchableOpacity>
            );
          })}
        </View>
      </View>

      <View style={styles.sectionBlock}>
        <Text style={[styles.sectionTitle, { color: theme.textTertiary }]}>
          {t('settings.language')}
        </Text>
        <View style={[styles.card, { backgroundColor: theme.surface }]}>
          {LANGUAGES.map((lang, index) => {
            const selected = i18n.language === lang.code;
            const isLast = index === LANGUAGES.length - 1;
            return (
              <TouchableOpacity
                key={lang.code}
                activeOpacity={0.65}
                style={[
                  styles.settingItem,
                  !isLast && [styles.rowBorder, rowBorder],
                  selected && { backgroundColor: theme.background },
                ]}
                onPress={() => handleSelectLanguage(lang.code)}
              >
                <Text style={styles.settingItemFlag}>{lang.flag}</Text>
                <Text style={[
                  styles.settingItemText,
                  { color: theme.textSecondary },
                  selected && { fontWeight: '700', color: theme.primary },
                ]}>
                  {lang.name}
                </Text>
                {selected && (
                  <Text style={[styles.checkmark, { color: theme.primary }]}>✓</Text>
                )}
              </TouchableOpacity>
            );
          })}
        </View>
      </View>

      <View style={styles.sectionBlock}>
        <Text style={[styles.sectionTitle, { color: theme.textTertiary }]}>
          {t('settings.units')}
        </Text>
        <View style={[styles.card, { backgroundColor: theme.surface }]}>
          {UNIT_OPTIONS.map((option, index) => {
            const selected = option.id === 'imperial' ? useImperial : !useImperial;
            const isLast = index === UNIT_OPTIONS.length - 1;
            return (
              <TouchableOpacity
                key={option.id}
                activeOpacity={0.65}
                style={[
                  styles.settingItem,
                  !isLast && [styles.rowBorder, rowBorder],
                  selected && { backgroundColor: theme.background },
                ]}
                onPress={() => {
                  const next = option.id === 'imperial';
                  if (useImperial === next) return;
                  setUseImperial(next);
                  mixpanel.track('Settings Changed', { setting: 'units', value: option.id });
                }}
              >
                <Text style={[
                  styles.settingItemText,
                  { color: theme.textSecondary },
                  selected && { fontWeight: '700', color: theme.primary },
                ]}>
                  {option.label}
                </Text>
                {selected && (
                  <Text style={[styles.checkmark, { color: theme.primary }]}>✓</Text>
                )}
              </TouchableOpacity>
            );
          })}
        </View>
      </View>

      <View style={styles.sectionBlock}>
        <Text style={[styles.sectionTitle, { color: theme.textTertiary }]}>
          {t('settings.feedback')}
        </Text>
        <View style={[styles.card, { backgroundColor: theme.surface }]}>
          <TouchableOpacity
            activeOpacity={0.65}
            style={styles.settingItem}
            onPress={() => navigation.navigate('Feedback', { source: 'settings' })}
          >
            <Text style={styles.settingItemFlag}>💬</Text>
            <View style={{ flex: 1 }}>
              <Text style={[styles.settingItemText, { color: theme.text }]}>
                {t('settings.feedbackPrompt')}
              </Text>
              <Text style={[styles.settingItemSubtext, { color: theme.primary }]}>
                hola@sunnomad.app
              </Text>
            </View>
            <Text style={[styles.arrow, { color: theme.textSecondary }]}>›</Text>
          </TouchableOpacity>
        </View>
      </View>

      <View style={styles.footer}>
        <View style={styles.legalRow}>
          <TouchableOpacity
            onPress={() => {
              mixpanel.track('Legal Link Tapped', { link: 'privacy' });
              Linking.openURL('https://sunnomad.app/privacy');
            }}
            hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
          >
            <Text style={[styles.legalLink, { color: theme.textSecondary }]}>
              {t('settings.privacyPolicy')}
            </Text>
          </TouchableOpacity>
          <Text style={[styles.legalDivider, { color: theme.textTertiary }]}>·</Text>
          <TouchableOpacity
            onPress={() => {
              mixpanel.track('Legal Link Tapped', { link: 'terms' });
              Linking.openURL('https://sunnomad.app/terms');
            }}
            hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
          >
            <Text style={[styles.legalLink, { color: theme.textSecondary }]}>
              {t('settings.termsOfUse')}
            </Text>
          </TouchableOpacity>
        </View>

        <Text style={[styles.meta, { color: theme.textTertiary }]}>
          {t('settings.weatherAttribution')}
        </Text>
        <Text style={[styles.meta, { color: theme.textTertiary }]}>
          {t('settings.version', { version: APP_VERSION, build: APP_BUILD })}
        </Text>
      </View>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    paddingTop: 8,
    paddingBottom: 16,
  },
  sectionBlock: {
    marginTop: 20,
    paddingHorizontal: 16,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '600',
    letterSpacing: 0.3,
    textTransform: 'uppercase',
    marginBottom: 8,
    marginLeft: 4,
  },
  card: {
    borderRadius: 12,
    overflow: 'hidden',
  },
  settingItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    minHeight: 56,
  },
  rowBorder: {
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  settingItemFlag: {
    fontSize: 26,
    marginRight: 14,
  },
  profileAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    marginRight: 14,
  },
  profileAvatarFallback: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowIconBubble: {
    width: 36,
    height: 36,
    borderRadius: 18,
    marginRight: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  settingItemText: {
    flex: 1,
    fontSize: 17,
    fontWeight: '500',
  },
  checkmark: {
    fontSize: 22,
    fontWeight: 'bold',
  },
  settingItemSubtext: {
    fontSize: 13,
    marginTop: 2,
  },
  arrow: {
    fontSize: 26,
    fontWeight: '300',
  },
  footer: {
    alignItems: 'center',
    paddingTop: 28,
    paddingBottom: 48,
    paddingHorizontal: 24,
    gap: 10,
  },
  legalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    justifyContent: 'center',
    marginBottom: 6,
  },
  legalLink: {
    fontSize: 13,
    fontWeight: '500',
  },
  legalDivider: {
    fontSize: 13,
    marginHorizontal: 10,
    opacity: 0.55,
  },
  meta: {
    fontSize: 12,
    textAlign: 'center',
    lineHeight: 16,
    opacity: 0.65,
  },
});

export default SettingsScreen;
