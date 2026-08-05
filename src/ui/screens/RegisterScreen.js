import React, { useState, useRef, useCallback } from 'react';
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
  ImageBackground,
  Dimensions,
} from 'react-native';
import { useAuth } from '../../contexts/AuthContext';
import { useTranslation } from 'react-i18next';
import { mixpanel } from '../../services/mixpanel';
import { validateEmailInput, emailErrorKey } from '../../utils/emailValidation';
import Ionicons from '@expo/vector-icons/Ionicons';
import { LinearGradient } from 'expo-linear-gradient';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const REGISTER_UNDERLAY = require('../../../assets/register_underlay.jpg');

// Brand colors (match LoginScreen)
const BRAND = {
  cream: '#F5E6D3',
  creamDark: '#E8D5C0',
  orange: '#C87840',
  orangePressed: '#A86230',
  navy: '#1E3A5F',
  navyLight: '#2B4A6F',
  coral: '#C9A88C',
  pink: '#C4A0A0',
  white: '#FFFFFF',
  error: '#D94040',
  textMuted: '#8A7968',
  inputBorder: '#E8DDD0',
  shadow: '#5C4033',
};

export default function RegisterScreen({ navigation }) {
  const { signUp } = useAuth();
  const { t } = useTranslation();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [emailError, setEmailError] = useState('');
  const signUpCompletedRef = useRef(false);

  useFocusEffect(
    useCallback(() => {
      signUpCompletedRef.current = false;
      mixpanel.track('Register Screen Viewed');
      return () => {
        if (!signUpCompletedRef.current) {
          mixpanel.track('Register Screen Abandoned');
        }
      };
    }, [])
  );

  const validateEmail = (value) => {
    const result = validateEmailInput(value);
    if (!result.valid) {
      setEmailError(t(result.reason === 'empty_email' ? 'auth.fillAllFields' : emailErrorKey(result.reason)));
      return false;
    }
    setEmailError('');
    return true;
  };

  const handleRegister = async () => {
    if (!email || !password || !confirmPassword || !username) {
      mixpanel.track('Sign Up Validation Failed', { reason: 'missing_fields' });
      Alert.alert(t('auth.error'), t('auth.fillAllFields'));
      return;
    }

    if (!validateEmail(email)) {
      const emailCheck = validateEmailInput(email);
      mixpanel.track('Sign Up Validation Failed', { reason: emailCheck.reason || 'invalid_email' });
      return;
    }

    if (password !== confirmPassword) {
      mixpanel.track('Sign Up Validation Failed', { reason: 'passwords_dont_match' });
      Alert.alert(t('auth.error'), t('auth.passwordsDontMatch'));
      return;
    }

    if (password.length < 6) {
      mixpanel.track('Sign Up Validation Failed', { reason: 'password_too_short' });
      Alert.alert(t('auth.error'), t('auth.passwordTooShort'));
      return;
    }

    if (username.length < 3) {
      mixpanel.track('Sign Up Validation Failed', { reason: 'username_too_short' });
      Alert.alert(t('auth.error'), t('auth.usernameTooShort'));
      return;
    }

    mixpanel.track('Sign Up Started');
    setLoading(true);
    const emailCheck = validateEmailInput(email);
    const { error } = await signUp(
      emailCheck.email,
      password,
      username.trim(),
      displayName.trim() || username.trim()
    );
    setLoading(false);

    if (error) {
      const isNetworkError = error.name === 'AbortError'
        || /network|timed out|abort/i.test(error.message || '');
      let reason = 'unknown';
      let errorMessage = t('auth.tryAgain');
      if (isNetworkError) {
        reason = 'network_error';
        errorMessage = t('auth.networkError');
      } else if (error.message?.includes('already registered')) {
        reason = 'email_exists';
        errorMessage = t('auth.emailAlreadyExists');
      } else if (error.message?.toLowerCase().includes('rate limit')) {
        reason = 'rate_limit';
        errorMessage = t('auth.emailRateLimitExceeded');
      }
      mixpanel.track('Sign Up Failed', { reason });
      Alert.alert(t('auth.registrationFailed'), errorMessage);
    } else {
      signUpCompletedRef.current = true;
      mixpanel.track('Sign Up Completed');
      Alert.alert(
        t('auth.success'),
        t('auth.accountCreated'),
        [{ text: 'OK' }]
      );
    }
  };

  return (
    <ImageBackground
      source={REGISTER_UNDERLAY}
      style={styles.underlay}
      imageStyle={styles.underlayImage}
      resizeMode="cover"
    >
      <View style={styles.underlayScrim} />
      <LinearGradient
        pointerEvents="none"
        colors={['rgba(0,0,0,0.10)', 'transparent', 'transparent', 'rgba(0,0,0,0.10)']}
        locations={[0, 0.22, 0.78, 1]}
        style={styles.sideVignette}
      />
      <LinearGradient
        pointerEvents="none"
        colors={['rgba(0,0,0,0.28)', 'transparent', 'transparent', 'rgba(0,0,0,0.28)']}
        locations={[0, 0.2, 0.8, 1]}
        start={{ x: 0, y: 0.5 }}
        end={{ x: 1, y: 0.5 }}
        style={styles.sideVignette}
      />
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          showsHorizontalScrollIndicator={false}
        >
          {/* Logo (same as LoginScreen) */}
          <View style={styles.header}>
            <Image
              source={require('../../../assets/sunnomad-logo.png')}
              style={styles.logoBanner}
              resizeMode="contain"
            />
          </View>

          {/* Form Card (same white card as LoginScreen) */}
          <View style={styles.formCard}>
            <View style={styles.inputContainer}>
              <Text style={styles.label}>{t('auth.username')} *</Text>
              <TextInput
                style={styles.input}
                placeholder={t('auth.usernamePlaceholder')}
                placeholderTextColor={BRAND.textMuted}
                value={username}
                onChangeText={setUsername}
                autoCapitalize="none"
                autoComplete="username"
                editable={!loading}
              />
            </View>

            <View style={styles.inputContainer}>
              <Text style={styles.label}>{t('auth.displayNameOptional')}</Text>
              <TextInput
                style={styles.input}
                placeholder={t('auth.displayNamePlaceholder')}
                placeholderTextColor={BRAND.textMuted}
                value={displayName}
                onChangeText={setDisplayName}
                autoComplete="name"
                editable={!loading}
              />
            </View>

            <View style={styles.inputContainer}>
              <Text style={styles.label}>{t('auth.email')} *</Text>
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
                textContentType="emailAddress"
                autoComplete="email"
                editable={!loading}
              />
              {emailError ? (
                <Text style={styles.errorText}>{emailError}</Text>
              ) : null}
            </View>

            <View style={styles.inputContainer}>
              <Text style={styles.label}>{t('auth.password')} *</Text>
              <Text style={styles.labelCaption}>{t('auth.minSixChars')}</Text>
              <View style={[styles.input, styles.passwordContainer]}>
                <TextInput
                  style={styles.passwordInput}
                  placeholder={t('auth.passwordPlaceholder')}
                  placeholderTextColor={BRAND.textMuted}
                  value={password}
                  onChangeText={setPassword}
                  secureTextEntry={!showPassword}
                  autoComplete="password"
                  autoCorrect={false}
                  editable={!loading}
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
            </View>

            <View style={[styles.inputContainer, styles.lastInputContainer]}>
              <Text style={styles.label}>{t('auth.confirmPassword')} *</Text>
              <View style={[styles.input, styles.passwordContainer]}>
                <TextInput
                  style={styles.passwordInput}
                  placeholder={t('auth.confirmPasswordPlaceholder')}
                  placeholderTextColor={BRAND.textMuted}
                  value={confirmPassword}
                  onChangeText={setConfirmPassword}
                  secureTextEntry={!showConfirmPassword}
                  autoComplete="password"
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
            </View>

            <TouchableOpacity
              style={[styles.button, loading && styles.buttonDisabled]}
              onPress={handleRegister}
              disabled={loading}
              activeOpacity={0.85}
            >
              {loading ? (
                <ActivityIndicator color={BRAND.white} />
              ) : (
                <Text style={styles.buttonText}>{t('auth.signUp')}</Text>
              )}
            </TouchableOpacity>
          </View>

          {/* Footer (same style as LoginScreen) */}
          <View style={styles.footer}>
            <Text style={styles.footerText}>{t('auth.alreadyHaveAccount')}</Text>
            <TouchableOpacity
              onPress={() => navigation.navigate('Login')}
              disabled={loading}
            >
              <Text style={styles.linkText}>{t('auth.login')}</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </ImageBackground>
  );
}

