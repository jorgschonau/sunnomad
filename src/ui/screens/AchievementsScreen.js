import React, { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Animated,
  TouchableOpacity,
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
import { resolveIronicBadges } from '../../utils/ironicProgress';

// Dev only: left/right arrows + filename on banner
const HEADER_PREVIEW_SWITCH = __DEV__;

const ACHIEVEMENTS_HEADER_IMAGES = [
  require('../../../assets/achievements_header_1.jpg'),
  require('../../../assets/achievements_header_2.jpg'),
  require('../../../assets/achievements_header_3.jpg'),
  require('../../../assets/achievements_header_4.jpg'),
  require('../../../assets/achievements_header_5.jpg'),
];
const ACHIEVEMENTS_HEADER_NAMES = [
  'achievements_header_1.jpg',
  'achievements_header_2.jpg',
  'achievements_header_3.jpg',
  'achievements_header_4.jpg',
  'achievements_header_5.jpg',
];
const BANNER_PARALLAX = 28;
const BANNER_MIN_HEIGHT = 196;

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
      { iterations: 6 }
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
      Animated.delay(1400),
      Animated.parallel(
        sparkleProgress.map((v) =>
          Animated.sequence([
            Animated.timing(v, { toValue: 0, duration: 0, useNativeDriver: true }),
            Animated.timing(v, { toValue: 1, duration: 900, useNativeDriver: true }),
          ])
        )
      ),
    ]);
    const sparkleBurst3 = Animated.sequence([
      Animated.delay(3200),
      Animated.parallel(
        sparkleProgress.map((v) =>
          Animated.sequence([
            Animated.timing(v, { toValue: 0, duration: 0, useNativeDriver: true }),
            Animated.timing(v, { toValue: 1, duration: 900, useNativeDriver: true }),
          ])
        )
      ),
    ]);
    const fade = Animated.sequence([
      Animated.delay(6000),
      Animated.timing(highlightOpacity, { toValue: 0, duration: 900, useNativeDriver: true }),
    ]);
    pulse.start();
    sparkleBurst.start();
    sparkleBurst2.start();
    sparkleBurst3.start();
    fade.start();
    return () => {
      pulse.stop();
      sparkleBurst.stop();
      sparkleBurst2.stop();
      sparkleBurst3.stop();
      fade.stop();
      scale.setValue(1);
    };
  }, [isNew, scale, highlightOpacity, sparkleProgress]);

  const showIcon = badge.earned || badge.showProgress;
  const iconName = showIcon ? badge.icon : 'lock-closed-outline';
  const progressCount = badge.descParams?.count;
  const inProgress =
    !badge.earned &&
    !!badge.showProgress &&
    typeof progressCount === 'number' &&
    progressCount > 0;
  const iconColor = badge.earned || inProgress
    ? theme.primary
    : (theme.textTertiary || theme.textSecondary);

  const progressTotal = badge.descParams?.total;
  const showProgressBar =
    typeof progressCount === 'number' &&
    typeof progressTotal === 'number' &&
    progressTotal > 0 &&
    (badge.earned || badge.showProgress);
  const progressRatio = showProgressBar
    ? Math.min(1, Math.max(0, progressCount / progressTotal))
    : 0;

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
            inProgress && styles.iconBubbleProgress,
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
            badge.earned || isNew
              ? styles.badgeNameEarned
              : inProgress
                ? styles.badgeNameProgress
                : styles.badgeNameLocked,
          ]}
        >
          {t(badge.nameKey)}
        </Text>
        {(badge.earned || badge.showProgress) && (
          <Text style={[styles.badgeDesc, inProgress && styles.badgeDescProgress]}>
            {badge.descParams ? t(badge.descKey, badge.descParams) : t(badge.descKey)}
          </Text>
        )}
        {showProgressBar && (
          <View style={styles.progressTrack}>
            <View
              style={[
                styles.progressFill,
                {
                  width: `${progressRatio * 100}%`,
                  backgroundColor: badge.earned
                    ? theme.primary
                    : theme.primaryLight || theme.primary,
                },
              ]}
            />
          </View>
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
  const [headerIndex, setHeaderIndex] = useState(0);
  const styles = useMemo(() => createStyles(theme), [theme]);

  useEffect(() => {
    if (newlyEarnedIds.length === 0) return undefined;
    const timer = setTimeout(() => setNewlyEarnedIds([]), 8000);
    return () => clearTimeout(timer);
  }, [newlyEarnedIds]);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      if (!HEADER_PREVIEW_SWITCH) {
        setHeaderIndex(Math.floor(Math.random() * ACHIEVEMENTS_HEADER_IMAGES.length));
      }
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
  const earlyBadges = ironicBadges.filter((b) => b.group !== 'later');
  const laterBadges = ironicBadges.filter((b) => b.group === 'later');
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

  const renderBadgeCard = (badges) => (
    <View style={styles.badgesCard}>
      {badges.map((badge, i) => (
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
  );

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
          source={ACHIEVEMENTS_HEADER_IMAGES[headerIndex]}
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
          <View style={styles.bannerTitleRow}>
            <Ionicons name="trophy" size={16} color="#FFFFFF" style={styles.bannerTitleIcon} />
            <Text style={styles.bannerTitle}>{t('profile.badgesBannerTitle')}</Text>
          </View>
          <Text style={styles.bannerSubtitle}>
            {t('profile.badgesBannerSubtitle')}
          </Text>
          {ironicBadges.length > 0 ? (
            <View style={styles.bannerScorePill}>
              <Text style={styles.bannerScoreText}>
                {earnedCount} / {ironicBadges.length} {t('profile.badgesUnlockedSuffix')}
              </Text>
            </View>
          ) : (
            <Text style={styles.bannerHint}>{t('settings.achievementsTeaserHint')}</Text>
          )}
        </View>
        {HEADER_PREVIEW_SWITCH && (
          <>
            <TouchableOpacity
              style={[styles.headerNavBtn, styles.headerNavLeft]}
              onPress={() =>
                setHeaderIndex(
                  (i) =>
                    (i - 1 + ACHIEVEMENTS_HEADER_IMAGES.length) %
                    ACHIEVEMENTS_HEADER_IMAGES.length
                )
              }
              hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            >
              <Ionicons name="chevron-back" size={22} color="#FFFFFF" />
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.headerNavBtn, styles.headerNavRight]}
              onPress={() =>
                setHeaderIndex((i) => (i + 1) % ACHIEVEMENTS_HEADER_IMAGES.length)
              }
              hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            >
              <Ionicons name="chevron-forward" size={22} color="#FFFFFF" />
            </TouchableOpacity>
            <View style={styles.headerFilePill} pointerEvents="none">
              <Text style={styles.headerFileText}>
                {headerIndex + 1}/{ACHIEVEMENTS_HEADER_IMAGES.length}{' '}
                {ACHIEVEMENTS_HEADER_NAMES[headerIndex]}
              </Text>
            </View>
          </>
        )}
      </View>

      {earlyBadges.length > 0 && (
        <View style={styles.badgeSection}>
          <Text style={styles.sectionTitle}>{t('profile.badgesGroupEarly')}</Text>
          {renderBadgeCard(earlyBadges)}
        </View>
      )}
      {laterBadges.length > 0 && (
        <View style={styles.badgeSection}>
          <Text style={styles.sectionTitle}>{t('profile.badgesGroupLater')}</Text>
          {renderBadgeCard(laterBadges)}
        </View>
      )}
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
    bannerTitleRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 7,
      paddingHorizontal: 4,
    },
    bannerTitleIcon: {
      marginTop: 1,
      textShadowColor: 'rgba(0,0,0,0.45)',
      textShadowOffset: { width: 0, height: 1 },
      textShadowRadius: 4,
    },
    bannerTitle: {
      fontSize: 20,
      fontWeight: '800',
      color: '#FFFFFF',
      textAlign: 'center',
      letterSpacing: -0.3,
      textShadowColor: 'rgba(0,0,0,0.45)',
      textShadowOffset: { width: 0, height: 1 },
      textShadowRadius: 4,
    },
    bannerSubtitle: {
      marginTop: 12,
      fontSize: 13,
      lineHeight: 19,
      color: 'rgba(255,255,255,0.88)',
      textAlign: 'center',
      paddingHorizontal: 4,
    },
    bannerScorePill: {
      marginTop: 'auto',
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
      marginTop: 'auto',
      fontSize: 13,
      color: 'rgba(255,255,255,0.8)',
      textAlign: 'center',
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
      fontFamily: Platform?.OS === 'ios' ? 'Menlo' : 'monospace',
    },
    badgeSection: {
      marginBottom: 14,
    },
    sectionTitle: {
      fontSize: 16,
      fontWeight: '700',
      color: theme.textSecondary,
      marginBottom: 8,
      marginLeft: 4,
      letterSpacing: 0.2,
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
      color: theme.textTertiary || theme.textSecondary,
    },
    badgeNameProgress: {
      fontWeight: '700',
      color: theme.text,
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
    progressTrack: {
      marginTop: 8,
      height: 4,
      borderRadius: 2,
      backgroundColor: theme.border ? `${theme.border}55` : 'rgba(0,0,0,0.08)',
      overflow: 'hidden',
    },
    progressFill: {
      height: '100%',
      borderRadius: 2,
    },
  });
