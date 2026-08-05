import React, { useState, useCallback, useMemo, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Alert,
  Animated,
  Platform,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { LinearGradient } from 'expo-linear-gradient';
import { useAuth } from '../../contexts/AuthContext';
import { useTheme } from '../../theme/ThemeProvider';
import { useTranslation } from 'react-i18next';
import Ionicons from '@expo/vector-icons/Ionicons';
import { getFavourites } from '../../usecases/favouritesUsecases';
import { mixpanel } from '../../services/mixpanel';
import { getFakeLevel, resolveIronicBadges } from '../../utils/ironicProgress';

// Dev only: left/right arrows + filename on banner
const HEADER_PREVIEW_SWITCH = __DEV__;

const PROFILE_HEADER_IMAGES = [
  require('../../../assets/profile_header_1.jpg'),
  require('../../../assets/profile_header_2.jpg'),
  require('../../../assets/profile_header_3.jpg'),
  require('../../../assets/profile_header_4.jpg'),
  require('../../../assets/profile_header_5.jpg'),
  require('../../../assets/profile_header_6.jpg'),
  require('../../../assets/profile_header_7.jpg'),
];
const PROFILE_HEADER_NAMES = [
  'profile_header_1.jpg',
  'profile_header_2.jpg',
  'profile_header_3.jpg',
  'profile_header_4.jpg',
  'profile_header_5.jpg',
  'profile_header_6.jpg',
  'profile_header_7.jpg',
];
const BANNER_PARALLAX = 28;
const BANNER_MIN_HEIGHT = 196;

export default function ProfileScreen({ navigation }) {
  const { user, profile, signOut, deleteAccount, isAuthenticated } = useAuth();
  const { theme } = useTheme();
  const { t } = useTranslation();
  const [favouriteCount, setFavouriteCount] = useState(0);
  const [badgeProgress, setBadgeProgress] = useState(null);
  const [headerIndex, setHeaderIndex] = useState(0);
  const ironicStreakKey = useMemo(
    () => `profile.ironicStreak${1 + Math.floor(Math.random() * 4)}`,
    []
  );
  const fakeLevel = useMemo(
    () => getFakeLevel(profile?.app_open_count),
    [profile?.app_open_count]
  );

  useFocusEffect(
    useCallback(() => {
      let active = true;
      if (!HEADER_PREVIEW_SWITCH) {
        setHeaderIndex(Math.floor(Math.random() * PROFILE_HEADER_IMAGES.length));
      }

      mixpanel.track('Profile Opened');
      const loadCount = async () => {
        let favCount = 0;
        try {
          const favs = await getFavourites();
          favCount = favs.length;
        } catch {
          favCount = 0;
        }
        if (!active) return;
        setFavouriteCount(favCount);

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
      };
      loadCount();
      return () => {
        active = false;
      };
    }, [profile?.app_open_count, profile?.created_at])
  );

  const handleSignOut = () => {
    Alert.alert(
      t('auth.signOut'),
      t('auth.confirmSignOut'),
      [
        { text: t('app.back'), style: 'cancel' },
        {
          text: t('auth.signOut'),
          style: 'destructive',
          onPress: async () => {
            await signOut();
          },
        },
      ]
    );
  };

  const handleDeleteAccount = () => {
    Alert.alert(
      t('profile.deleteAccountConfirmTitle'),
      t('profile.deleteAccountConfirmMessage'),
      [
        { text: t('app.back'), style: 'cancel' },
        {
          text: t('profile.deleteAccount'),
          style: 'destructive',
          onPress: async () => {
            const { error } = await deleteAccount();
            if (error) {
              Alert.alert(t('auth.error'), t('profile.deleteAccountFailed'));
            }
          },
        },
      ]
    );
  };

  const formatMemberSince = () => {
    if (!profile?.created_at) return '';
    const date = new Date(profile.created_at);
    return date.toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
  };

  const styles = useMemo(() => createStyles(theme), [theme]);
  const scrollY = useRef(new Animated.Value(0)).current;
  const bannerImageTranslateY = scrollY.interpolate({
    inputRange: [-80, 0, 180],
    outputRange: [-BANNER_PARALLAX * 0.6, 0, BANNER_PARALLAX],
    extrapolate: 'clamp',
  });
  const bannerImageScale = scrollY.interpolate({
    inputRange: [-80, 0],
    outputRange: [1.08, 1],
    extrapolate: 'clamp',
  });

  if (!isAuthenticated) {
    return (
      <View style={styles.container}>
        <View style={styles.centerContent}>
          <Text style={styles.logo}>☀️</Text>
          <Text style={styles.notLoggedInTitle}>{t('auth.notLoggedIn')}</Text>
          <Text style={styles.notLoggedInText}>{t('auth.loginToAccessProfile')}</Text>
          <TouchableOpacity
            style={styles.primaryButton}
            onPress={() => signOut()}
          >
            <Text style={styles.primaryButtonText}>{t('auth.login')}</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <Animated.ScrollView
      style={styles.container}
      contentContainerStyle={styles.scrollContent}
      showsVerticalScrollIndicator={false}
      showsHorizontalScrollIndicator={false}
      scrollEventThrottle={16}
      onScroll={Animated.event(
        [{ nativeEvent: { contentOffset: { y: scrollY } } }],
        { useNativeDriver: true }
      )}
    >
      <View style={styles.banner}>
        <Animated.Image
          source={PROFILE_HEADER_IMAGES[headerIndex]}
          style={[
            styles.bannerImage,
            {
              transform: [
                { translateY: bannerImageTranslateY },
                { scale: bannerImageScale },
              ],
            },
          ]}
          resizeMode="cover"
        />
        <LinearGradient
          pointerEvents="none"
          colors={['rgba(0,0,0,0.04)', 'rgba(0,0,0,0.12)', 'rgba(0,0,0,0.32)']}
          locations={[0, 0.4, 1]}
          start={{ x: 0.5, y: 0 }}
          end={{ x: 0.5, y: 1 }}
          style={styles.bannerScrim}
        />
        <View style={styles.bannerContent}>
          <Text style={styles.displayName}>{profile?.display_name || user?.email}</Text>
          <View style={styles.levelPill}>
            <Text style={styles.fakeLevel}>
              {t('profile.fakeLevelLine', { level: fakeLevel.level, name: t(fakeLevel.nameKey) })}
            </Text>
          </View>
          {fakeLevel.nextNameKey && (
            <Text style={styles.fakeLevelNext}>
              {t('profile.fakeLevelNext', { name: t(fakeLevel.nextNameKey) })}
            </Text>
          )}
          {profile?.app_open_count > 0 && (
            <Text style={styles.ironicStreak}>
              {t(ironicStreakKey, { count: profile.app_open_count })}
            </Text>
          )}
        </View>
        {HEADER_PREVIEW_SWITCH && (
          <>
            <TouchableOpacity
              style={[styles.headerNavBtn, styles.headerNavLeft]}
              onPress={() =>
                setHeaderIndex(
                  (i) =>
                    (i - 1 + PROFILE_HEADER_IMAGES.length) % PROFILE_HEADER_IMAGES.length
                )
              }
              hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            >
              <Ionicons name="chevron-back" size={22} color="#FFFFFF" />
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.headerNavBtn, styles.headerNavRight]}
              onPress={() =>
                setHeaderIndex((i) => (i + 1) % PROFILE_HEADER_IMAGES.length)
              }
              hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            >
              <Ionicons name="chevron-forward" size={22} color="#FFFFFF" />
            </TouchableOpacity>
            <View style={styles.headerFilePill} pointerEvents="none">
              <Text style={styles.headerFileText}>
                {headerIndex + 1}/{PROFILE_HEADER_IMAGES.length}{' '}
                {PROFILE_HEADER_NAMES[headerIndex]}
              </Text>
            </View>
          </>
        )}
      </View>

      {/* Stats Card */}
      <View style={styles.statsCard}>
        <TouchableOpacity style={styles.statRow} onPress={() => navigation.navigate('Favourites', { source: 'profile' })}>
          <View style={[styles.statIconBubble, { backgroundColor: `${theme.primary}18` }]}>
            <Ionicons name="star" size={18} color={theme.primary} />
          </View>
          <Text style={styles.statLabel}>{t('profile.favourites')}</Text>
          <Text style={styles.statValue}>{favouriteCount}</Text>
          <Ionicons name="chevron-forward" size={16} color={theme.textSecondary} style={{ marginLeft: 6 }} />
        </TouchableOpacity>

        <View style={styles.statDivider} />

        <TouchableOpacity
          style={styles.statRow}
          onPress={() => {
            mixpanel.track('Achievements Teaser Tapped', { source: 'profile' });
            navigation.navigate('Achievements');
          }}
        >
          <View style={[styles.statIconBubble, { backgroundColor: `${theme.primary}18` }]}>
            <Ionicons name="trophy" size={18} color={theme.primary} />
          </View>
          <Text style={styles.statLabel}>{t('profile.badgesTitle')}</Text>
          <Text style={[styles.statValue, { color: theme.primary }]}>
            {badgeProgress ? `${badgeProgress.earned}/${badgeProgress.total}` : '—'}
          </Text>
          <Ionicons name="chevron-forward" size={16} color={theme.textSecondary} style={{ marginLeft: 6 }} />
        </TouchableOpacity>

        <View style={styles.statDivider} />

        <View style={styles.statRow}>
          <View style={[styles.statIconBubble, { backgroundColor: `${theme.primary}18` }]}>
            <Ionicons name="calendar" size={18} color={theme.primary} />
          </View>
          <Text style={styles.statLabel}>{t('profile.memberSince')}</Text>
          <Text style={styles.statValue}>{formatMemberSince()}</Text>
        </View>

      </View>

      {/* Actions */}
      <View style={styles.actionsSection}>
        <Text style={styles.sectionTitle}>{t('profile.actions')}</Text>

        <View style={styles.outlineButton}>
          <Ionicons name="mail-outline" size={20} color={theme.primary} style={styles.actionIcon} />
          <Text style={styles.emailText} numberOfLines={1}>{user?.email}</Text>
        </View>

        <TouchableOpacity
          style={styles.outlineButton}
          onPress={() => {
            mixpanel.track('Change Password Link Tapped');
            navigation.navigate('ChangePassword');
          }}
        >
          <Ionicons name="lock-closed-outline" size={20} color={theme.primary} style={styles.actionIcon} />
          <Text style={styles.outlineButtonText}>{t('profile.changePassword')}</Text>
          <Ionicons name="chevron-forward" size={18} color={theme.textSecondary} />
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.outlineButton}
          onPress={() => navigation.navigate('Settings')}
        >
          <Ionicons name="settings-outline" size={20} color={theme.primary} style={styles.actionIcon} />
          <Text style={styles.outlineButtonText}>{t('app.settings')}</Text>
          <Ionicons name="chevron-forward" size={18} color={theme.textSecondary} />
        </TouchableOpacity>
      </View>

      {/* Sign out */}
      <TouchableOpacity style={styles.signOutLink} onPress={handleSignOut}>
        <Text style={styles.signOutText}>{t('auth.signOut')}</Text>
      </TouchableOpacity>

      {/* Delete account */}
      <TouchableOpacity style={styles.signOutLink} onPress={handleDeleteAccount}>
        <Text style={styles.deleteAccountText}>{t('profile.deleteAccount')}</Text>
      </TouchableOpacity>
    </Animated.ScrollView>
  );
}