const styles = StyleSheet.create({
  underlay: {
    flex: 1,
    backgroundColor: BRAND.cream,
  },
  underlayImage: {
    opacity: 1,
  },
  underlayScrim: {
    ...StyleSheet.absoluteFillObject,
    // Flat-lay is busier — slightly more wash than login, still punchy
    backgroundColor: 'rgba(245, 230, 211, 0.38)',
  },
  sideVignette: {
    ...StyleSheet.absoluteFillObject,
  },
  container: {
    flex: 1,
    backgroundColor: 'transparent',
  },

  scrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: 24,
    paddingBottom: 24,
  },

  header: {
    alignItems: 'center',
    marginBottom: 50,
    marginTop: 8,
  },
  logoBanner: {
    width: Math.min(SCREEN_WIDTH * 0.8, 322),
    height: 74,
  },

  formCard: {
    backgroundColor: 'rgba(255, 255, 255, 0.94)',
    borderRadius: 18,
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 24,
    shadowColor: BRAND.shadow,
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.1,
    shadowRadius: 14,
    elevation: 3,
  },
  inputContainer: {
    marginBottom: 14,
  },
  lastInputContainer: {
    marginBottom: 0,
  },
  label: {
    fontSize: 14,
    fontWeight: '500',
    color: BRAND.navy,
    marginBottom: 6,
    letterSpacing: 0.3,
  },
  labelCaption: {
    fontSize: 12,
    color: BRAND.textMuted,
    marginTop: -2,
    marginBottom: 6,
  },
  input: {
    backgroundColor: BRAND.white,
    borderWidth: 1,
    borderColor: BRAND.inputBorder,
    borderRadius: 12,
    padding: 12,
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
    paddingVertical: Platform.OS === 'ios' ? 12 : 10,
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
    marginTop: 22,
    paddingVertical: 14,
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

  footer: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    alignSelf: 'center',
    marginTop: 18,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: 'rgba(255, 255, 255, 0.88)',
  },
  footerText: {
    color: BRAND.navy,
    fontSize: 15,
    marginRight: 6,
    fontWeight: '500',
  },
  linkText: {
    color: BRAND.orange,
    fontSize: 15,
    fontWeight: '700',
  },
});
