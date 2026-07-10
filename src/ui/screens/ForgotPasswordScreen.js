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

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const { width: SCREEN_WIDTH } = Dimensions.get('window');

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
  success: '#4CAF50',
};

export default function ForgotPasswordScreen({ navigation }) {
  const { resetPassword } = useAuth();
  const { t } = useTranslation();

  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [emailSent, setEmailSent] = useState(false);
  const [emailError, setEmailError] = useState('');

  useFocusEffect(
    useCallback(() => {
      mixpanel.track('Password Reset Email Screen Viewed');
    }, [])
  );

  const validateEmail = (value) => {
    if (!value.trim()) {
      setEmailError(t('auth.fillAllFields'));
      return false;
    }
    if (!EMAIL_REGEX.test(value.trim())) {
      setEmailError(t('auth.invalidEmail'));
      return false;
    }
    setEmailError('');
    return true;
  };

  const handleResetPassword = async () => {
    const emailValue = email.trim().toLowerCase();

    if (!validateEmail(email)) {
      const reason = !email.trim() ? 'empty_email'
        : !EMAIL_REGEX.test(email.trim()) ? 'invalid_email'
        : 'validation_failed';
      mixpanel.track('Password Reset Email Attempted', {
        email_sent: false,
        reason,
      });
      return;
    }

    setLoading(true);
    const { error } = await resetPassword(emailValue);
    setLoading(false);

    if (error) {
      mixpanel.track('Password Reset Email Attempted', {
        email_sent: false,
        reason: error.message || 'unknown',
      });
      if (error.message === 'email_not_registered') {
        setEmailError(t('auth.emailNotRegistered'));
      } else {
        Alert.alert(t('auth.error'), t('auth.resetPasswordFailed'));
      }
    } else {
      mixpanel.track('Password Reset Email Attempted', { email_sent: true });
      setEmailSent(true);
    }
  };

  // ── Success state ──
  if (emailSent) {
    return (
      <View style={styles.container}>
        <View style={styles.accentStrip}>
          <View style={styles.accentPink} />
          <View style={styles.accentCoral} />
          <View style={styles.accentOrange} />
        </View>

        <View style={styles.successContainer}>
          <View style={styles.successIconCircle}>
            <Text style={styles.successCheckmark}>✓</Text>
          </View>

          <Text style={styles.successTitle}>{t('auth.resetEmailSent')}</Text>
          <Text style={styles.successMessage}>
            {t('auth.resetEmailSentMessage')}
          </Text>

          <TouchableOpacity
            style={[styles.button, styles.successButton]}
            onPress={() => navigation.navigate('Login')}
            activeOpacity={0.85}
          >
            <Text style={styles.buttonText}>{t('app.back')}</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.resendButton}
            onPress={() => setEmailSent(false)}
          >
            <Text style={styles.resendText}>{t('auth.resendEmail')}</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // ── Form state ──
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
        {/* Logo */}
        <View style={styles.header}>
          <Image
            source={require('../../../assets/sunnomad-logo.png')}
            style={styles.logoBanner}
            resizeMode="contain"
          />
        </View>

        {/* Title + subtitle */}
        <Text style={styles.title}>{t('auth.forgotPasswordTitle')}</Text>
        <Text style={styles.subtitle}>{t('auth.forgotPasswordSubtitle')}</Text>

        {/* Form Card */}
        <View style={styles.formCard}>
          <View style={styles.inputContainer}>
            <Text style={styles.label}>{t('auth.email')}</Text>
            <TextInput
              style={[styles.input, emailError ? styles.inputError : null]}
              placeholder={t('auth.emailPlaceholder')}
              placeholderTextColor={BRAND.textMuted}
              value={email}
              onChangeText={(text) => {
                setEmail(text);
                if (emailError) validateEmail(text);
              }}
              onBlur={() => email && validateEmail(email)}
              autoCapitalize="none"
              keyboardType="email-address"
              autoComplete="email"
              editable={!loading}
              autoFocus
            />
            {emailError ? (
              <Text style={styles.errorText}>{emailError}</Text>
            ) : null}
          </View>

          <TouchableOpacity
            style={[styles.button, loading && styles.buttonDisabled]}
            onPress={handleResetPassword}
            disabled={loading}
            activeOpacity={0.85}
          >
            {loading ? (
              <ActivityIndicator color={BRAND.white} />
            ) : (
              <Text style={styles.buttonText}>{t('auth.sendResetLink')}</Text>
            )}
          </TouchableOpacity>
        </View>

        {/* Back link */}
        <TouchableOpacity
          style={styles.backLink}
          onPress={() => navigation.navigate('Login')}
          disabled={loading}
        >
          <Text style={styles.backLinkText}>{t('auth.backToLogin')}</Text>
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: BRAND.cream,
  },

  // ── Accent strip ──
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

  // ── Scroll ──
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: 28,
    paddingBottom: 40,
  },

  // ── Header / Logo ──
  header: {
    alignItems: 'center',
    marginBottom: 40,
    marginTop: 20,
  },
  logoBanner: {
    width: Math.min(SCREEN_WIDTH * 0.55, 240),
    height: 68,
  },

  // ── Title ──
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

  // ── Form Card ──
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

  // ── Button ──
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

  // ── Back link ──
  backLink: {
    alignItems: 'center',
    marginTop: 28,
  },
  backLinkText: {
    color: BRAND.orange,
    fontSize: 15,
    fontWeight: '600',
  },

  // ── Success state ──
  successContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 36,
  },
  successIconCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: BRAND.success,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 28,
    shadowColor: BRAND.success,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
  successCheckmark: {
    color: BRAND.white,
    fontSize: 36,
    fontWeight: '600',
  },
  successTitle: {
    fontSize: 24,
    fontWeight: '600',
    color: BRAND.navy,
    marginBottom: 10,
    textAlign: 'center',
  },
  successMessage: {
    fontSize: 15,
    color: BRAND.textMuted,
    textAlign: 'center',
    marginBottom: 36,
  },
  successButton: {
    width: '100%',
    maxWidth: 200,
  },
  resendButton: {
    marginTop: 20,
  },
  resendText: {
    color: BRAND.orange,
    fontSize: 15,
    fontWeight: '600',
  },
});
