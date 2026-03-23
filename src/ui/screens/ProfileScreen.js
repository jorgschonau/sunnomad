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
import { useAuth } from '../../contexts/AuthContext';
import { useTheme } from '../../theme/ThemeProvider';
import { useTranslation } from 'react-i18next';
import Ionicons from '@expo/vector-icons/Ionicons';
import { getFavourites } from '../../usecases/favouritesUsecases';

export default function ProfileScreen({ navigation }) {
  const { user, profile, signOut, isAuthenticated } = useAuth();
  const { theme } = useTheme();
  const { t } = useTranslation();
  const [favouriteCount, setFavouriteCount] = useState(0);

  useFocusEffect(
    useCallback(() => {
      const loadCount = async () => {
        try {
          const favs = await getFavourites();
          setFavouriteCount(favs.length);
        } catch {
          setFavouriteCount(0);
        }
      };
      loadCount();
    }, [])
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
      </View>

      {/* Stats Card */}
      <View style={styles.statsCard}>
        <TouchableOpacity style={styles.statRow} onPress={() => navigation.navigate('Favourites')}>
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

        <View style={styles.statDivider} />

        <View style={styles.statRow}>
          <View style={styles.statIconContainer}>
            <Ionicons name="mail-outline" size={20} color={theme.primary} />
          </View>
          <Text style={styles.statEmail} numberOfLines={1}>{user?.email}</Text>
        </View>
      </View>

      {/* Actions */}
      <View style={styles.actionsSection}>
        <Text style={styles.sectionTitle}>{t('profile.actions')}</Text>

        <TouchableOpacity
          style={styles.outlineButton}
          onPress={() => Alert.alert('Coming Soon', 'Change email feature coming soon!')}
        >
          <Ionicons name="mail-outline" size={20} color={theme.primary} style={styles.actionIcon} />
          <Text style={styles.outlineButtonText}>{t('profile.changeEmail')}</Text>
          <Ionicons name="chevron-forward" size={18} color={theme.textSecondary} />
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.outlineButton}
          onPress={() => Alert.alert('Coming Soon', 'Change password feature coming soon!')}
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
    statEmail: {
      flex: 1,
      fontSize: 15,
      color: theme.text,
      marginLeft: 8,
    },
    statDivider: {
      height: 1,
      backgroundColor: theme.border || 'rgba(0,0,0,0.06)',
      marginHorizontal: 18,
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
  });
