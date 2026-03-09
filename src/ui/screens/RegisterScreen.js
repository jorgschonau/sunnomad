import React, { useState } from 'react';
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
import Ionicons from '@expo/vector-icons/Ionicons';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const { width: SCREEN_WIDTH } = Dimensions.get('window');

// Brand colors (match LoginScreen)
const BRAND = {
  cream: '#F5E6D3',
  creamDark: '#E8D5C0',
  orange: '#FF8C42',
  orangePressed: '#E67A32',
  navy: '#1E3A5F',
  navyLight: '#2B4A6F',
  coral: '#FFA07A',
  pink: '#FF6B9D',
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

  const handleRegister = async () => {
    if (!email || !password || !confirmPassword || !username) {
      Alert.alert(t('auth.error'), t('auth.fillAllFields'));
      return;
    }

    if (!validateEmail(email)) return;

    if (password !== confirmPassword) {
      Alert.alert(t('auth.error'), t('auth.passwordsDontMatch'));
      return;
    }

    if (password.length < 6) {
      Alert.alert(t('auth.error'), t('auth.passwordTooShort'));
      return;
    }

    if (username.length < 3) {
      Alert.alert(t('auth.error'), t('auth.usernameTooShort'));
      return;
    }

    setLoading(true);
    const { error } = await signUp(
      email.trim(),
      password,
      username.trim(),
      displayName.trim() || username.trim()
    );
    setLoading(false);

    if (error) {
      let errorMessage = error.message || t('auth.tryAgain');
      if (error.message?.includes('already registered')) {
        errorMessage = t('auth.emailAlreadyExists');
      }
      if (error.message?.toLowerCase().includes('rate limit')) {
        errorMessage = t('auth.emailRateLimitExceeded');
      }
      Alert.alert(t('auth.registrationFailed'), errorMessage);
    } else {
      Alert.alert(
        t('auth.success'),
        t('auth.accountCreated'),
        [{ text: 'OK' }]
      );
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      {/* Decorative sunset accent strip at top (same as LoginScreen) */}
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
            <Text style={styles.label}>{t('auth.displayName')}</Text>
            <TextInput
              style={styles.input}
              placeholder={t('auth.displayNamePlaceholder')}
              placeholderTextColor={BRAND.textMuted}
              value={displayName}
              onChangeText={setDisplayName}
              autoComplete="name"
              editable={!loading}
            />
            <Text style={styles.hint}>{t('auth.optional')}</Text>
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
              autoComplete="email"
              editable={!loading}
            />
            {emailError ? (
              <Text style={styles.errorText}>{emailError}</Text>
            ) : null}
          </View>

          <View style={styles.inputContainer}>
            <Text style={styles.label}>{t('auth.password')} *</Text>
            <View style={[styles.input, styles.passwordContainer]}>
              <TextInput
                style={styles.passwordInput}
                placeholder={t('auth.passwordPlaceholder')}
                placeholderTextColor={BRAND.textMuted}
                value={password}
                onChangeText={setPassword}
                secureTextEntry={!showPassword}
                autoComplete="password"
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
            <Text style={styles.hint}>{t('auth.minSixChars')}</Text>
          </View>

          <View style={styles.inputContainer}>
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
    paddingHorizontal: 24,
    paddingBottom: 24,
  },

  header: {
    alignItems: 'center',
    marginBottom: 20,
    marginTop: 8,
  },
  logoBanner: {
    width: Math.min(SCREEN_WIDTH * 0.7, 280),
    height: 64,
  },

  formCard: {
    backgroundColor: BRAND.white,
    borderRadius: 20,
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 20,
    shadowColor: BRAND.shadow,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 16,
    elevation: 4,
  },
  inputContainer: {
    marginBottom: 14,
  },
  label: {
    fontSize: 14,
    fontWeight: '700',
    color: BRAND.navy,
    marginBottom: 6,
    letterSpacing: 0.3,
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
  hint: {
    fontSize: 12,
    color: BRAND.textMuted,
    marginTop: 4,
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
    paddingVertical: 14,
    alignItems: 'center',
    shadowColor: BRAND.orange,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonText: {
    color: BRAND.white,
    fontSize: 17,
    fontWeight: 'bold',
    letterSpacing: 0.5,
  },

  footer: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 18,
  },
  footerText: {
    color: BRAND.textMuted,
    fontSize: 15,
    marginRight: 6,
  },
  linkText: {
    color: BRAND.orange,
    fontSize: 15,
    fontWeight: 'bold',
  },
});
