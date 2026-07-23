import React, { useState, useCallback } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Alert,
  ActivityIndicator,
  Image,
  Dimensions,
} from 'react-native';
import { useAuth } from '../../contexts/AuthContext';
import { useTranslation } from 'react-i18next';
import { mixpanel } from '../../services/mixpanel';
import Ionicons from '@expo/vector-icons/Ionicons';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

// Brand colors (match LoginScreen/RegisterScreen)
const BRAND = {
  cream: '#F5E6D3',
  orange: '#C87840',
  navy: '#1E3A5F',
  coral: '#C9A88C',
  pink: '#C4A0A0',
  white: '#FFFFFF',
  error: '#D94040',
  textMuted: '#8A7968',
  inputBorder: '#E8DDD0',
  shadow: '#5C4033',
};

export default function ResetPasswordScreen() {
  const { updatePassword, cancelPasswordRecovery } = useAuth();
  const { t } = useTranslation();

  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordHint, setPasswordHint] = useState('');
  const [confirmHint, setConfirmHint] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [loading, setLoading] = useState(false);

  const MIN_PASSWORD_LENGTH = 6;

  const syncPasswordHint = useCallback((text) => {
    if (!text) {
      setPasswordHint('');
      return;
    }
    setPasswordHint(text.length < MIN_PASSWORD_LENGTH ? t('auth.minSixChars') : '');
  }, [t]);

  const syncConfirmHint = useCallback((nextConfirm, nextPassword = confirmPassword) => {
    if (!nextConfirm) {
      setConfirmHint('');
      return;
    }
    setConfirmHint(nextPassword !== nextConfirm ? t('auth.passwordsDontMatch') : '');
  }, [confirmPassword, t]);

  const onPasswordChange = useCallback((text) => {
    setPassword(text);
    syncPasswordHint(text);
    if (confirmPassword) {
      syncConfirmHint(confirmPassword, text);
    }
  }, [confirmPassword, syncConfirmHint, syncPasswordHint]);

  const onConfirmPasswordChange = useCallback((text) => {
    setConfirmPassword(text);
    syncConfirmHint(text, password);
  }, [password, syncConfirmHint]);

  useFocusEffect(
    useCallback(() => {
      mixpanel.track('Password Reset Screen Viewed');
    }, [])
  );

  const handleUpdatePassword = async () => {
    if (!password || !confirmPassword) {
      mixpanel.track('Password Reset Attempted', { successful: false, reason: 'missing_fields' });
      Alert.alert(t('auth.error'), t('auth.fillAllFields'));
      return;
    }

    if (password !== confirmPassword || password.length < MIN_PASSWORD_LENGTH) {
      syncPasswordHint(password);
      syncConfirmHint(confirmPassword, password);
      mixpanel.track('Password Reset Attempted', {
        successful: false,
        reason: password.length < MIN_PASSWORD_LENGTH ? 'password_too_short' : 'passwords_dont_match',
      });
      return;
    }

    setLoading(true);
    const { error } = await updatePassword(password);
    setLoading(false);

    if (error) {
      const isNetworkError = error.name === 'AbortError'
        || /network|timed out|abort/i.test(error.message || '');
      mixpanel.track('Password Reset Attempted', {
        successful: false,
        reason: isNetworkError ? 'network_error' : (error.message || 'unknown'),
      });
      const message = isNetworkError
        ? t('auth.networkError')
        : error.message === 'no_session'
          ? t('auth.recoveryLinkExpired')
          : error.message === 'same_password'
            ? t('auth.passwordSameAsOld')
            : t('auth.updatePasswordFailed');
      Alert.alert(t('auth.error'), message);
    } else {
      mixpanel.track('Password Reset Attempted', { successful: true });
      Alert.alert(
        t('auth.passwordUpdated'),
        t('auth.passwordUpdatedMessage'),
        [{
          text: 'OK',
          onPress: () => {
            mixpanel.track('Password Reset Successful');
            cancelPasswordRecovery();
          },
        }]
      );
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <View style={styles.accentStrip}>
        <View style={styles.accentPink} />
        <View style={styles.accentCoral} />
        <View style={styles.accentOrange} />
      </View>

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        showsHorizontalScrollIndicator={false}
      >
        <View style={styles.header}>
          <Image
            source={require('../../../assets/sunnomad-logo.png')}
            style={styles.logoBanner}
            resizeMode="contain"
          />
        </View>

        <Text style={styles.title}>{t('auth.resetPasswordTitle')}</Text>
        <Text style={styles.subtitle}>{t('auth.resetPasswordSubtitle')}</Text>

        <View style={styles.formCard}>
          <View style={styles.inputContainer}>
            <Text style={styles.label}>{t('auth.newPassword')}</Text>
            <View style={[
              styles.input,
              styles.passwordContainer,
              passwordHint ? styles.inputError : null,
            ]}>
              <TextInput
                style={styles.passwordInput}
                placeholder={t('auth.newPasswordPlaceholder')}
                placeholderTextColor={BRAND.textMuted}
                value={password}
                onChangeText={onPasswordChange}
                secureTextEntry={!showPassword}
                autoComplete="off"
                textContentType="password"
                autoCorrect={false}
                editable={!loading}
                autoFocus
              />
              <TouchableOpacity
                style={styles.eyeButton}
                onPress={() => setShowPassword(!showPassword)}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              >
                <Ionicons
                  name={showPassword ? 'eye-off-outline' : 'eye-outline'}
                  size={22}
                  color={BRAND.textMuted}
                />
              </TouchableOpacity>
            </View>
            {!!passwordHint && (
              <Text style={styles.errorText}>{passwordHint}</Text>
            )}
          </View>

          <View style={styles.inputContainer}>
            <Text style={styles.label}>{t('auth.confirmNewPassword')}</Text>
            <View style={[
              styles.input,
              styles.passwordContainer,
              confirmHint ? styles.inputError : null,
            ]}>
              <TextInput
                style={styles.passwordInput}
                placeholder={t('auth.confirmPasswordPlaceholder')}
                placeholderTextColor={BRAND.textMuted}
                value={confirmPassword}
                onChangeText={onConfirmPasswordChange}
                secureTextEntry={!showConfirmPassword}
                autoComplete="off"
                textContentType="password"
                autoCorrect={false}
                editable={!loading}
              />
              <TouchableOpacity
                style={styles.eyeButton}
                onPress={() => setShowConfirmPassword(!showConfirmPassword)}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              >
                <Ionicons
                  name={showConfirmPassword ? 'eye-off-outline' : 'eye-outline'}
                  size={22}
                  color={BRAND.textMuted}
                />
              </TouchableOpacity>
            </View>
            {!!confirmHint && (
              <Text style={styles.errorText}>{confirmHint}</Text>
            )}
          </View>

          <TouchableOpacity
            style={[styles.button, loading && styles.buttonDisabled]}
            onPress={handleUpdatePassword}
            disabled={loading}
            activeOpacity={0.85}
          >
            {loading ? (
              <ActivityIndicator color={BRAND.white} />
            ) : (
              <Text style={styles.buttonText}>{t('auth.updatePassword')}</Text>
            )}
          </TouchableOpacity>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: BRAND.cream,
  },

  accentStrip: {
    flexDirection: 'row',
    height: 5,
  },
  accentPink: {
    flex: 1,
    backgroundColor: BRAND.pink,
  },
  accentCoral: {
    flex: 1,
    backgroundColor: BRAND.coral,
  },
  accentOrange: {
    flex: 1,
    backgroundColor: BRAND.orange,
  },

  scrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: 28,
    paddingBottom: 40,
  },

  header: {
    alignItems: 'center',
    marginBottom: 40,
    marginTop: 20,
  },
  logoBanner: {
    width: Math.min(SCREEN_WIDTH * 0.55, 240),
    height: 68,
  },

  title: {
    fontSize: 26,
    fontWeight: '600',
    color: BRAND.navy,
    textAlign: 'center',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 15,
    color: BRAND.textMuted,
    textAlign: 'center',
    marginBottom: 32,
  },

  formCard: {
    backgroundColor: BRAND.white,
    borderRadius: 18,
    paddingHorizontal: 24,
    paddingTop: 28,
    paddingBottom: 24,
    shadowColor: BRAND.shadow,
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.07,
    shadowRadius: 14,
    elevation: 3,
  },
  inputContainer: {
    marginBottom: 24,
  },
  label: {
    fontSize: 14,
    fontWeight: '500',
    color: BRAND.navy,
    marginBottom: 8,
    letterSpacing: 0.3,
  },
  input: {
    backgroundColor: BRAND.white,
    borderWidth: 1,
    borderColor: BRAND.inputBorder,
    borderRadius: 12,
    padding: 16,
    fontSize: 16,
    color: BRAND.navy,
    shadowColor: BRAND.shadow,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 4,
    elevation: 2,
  },
  inputError: {
    borderColor: BRAND.error,
  },
  errorText: {
    color: BRAND.error,
    fontSize: 13,
    marginTop: 6,
    fontWeight: '500',
  },
  passwordContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingRight: 4,
    paddingVertical: 0,
  },
  passwordInput: {
    flex: 1,
    fontSize: 16,
    color: BRAND.navy,
    paddingVertical: Platform.OS === 'ios' ? 16 : 12,
  },
  eyeButton: {
    padding: 10,
    justifyContent: 'center',
    alignItems: 'center',
    width: 44,
    height: 44,
  },

  button: {
    backgroundColor: BRAND.orange,
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.12,
    shadowRadius: 6,
    elevation: 3,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonText: {
    color: BRAND.white,
    fontSize: 17,
    fontWeight: '600',
    letterSpacing: 0.5,
  },
});
