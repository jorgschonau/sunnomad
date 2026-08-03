import React, { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Alert,
  Image,
  Animated,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useAuth } from '../../contexts/AuthContext';
import { useTheme } from '../../theme/ThemeProvider';
import { useTranslation } from 'react-i18next';
import Ionicons from '@expo/vector-icons/Ionicons';
import { getFavourites } from '../../usecases/favouritesUsecases';
import { mixpanel } from '../../services/mixpanel';
import { getFakeLevel, resolveIronicBadges } from '../../utils/ironicProgress';

const SPARKLES = [
  { dx: -16, dy: -14, delay: 0, size: 11 },
  { dx: 15, dy: -12, delay: 70, size: 13 },
  { dx: -12, dy: 13, delay: 130, size: 10 },
  { dx: 14, dy: 11, delay: 40, size: 12 },
  { dx: 2, dy: -18, delay: 100, size: 10 },
  { dx: 18, dy: 1, delay: 160, size: 9 },
];

function IronicBadgeRow({ badge, isNew, styles, theme, t }) {
  const scale = useRef(new Animated.Value(1)).current;
  const highlightOpacity = useRef(new Animated.Value(isNew ? 0.16 : 0)).current;
  const sparkleProgress = useRef(SPARKLES.map(() => new Animated.Value(0))).current;

  useEffect(() => {
    if (!isNew) return undefined;
    highlightOpacity.setValue(0.16);
    sparkleProgress.forEach((v) => v.setValue(0));

    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(scale, { toValue: 1.18, duration: 320, useNativeDriver: true }),
        Animated.timing(scale, { toValue: 1, duration: 320, useNativeDriver: true }),
      ]),
      { iterations: 3 }
    );
    const sparkleBurst = Animated.stagger(
      50,
      sparkleProgress.map((v, i) =>
        Animated.sequence([
          Animated.delay(SPARKLES[i].delay),
          Animated.timing(v, { toValue: 1, duration: 900, useNativeDriver: true }),
        ])
      )
    );
    // Second lighter burst after first settles
    const sparkleBurst2 = Animated.sequence([
      Animated.delay(1100),
      Animated.parallel(
        sparkleProgress.map((v) =>
          Animated.sequence([
            Animated.timing(v, { toValue: 0, duration: 0, useNativeDriver: true }),
            Animated.timing(v, { toValue: 1, duration: 850, useNativeDriver: true }),
          ])
        )
      ),
    ]);
    const fade = Animated.sequence([
      Animated.delay(2600),
      Animated.timing(highlightOpacity, { toValue: 0, duration: 700, useNativeDriver: true }),
    ]);
    pulse.start();
    sparkleBurst.start();
    sparkleBurst2.start();
    fade.start();
    return () => {
      pulse.stop();
      sparkleBurst.stop();
      sparkleBurst2.stop();
      fade.stop();
      scale.setValue(1);
    };
  }, [isNew, scale, highlightOpacity, sparkleProgress]);

  return (
    <View style={[styles.badgeRow, !badge.earned && !badge.showProgress && styles.badgeRowLocked]}>
      {isNew && (
        <Animated.View
          pointerEvents="none"
          style={[
            styles.badgeRowHighlight,
            { backgroundColor: theme.primary, opacity: highlightOpacity },
          ]}
        />
      )}
      <View style={styles.badgeIconWrap}>
        <Animated.View style={[styles.statIconContainer, { transform: [{ scale }] }]}>
          <Ionicons
            name={badge.earned ? badge.icon : 'lock-closed-outline'}
            size={20}
            color={badge.earned ? theme.primary : theme.textSecondary}
          />
        </Animated.View>
        {isNew &&
          SPARKLES.map((s, i) => {
            const p = sparkleProgress[i];
            return (
              <Animated.View
                key={i}
                pointerEvents="none"
                style={[
                  styles.sparkle,
                  {
                    opacity: p.interpolate({
                      inputRange: [0, 0.2, 0.7, 1],
                      outputRange: [0, 1, 1, 0],
                    }),
                    transform: [
                      {
                        translateX: p.interpolate({
                          inputRange: [0, 1],
                          outputRange: [0, s.dx],
                        }),
                      },
                      {
                        translateY: p.interpolate({
                          inputRange: [0, 1],
                          outputRange: [0, s.dy],
                        }),
                      },
                      {
                        scale: p.interpolate({
                          inputRange: [0, 0.3, 1],
                          outputRange: [0.3, 1.15, 0.4],
                        }),
                      },
                      {
                        rotate: p.interpolate({
                          inputRange: [0, 1],
                          outputRange: ['0deg', '55deg'],
                        }),
                      },
                    ],
                  },
                ]}
              >
                <Ionicons name="sparkles" size={s.size} color={theme.primary} />
              </Animated.View>
            );
          })}
      </View>
      <View style={styles.badgeTextContainer}>
        <Text style={[styles.badgeName, isNew && styles.badgeNameNew]}>{t(badge.nameKey)}</Text>
        {(badge.earned || badge.showProgress) && (
          <Text style={styles.badgeDesc}>
            {badge.descParams ? t(badge.descKey, badge.descParams) : t(badge.descKey)}
          </Text>
        )}
      </View>
    </View>
  );
}

