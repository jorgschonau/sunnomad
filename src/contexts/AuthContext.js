import React, { createContext, useState, useEffect, useContext, useCallback, useMemo, useRef } from 'react';
import { Linking } from 'react-native';
import * as authService from '../services/authService';
import * as profileService from '../services/profileService';
import { identifyUser, resetMixpanelIdentity, mixpanel } from '../services/mixpanel';

const AuthContext = createContext({});

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [isPasswordRecovery, setIsPasswordRecovery] = useState(false);
  const [recoveryLinkError, setRecoveryLinkError] = useState(null);
  const hadAuthenticatedUser = useRef(false);

  const loadProfile = useCallback(async (userId) => {
    try {
      const { profile, error } = await profileService.getProfile(userId);
      if (error) throw error;
      setProfile(profile);
    } catch (error) {
      console.error('Failed to load profile:', error);
    }
  }, []);

  // Consume a `sunnomad://reset-password#access_token=...&type=recovery` deep link:
  // sets the recovery session and flags the app to show ResetPasswordScreen.
  const consumeRecoveryUrl = useCallback(async (url) => {
    const parsed = authService.parseAuthUrl(url);
    if (!parsed || parsed.type !== 'recovery') return { error: null };

    if (!parsed.accessToken || !parsed.refreshToken) {
      return { error: new Error(parsed.error || 'Invalid recovery link') };
    }

    const { session: recoverySession, error } = await authService.setRecoverySession(
      parsed.accessToken,
      parsed.refreshToken
    );
    if (error) return { error };

    setSession(recoverySession);
    setUser(recoverySession?.user ?? null);
    setIsPasswordRecovery(true);
    return { error: null };
  }, []);

  const clearRecoveryLinkError = useCallback(() => setRecoveryLinkError(null), []);

  // Initialize auth + deep links (recovery URL must win over stored session on cold start)
  useEffect(() => {
    let linkingSubscription;

    const handleRecoveryUrl = async (url) => {
      const { error } = await consumeRecoveryUrl(url);
      if (error) setRecoveryLinkError(error);
    };

    const initializeAuth = async () => {
      try {
        setLoading(true);

        const initialUrl = await Linking.getInitialURL();
        if (initialUrl) {
          const parsed = authService.parseAuthUrl(initialUrl);
          if (parsed?.type === 'recovery') {
            await handleRecoveryUrl(initialUrl);
            return;
          }
        }

        const session = await authService.initializeSession();
        if (session?.user) {
          setSession(session);
          setUser(session.user);
        }
      } catch (error) {
        console.error('Failed to initialize auth:', error);
      } finally {
        setLoading(false);
      }
    };

    initializeAuth();

    linkingSubscription = Linking.addEventListener('url', ({ url }) => {
      handleRecoveryUrl(url);
    });

    return () => linkingSubscription?.remove();
  }, [consumeRecoveryUrl]);

  // Listen to auth state changes
  useEffect(() => {
    const subscription = authService.onAuthStateChange(async (event, session) => {
      if (__DEV__) console.log('Auth state changed:', event);

      if (event === 'PASSWORD_RECOVERY') {
        setIsPasswordRecovery(true);
      }

      setSession(session);
      setUser(session?.user ?? null);

      if (session?.user) {
        hadAuthenticatedUser.current = true;
        if (event !== 'PASSWORD_RECOVERY') {
          await identifyUser(session.user.id);
          await loadProfile(session.user.id);
          profileService.recordAppOpen(session.user.id);
        }
      } else {
        setProfile(null);
        if (hadAuthenticatedUser.current) {
          hadAuthenticatedUser.current = false;
          await resetMixpanelIdentity();
        }
      }
    });

    return () => {
      subscription.unsubscribe();
    };
  }, [loadProfile]);

  const signUp = useCallback(async (email, password, username, displayName) => {
    try {
      const { user, session, error } = await authService.signUp(
        email,
        password,
        username,
        displayName
      );

      if (error) throw error;

      setUser(user);
      setSession(session);
      
      if (user) {
        await loadProfile(user.id);
      }

      return { error: null };
    } catch (error) {
      console.error('Sign up error:', error);
      return { error };
    }
  }, [loadProfile]);

  const signIn = useCallback(async (email, password) => {
    try {
      const { user, session, error } = await authService.signIn(email, password);

      if (error) throw error;

      setUser(user);
      setSession(session);
      
      if (user) {
        await loadProfile(user.id);
      }

      return { error: null };
    } catch (error) {
      console.error('Sign in error:', error);
      return { error };
    }
  }, [loadProfile]);

  const signOut = useCallback(async () => {
    try {
      const { error } = await authService.signOut();
      if (error) throw error;

      setUser(null);
      setProfile(null);
      setSession(null);
      mixpanel.track('Sign Out');
      await resetMixpanelIdentity();

      return { error: null };
    } catch (error) {
      console.error('Sign out error:', error);
      return { error };
    }
  }, []);

  const resetPassword = useCallback(async (email) => {
    try {
      const { error } = await authService.resetPassword(email);
      if (error) throw error;
      return { error: null };
    } catch (error) {
      console.error('Reset password error:', error);
      return { error };
    }
  }, []);

  const updatePassword = useCallback(async (newPassword) => {
    try {
      const { error } = await authService.updatePassword(newPassword);
      if (error) throw error;
      return { error: null };
    } catch (error) {
      console.error('Update password error:', error);
      return { error };
    }
  }, []);

  const cancelPasswordRecovery = useCallback(() => setIsPasswordRecovery(false), []);

  const deleteAccount = useCallback(async () => {
    try {
      const { error } = await authService.deleteAccount();
      if (error) throw error;

      mixpanel.track('Account Deleted');
      await resetMixpanelIdentity();
      setUser(null);
      setProfile(null);
      setSession(null);

      return { error: null };
    } catch (error) {
      console.error('Delete account error:', error);
      return { error };
    }
  }, []);

  const updateProfile = useCallback(async (updates) => {
    try {
      if (!user) throw new Error('No user logged in');

      const { profile: updatedProfile, error } = await profileService.updateProfile(
        user.id,
        updates
      );

      if (error) throw error;

      setProfile(updatedProfile);
      return { error: null };
    } catch (error) {
      console.error('Update profile error:', error);
      return { error };
    }
  }, [user]);

  const refreshProfile = useCallback(() => user && loadProfile(user.id), [user, loadProfile]);

  // Memoized: without this every provider render created a new value object and
  // re-rendered every useAuth() consumer (incl. RootNavigator and all screens).
  const value = useMemo(() => ({
    user,
    profile,
    session,
    loading,
    isAuthenticated: !!user,
    signUp,
    signIn,
    signOut,
    resetPassword,
    updatePassword,
    deleteAccount,
    updateProfile,
    refreshProfile,
    isPasswordRecovery,
    consumeRecoveryUrl,
    cancelPasswordRecovery,
    recoveryLinkError,
    clearRecoveryLinkError,
  }), [
    user, profile, session, loading, isPasswordRecovery, recoveryLinkError,
    signUp, signIn, signOut, resetPassword, updatePassword,
    deleteAccount, updateProfile, refreshProfile, consumeRecoveryUrl, cancelPasswordRecovery,
    clearRecoveryLinkError,
  ]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export default AuthContext;


