import React, { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Animated,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { LinearGradient } from 'expo-linear-gradient';
import { useAuth } from '../../contexts/AuthContext';
import { useTheme } from '../../theme/ThemeProvider';
import { useTranslation } from 'react-i18next';
import Ionicons from '@expo/vector-icons/Ionicons';
import { getFavourites } from '../../usecases/favouritesUsecases';
import { mixpanel } from '../../services/mixpanel';
import { resolveIronicBadges } from '../../utils/ironicProgress';

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

  const showIcon = badge.earned || badge.showProgress;
  const iconName = showIcon ? badge.icon : 'lock-closed-outline';
  const iconColor = badge.earned || badge.showProgress
    ? theme.primary
    : (theme.textTertiary || theme.textSecondary);

  return (
    <View style={[styles.badgeRow, badge.earned && styles.badgeRowEarned]}>
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
        <Animated.View
          style={[
            styles.iconBubble,
            badge.earned && styles.iconBubbleEarned,
            badge.showProgress && !badge.earned && styles.iconBubbleProgress,
            { transform: [{ scale }] },
          ]}
        >
          <Ionicons name={iconName} size={18} color={iconColor} />
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
        <Text
          style={[
            styles.badgeName,
            !badge.earned && !badge.showProgress && styles.badgeNameLocked,
            (badge.earned || isNew) && styles.badgeNameEarned,
          ]}
        >
          {t(badge.nameKey)}
        </Text>
        {(badge.earned || badge.showProgress) && (
          <Text style={[styles.badgeDesc, badge.showProgress && !badge.earned && styles.badgeDescProgress]}>
            {badge.descParams ? t(badge.descKey, badge.descParams) : t(badge.descKey)}
          </Text>
        )}
      </View>
    </View>
  );
}

export default function AchievementsScreen() {
  const { profile } = useAuth();
  const { theme } = useTheme();
  const { t } = useTranslation();
  const [ironicBadges, setIronicBadges] = useState([]);
  const [newlyEarnedIds, setNewlyEarnedIds] = useState([]);
  const styles = useMemo(() => createStyles(theme), [theme]);

  useEffect(() => {
    if (newlyEarnedIds.length === 0) return undefined;
    const timer = setTimeout(() => setNewlyEarnedIds([]), 4000);
    return () => clearTimeout(timer);
  }, [newlyEarnedIds]);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      const load = async () => {
        let favCount = 0;
        try {
          const favs = await getFavourites();
          favCount = favs.length;
        } catch {
          favCount = 0;
        }
        const { badges, newlyEarned } = await resolveIronicBadges({
          appOpens: profile?.app_open_count,
          favouriteCount: favCount,
          memberSince: profile?.created_at,
        });
        if (!active) return;
        setIronicBadges(badges);
        const earned = badges.filter((b) => b.earned).length;
        mixpanel.track('Achievements Viewed', {
          source: 'achievements',
          earned,
          total: badges.length,
        });
        if (newlyEarned.length > 0) {
          setNewlyEarnedIds(newlyEarned);
          newlyEarned.forEach((id) =>
            mixpanel.track('Ironic Badge Unlocked', { badge: id, source: 'achievements' })
          );
        }
      };
      load().catch(() => {});
      return () => {
        active = false;
      };
    }, [profile?.app_open_count, profile?.created_at])
  );

  const earnedCount = ironicBadges.filter((b) => b.earned).length;

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
        <View style={styles.bannerIconWrap}>
          <Ionicons name="trophy" size={28} color="#FFFFFF" />
        </View>
        <Text style={styles.bannerTitle}>{t('profile.badgesBannerTitle')}</Text>
        <Text style={styles.bannerSubtitle}>{t('profile.badgesBannerSubtitle')}</Text>
        {ironicBadges.length > 0 ? (
          <View style={styles.bannerScorePill}>
            <Text style={styles.bannerScoreText}>
              {earnedCount} / {ironicBadges.length} {t('profile.badgesUnlockedSuffix')}
            </Text>
          </View>
        ) : (
          <Text style={styles.bannerHint}>{t('settings.achievementsTeaserHint')}</Text>
        )}
      </LinearGradient>

      {ironicBadges.length > 0 && (
        <View style={styles.badgesCard}>
          {ironicBadges.map((badge, i) => (
            <View key={badge.id}>
              {i > 0 && <View style={styles.divider} />}
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
      )}
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
    banner: {
      borderRadius: 16,
      paddingVertical: 16,
      paddingHorizontal: 18,
      marginBottom: 14,
      alignItems: 'center',
      overflow: 'hidden',
    },
    bannerIconWrap: {
      width: 44,
      height: 44,
      borderRadius: 22,
      backgroundColor: 'rgba(255,255,255,0.18)',
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: 8,
    },
    bannerTitle: {
      fontSize: 20,
      fontWeight: '800',
      color: '#FFFFFF',
      textAlign: 'center',
      letterSpacing: -0.3,
    },
    bannerSubtitle: {
      marginTop: 4,
      fontSize: 13,
      lineHeight: 17,
      color: 'rgba(255,255,255,0.88)',
      textAlign: 'center',
      paddingHorizontal: 4,
    },
    bannerScorePill: {
      marginTop: 10,
      paddingHorizontal: 14,
      paddingVertical: 8,
      borderRadius: 12,
      backgroundColor: 'rgba(255,255,255,0.2)',
    },
    bannerScoreText: {
      fontSize: 14,
      fontWeight: '700',
      color: '#FFFFFF',
    },
    bannerHint: {
      marginTop: 16,
      fontSize: 13,
      color: 'rgba(255,255,255,0.8)',
      textAlign: 'center',
    },
    badgesCard: {
      backgroundColor: theme.cardBackground || theme.surface,
      borderRadius: 16,
      paddingVertical: 6,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.border || 'rgba(0,0,0,0.08)',
      shadowColor: theme.primary,
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.08,
      shadowRadius: 12,
      elevation: 3,
    },
    divider: {
      height: StyleSheet.hairlineWidth,
      backgroundColor: theme.border || 'rgba(0,0,0,0.08)',
      marginHorizontal: 16,
    },
    badgeRow: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: 14,
      paddingHorizontal: 16,
    },
    badgeRowEarned: {
      backgroundColor: `${theme.primary}08`,
    },
    badgeRowHighlight: {
      ...StyleSheet.absoluteFillObject,
    },
    badgeIconWrap: {
      width: 40,
      height: 40,
      alignItems: 'center',
      justifyContent: 'center',
    },
    iconBubble: {
      width: 36,
      height: 36,
      borderRadius: 18,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: theme.background,
    },
    iconBubbleEarned: {
      backgroundColor: `${theme.primary}22`,
    },
    iconBubbleProgress: {
      backgroundColor: `${theme.primary}14`,
    },
    sparkle: {
      position: 'absolute',
      left: 14,
      top: 8,
    },
    badgeTextContainer: {
      flex: 1,
      marginLeft: 12,
    },
    badgeName: {
      fontSize: 16,
      fontWeight: '700',
      color: theme.text,
    },
    badgeNameLocked: {
      fontWeight: '600',
      color: theme.textSecondary,
    },
    badgeNameEarned: {
      color: theme.primaryDark || theme.primary,
      fontWeight: '700',
    },
    badgeDesc: {
      fontSize: 13,
      fontStyle: 'italic',
      color: theme.textSecondary,
      marginTop: 3,
      lineHeight: 18,
    },
    badgeDescProgress: {
      fontStyle: 'normal',
      fontWeight: '500',
      color: theme.text,
    },
  });