const createStyles = (theme) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: theme.background,
    },
    scrollContent: {
      paddingTop: 12,
      paddingBottom: 40,
      paddingHorizontal: 20,
    },

    // ── Not logged in ──
    centerContent: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
      padding: 20,
    },
    logo: {
      fontSize: 80,
      marginBottom: 20,
    },
    notLoggedInTitle: {
      fontSize: 24,
      fontWeight: 'bold',
      color: theme.text,
      marginBottom: 10,
    },
    notLoggedInText: {
      fontSize: 16,
      color: theme.textSecondary,
      textAlign: 'center',
      marginBottom: 30,
    },
    primaryButton: {
      backgroundColor: theme.primary,
      borderRadius: 12,
      padding: 16,
      alignItems: 'center',
      width: '100%',
      maxWidth: 300,
    },
    primaryButtonText: {
      color: '#FFFFFF',
      fontSize: 16,
      fontWeight: 'bold',
    },

    // ── Banner ──
    banner: {
      borderRadius: 16,
      marginBottom: 14,
      overflow: 'hidden',
      backgroundColor: '#1a1a1a',
      minHeight: BANNER_MIN_HEIGHT,
    },
    bannerImage: {
      position: 'absolute',
      left: 0,
      right: 0,
      top: -BANNER_PARALLAX,
      height: BANNER_MIN_HEIGHT + BANNER_PARALLAX * 2,
      width: '100%',
    },
    bannerScrim: {
      ...StyleSheet.absoluteFillObject,
    },
    bannerContent: {
      minHeight: BANNER_MIN_HEIGHT,
      paddingTop: 22,
      paddingBottom: 16,
      paddingHorizontal: 18,
      alignItems: 'center',
      justifyContent: 'flex-start',
      zIndex: 1,
    },
    displayName: {
      fontSize: 20,
      fontWeight: '800',
      color: '#FFFFFF',
      textAlign: 'center',
      letterSpacing: -0.3,
      textShadowColor: 'rgba(0,0,0,0.45)',
      textShadowOffset: { width: 0, height: 1 },
      textShadowRadius: 4,
    },
    levelPill: {
      marginTop: 12,
      paddingHorizontal: 10,
      paddingVertical: 4,
      borderRadius: 10,
      backgroundColor: 'rgba(255,255,255,0.2)',
    },
    fakeLevel: {
      fontSize: 12,
      fontWeight: '700',
      color: '#FFFFFF',
      textAlign: 'center',
    },
    fakeLevelNext: {
      fontSize: 11,
      color: 'rgba(255,255,255,0.8)',
      marginTop: 6,
      textAlign: 'center',
    },
    ironicStreak: {
      fontSize: 12,
      fontStyle: 'italic',
      color: 'rgba(255,255,255,0.85)',
      marginTop: 'auto',
      textAlign: 'center',
      lineHeight: 16,
      paddingHorizontal: 4,
    },
    headerNavBtn: {
      position: 'absolute',
      top: '50%',
      marginTop: -18,
      width: 36,
      height: 36,
      borderRadius: 18,
      backgroundColor: 'rgba(0,0,0,0.45)',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 2,
    },
    headerNavLeft: {
      left: 8,
    },
    headerNavRight: {
      right: 8,
    },
    headerFilePill: {
      position: 'absolute',
      left: 10,
      right: 10,
      bottom: 8,
      paddingHorizontal: 10,
      paddingVertical: 5,
      borderRadius: 8,
      backgroundColor: 'rgba(0,0,0,0.55)',
      zIndex: 2,
    },
    headerFileText: {
      fontSize: 11,
      fontWeight: '600',
      color: '#FFFFFF',
      textAlign: 'center',
      fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    },

    // ── Stats Card ──
    statsCard: {
      backgroundColor: theme.cardBackground || theme.surface,
      borderRadius: 16,
      paddingVertical: 8,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.border || 'rgba(0,0,0,0.08)',
      shadowColor: theme.primary,
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.08,
      shadowRadius: 12,
      elevation: 3,
    },
    statRow: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: 14,
      paddingHorizontal: 16,
    },
    statIconBubble: {
      width: 36,
      height: 36,
      borderRadius: 18,
      alignItems: 'center',
      justifyContent: 'center',
    },
    statLabel: {
      flex: 1,
      fontSize: 15,
      color: theme.textSecondary,
      marginLeft: 12,
    },
    statValue: {
      fontSize: 15,
      fontWeight: '700',
      color: theme.text,
    },
    emailText: {
      flex: 1,
      fontSize: 15,
      color: theme.text,
    },
    statDivider: {
      height: 1,
      backgroundColor: theme.border || 'rgba(0,0,0,0.06)',
      marginHorizontal: 18,
    },

    // ── Actions ──
    actionsSection: {
      marginTop: 28,
    },
    sectionTitle: {
      fontSize: 13,
      fontWeight: '700',
      color: theme.textSecondary,
      textTransform: 'uppercase',
      letterSpacing: 0.8,
      marginBottom: 12,
      marginLeft: 4,
    },
    outlineButton: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: theme.cardBackground || theme.surface,
      borderRadius: 12,
      padding: 16,
      marginBottom: 10,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.border || 'rgba(0,0,0,0.08)',
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 1 },
      shadowOpacity: 0.04,
      shadowRadius: 4,
      elevation: 1,
    },
    actionIcon: {
      marginRight: 12,
    },
    outlineButtonText: {
      flex: 1,
      fontSize: 16,
      fontWeight: '600',
      color: theme.text,
    },

    // ── Sign Out ──
    signOutLink: {
      alignItems: 'center',
      marginTop: 32,
      paddingVertical: 12,
    },
    signOutText: {
      fontSize: 14,
      color: '#EF4444',
      fontWeight: '600',
    },
    deleteAccountText: {
      fontSize: 13,
      color: theme.textTertiary || theme.textSecondary,
      fontWeight: '500',
    },
  });
