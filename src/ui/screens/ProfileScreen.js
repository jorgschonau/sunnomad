import React, { useState, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Alert,
  Image,
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

export default function ProfileScreen({ navigation }) {
  const { user, profile, signOut, deleteAccount, isAuthenticated } = useAuth();
  const { theme } = useTheme();
  const { t } = useTranslation();
  const [favouriteCount, setFavouriteCount] = useState(0);
  const [badgeProgress, setBadgeProgress] = useState(null);
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
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.scrollContent}
      showsVerticalScrollIndicator={false}
      showsHorizontalScrollIndicator={false}
    >
      <LinearGradient
        colors={[theme.primaryDark || theme.primary, theme.primary, theme.primaryLight || theme.primary]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.banner}
      >
        <View style={styles.avatarRing}>
          {profile?.avatar_url ? (
            <Image source={{ uri: profile.avatar_url }} style={styles.avatar} />
          ) : (
            <View style={styles.avatarPlaceholder}>
              <Text style={styles.avatarText}>
                {profile?.display_name?.[0]?.toUpperCase() || user?.email?.[0]?.toUpperCase() || '?'}
              </Text>
            </View>
          )}
        </View>
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
      </LinearGradient>

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
    </ScrollView>
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
      paddingVertical: 16,
      paddingHorizontal: 18,
      marginBottom: 14,
      alignItems: 'center',
      overflow: 'hidden',
    },
    avatarRing: {
      width: 64,
      height: 64,
      borderRadius: 32,
      padding: 2,
      backgroundColor: 'rgba(255,255,255,0.35)',
      marginBottom: 8,
      alignItems: 'center',
      justifyContent: 'center',
    },
    avatar: {
      width: 60,
      height: 60,
      borderRadius: 30,
    },
    avatarPlaceholder: {
      width: 60,
      height: 60,
      borderRadius: 30,
      backgroundColor: 'rgba(255,255,255,0.22)',
      justifyContent: 'center',
      alignItems: 'center',
    },
    avatarText: {
      fontSize: 24,
      fontWeight: '800',
      color: '#FFFFFF',
    },
    displayName: {
      fontSize: 20,
      fontWeight: '800',
      color: '#FFFFFF',
      textAlign: 'center',
      letterSpacing: -0.3,
    },
    levelPill: {
      marginTop: 8,
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
      marginTop: 4,
      textAlign: 'center',
    },
    ironicStreak: {
      fontSize: 12,
      fontStyle: 'italic',
      color: 'rgba(255,255,255,0.85)',
      marginTop: 6,
      textAlign: 'center',
      lineHeight: 16,
      paddingHorizontal: 4,
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