export default function ProfileScreen({ navigation }) {
  const { user, profile, signOut, deleteAccount, isAuthenticated } = useAuth();
  const { theme } = useTheme();
  const { t } = useTranslation();
  const [favouriteCount, setFavouriteCount] = useState(0);
  const [ironicBadges, setIronicBadges] = useState([]);
  const [newlyEarnedIds, setNewlyEarnedIds] = useState([]);
  const ironicStreakKey = useMemo(
    () => `profile.ironicStreak${1 + Math.floor(Math.random() * 4)}`,
    []
  );
  const fakeLevel = useMemo(
    () => getFakeLevel(profile?.app_open_count),
    [profile?.app_open_count]
  );

  useEffect(() => {
    if (newlyEarnedIds.length === 0) return undefined;
    const timer = setTimeout(() => setNewlyEarnedIds([]), 4000);
    return () => clearTimeout(timer);
  }, [newlyEarnedIds]);

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

        const { badges, newlyEarned } = await resolveIronicBadges({
          appOpens: profile?.app_open_count,
          favouriteCount: favCount,
          memberSince: profile?.created_at,
        });
        if (!active) return;
        setIronicBadges(badges);
        if (newlyEarned.length > 0) {
          setNewlyEarnedIds(newlyEarned);
          newlyEarned.forEach((id) => mixpanel.track('Ironic Badge Unlocked', { badge: id }));
        }
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
      {/* Header: Avatar + Name */}
      <View style={styles.header}>
        <View style={styles.avatarContainer}>
          {profile?.avatar_url ? (
            <Image source={{ uri: profile.avatar_url }} style={styles.avatar} />
          ) : (
            <View style={styles.avatarPlaceholder}>
              <Text style={styles.avatarText}>
                {profile?.display_name?.[0]?.toUpperCase() || '?'}
              </Text>
            </View>
          )}
        </View>
        <Text style={styles.displayName}>{profile?.display_name || user?.email}</Text>
        <Text style={styles.fakeLevel}>
          {t('profile.fakeLevelLine', { level: fakeLevel.level, name: t(fakeLevel.nameKey) })}
        </Text>
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

      {/* Stats Card */}
      <View style={styles.statsCard}>
        <TouchableOpacity style={styles.statRow} onPress={() => navigation.navigate('Favourites', { source: 'profile' })}>
          <View style={styles.statIconContainer}>
            <Ionicons name="star-outline" size={20} color={theme.primary} />
          </View>
          <Text style={styles.statLabel}>{t('profile.favourites')}</Text>
          <Text style={styles.statValue}>{favouriteCount}</Text>
          <Ionicons name="chevron-forward" size={16} color={theme.textSecondary} style={{ marginLeft: 6 }} />
        </TouchableOpacity>

        <View style={styles.statDivider} />

        <View style={styles.statRow}>
          <View style={styles.statIconContainer}>
            <Ionicons name="calendar-outline" size={20} color={theme.primary} />
          </View>
          <Text style={styles.statLabel}>{t('profile.memberSince')}</Text>
          <Text style={styles.statValue}>{formatMemberSince()}</Text>
        </View>

      </View>

      {/* Ironic Badges */}
      {ironicBadges.length > 0 && (
        <View style={styles.badgesSection}>
          <View style={styles.badgesTitleRow}>
            <Text style={styles.sectionTitle}>{t('profile.badgesTitle')}</Text>
            <Text style={styles.badgesCount}>
              {t('profile.badgesUnlockedCount', {
                earned: ironicBadges.filter((b) => b.earned).length,
                total: ironicBadges.length,
              })}
            </Text>
          </View>
          <View style={styles.badgesCard}>
            {ironicBadges.map((badge, i) => (
              <View key={badge.id}>
                {i > 0 && <View style={styles.statDivider} />}
                <IronicBadgeRow
                  badge={badge}
                  isNew={newlyEarnedIds.includes(badge.id)}
                  styles={styles}
                  theme={theme}
                  t={t}
                />
              </View>
            ))}
          </View>
        </View>
      )}

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
      paddingBottom: 40,
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

    // ── Header ──
    header: {
      alignItems: 'center',
      paddingTop: 32,
      paddingBottom: 24,
      paddingHorizontal: 20,
    },
    avatarContainer: {
      marginBottom: 16,
    },
    avatar: {
      width: 80,
      height: 80,
      borderRadius: 40,
    },
    avatarPlaceholder: {
      width: 80,
      height: 80,
      borderRadius: 40,
      backgroundColor: theme.primary,
      justifyContent: 'center',
      alignItems: 'center',
      shadowColor: theme.primary,
      shadowOffset: { width: 0, height: 3 },
      shadowOpacity: 0.25,
      shadowRadius: 6,
      elevation: 4,
    },
    avatarText: {
      fontSize: 32,
      fontWeight: 'bold',
      color: '#FFFFFF',
    },
    displayName: {
      fontSize: 22,
      fontWeight: 'bold',
      color: theme.text,
    },
    ironicStreak: {
      fontSize: 13,
      fontStyle: 'italic',
      color: theme.textSecondary,
      marginTop: 6,
      textAlign: 'center',
    },
    fakeLevel: {
      fontSize: 14,
      fontWeight: '700',
      color: theme.primary,
      marginTop: 8,
      textAlign: 'center',
    },
    fakeLevelNext: {
      fontSize: 12,
      color: theme.textSecondary,
      marginTop: 2,
      textAlign: 'center',
    },

    // ── Stats Card ──
    statsCard: {
      backgroundColor: theme.cardBackground || theme.surface,
      borderRadius: 16,
      marginHorizontal: 20,
      paddingVertical: 8,
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.06,
      shadowRadius: 8,
      elevation: 2,
    },
    statRow: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: 14,
      paddingHorizontal: 18,
    },
    statIconContainer: {
      width: 32,
      alignItems: 'center',
    },
    statLabel: {
      flex: 1,
      fontSize: 15,
      color: theme.textSecondary,
      marginLeft: 8,
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

    // ── Ironic Badges ──
    badgesSection: {
      marginTop: 28,
      paddingHorizontal: 20,
    },
    badgesTitleRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'baseline',
    },
    badgesCount: {
      fontSize: 12,
      color: theme.textSecondary,
      marginBottom: 12,
      marginRight: 4,
    },
    badgesCard: {
      backgroundColor: theme.cardBackground || theme.surface,
      borderRadius: 16,
      paddingVertical: 4,
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.06,
      shadowRadius: 8,
      elevation: 2,
    },
    badgeRow: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: 12,
      paddingHorizontal: 18,
    },
    badgeRowLocked: {
      opacity: 0.45,
    },
    badgeRowHighlight: {
      ...StyleSheet.absoluteFillObject,
    },
    badgeIconWrap: {
      width: 32,
      height: 28,
      alignItems: 'center',
      justifyContent: 'center',
    },
    sparkle: {
      position: 'absolute',
      left: 10,
      top: 4,
    },
    badgeTextContainer: {
      flex: 1,
      marginLeft: 8,
    },
    badgeName: {
      fontSize: 15,
      fontWeight: '600',
      color: theme.text,
    },
    badgeNameNew: {
      color: theme.primary,
      fontWeight: '700',
    },
    badgeDesc: {
      fontSize: 12,
      fontStyle: 'italic',
      color: theme.textSecondary,
      marginTop: 2,
    },

    // ── Actions ──
    actionsSection: {
      marginTop: 28,
      paddingHorizontal: 20,
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
