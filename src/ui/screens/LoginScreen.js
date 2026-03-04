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

// Brand colors extracted from the SunNomad logo
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

export default function LoginScreen({ navigation }) {
  const { signIn } = useAuth();
  const { t } = useTranslation();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
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

  const handleLogin = async () => {
    if (!validateEmail(email)) return;

    if (!password) {
      Alert.alert(t('auth.error'), t('auth.fillAllFields'));
      return;
    }

    setLoading(true);
    const { error } = await signIn(email.trim(), password);
    setLoading(false);

    if (error) {
      Alert.alert(
        t('auth.loginFailed'),
        error.message || t('auth.checkCredentials')
      );
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      {/* Decorative sunset accent strip at top */}
      <View style={styles.accentStrip}>
        <View style={styles.accentPink} />
        <View style={styles.accentCoral} />
        <View style={styles.accentOrange} />
      </View>

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* Logo */}
        <View style={styles.header}>
          <Image
            source={require('../../../assets/sunnomad-logo.png')}
            style={styles.logoBanner}
            resizeMode="contain"
          />
        </View>

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
            />
            {emailError ? (
              <Text style={styles.errorText}>{emailError}</Text>
            ) : null}
          </View>

          <View style={styles.inputContainer}>
            <Text style={styles.label}>{t('auth.password')}</Text>
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
          </View>

          <TouchableOpacity
            style={styles.forgotPassword}
            onPress={() => navigation.navigate('ForgotPassword')}
            disabled={loading}
          >
            <Text style={styles.forgotPasswordText}>
              {t('auth.forgotPassword')}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.button, loading && styles.buttonDisabled]}
            onPress={handleLogin}
            disabled={loading}
            activeOpacity={0.85}
          >
            {loading ? (
              <ActivityIndicator color={BRAND.white} />
            ) : (
              <Text style={styles.buttonText}>{t('auth.login')}</Text>
            )}
          </TouchableOpacity>
        </View>

        {/* Footer */}
        <View style={styles.footer}>
          <Text style={styles.footerText}>{t('auth.noAccount')}</Text>
          <TouchableOpacity
            onPress={() => navigation.navigate('Register')}
            disabled={loading}
          >
            <Text style={styles.linkText}>{t('auth.signUp')}</Text>
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

  // --- Decorative sunset accent ---
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

  // --- Scroll ---
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: 28,
    paddingBottom: 40,
  },

  // --- Header / Logo ---
  header: {
    alignItems: 'center',
    marginBottom: 48,
    marginTop: 20,
  },
  logoBanner: {
    width: Math.min(SCREEN_WIDTH * 0.75, 320),
    height: 90,
  },

  // --- Form Card ---
  formCard: {
    backgroundColor: BRAND.white,
    borderRadius: 20,
    paddingHorizontal: 24,
    paddingTop: 32,
    paddingBottom: 28,
    shadowColor: BRAND.shadow,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 16,
    elevation: 4,
  },
  inputContainer: {
    marginBottom: 24,
  },
  label: {
    fontSize: 14,
    fontWeight: '700',
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

  // --- Forgot Password ---
  forgotPassword: {
    alignSelf: 'flex-end',
    marginBottom: 28,
    marginTop: -8,
  },
  forgotPasswordText: {
    color: BRAND.orange,
    fontSize: 13,
    fontWeight: '600',
  },

  // --- Button ---
  button: {
    backgroundColor: BRAND.orange,
    borderRadius: 12,
    paddingVertical: 16,
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

  // --- Footer ---
  footer: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 32,
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
