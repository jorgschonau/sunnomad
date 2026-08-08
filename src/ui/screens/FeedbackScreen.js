import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Platform,
  ActivityIndicator,
  Alert,
  Image,
  ImageBackground,
  Animated,
  Dimensions,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../theme/ThemeProvider';
import { useAuth } from '../../contexts/AuthContext';
import { submitFeedback } from '../../services/feedbackService';
import { LinearGradient } from 'expo-linear-gradient';
import Ionicons from '@expo/vector-icons/Ionicons';
import { mixpanel } from '../../services/mixpanel';

// Banner order (fixed). Arrows in prod + dev; filename pill = __DEV__ only.
const SHOW_UNDERLAY_ARROWS = true;
const SHOW_UNDERLAY_FILE_PILL = __DEV__;

// Top-aligned full-width banners (no contain letterbox / black bar under nav).
// nudgeTop: px — positive = nach unten, negative = nach oben.
const UNDERLAY_NUDGE_TOP_BY_NAME = {
  'feedback_underlay_1.jpg': 0, // Conrad
  'feedback_underlay_2.jpg': 5, // Tammy 5px down
  'feedback_underlay_3.jpg': 0, // Tasha (was −5, +5px down)

  // Sofia (_6) deactivated — file kept
  'feedback_underlay_7.jpg': -20, // Maya
  'feedback_underlay_8.jpg': 20, // Ingrid
  'feedback_underlay_10.jpg': -20, // Goldie
};

function underlayNudgeTop(index) {
  const name = FEEDBACK_UNDERLAY_NAMES[index];
  const perFile = UNDERLAY_NUDGE_TOP_BY_NAME[name] ?? 0;
  // Global up; Conrad stays at previous level (−30)
  const global = name === 'feedback_underlay_1.jpg' ? -30 : -50;
  return perFile + global;
}

function underlayPhotoLayout(index) {
  const resolved = Image.resolveAssetSource(FEEDBACK_UNDERLAY_IMAGES[index]);
  const width = Dimensions.get('window').width;
  const height =
    resolved?.width && resolved?.height
      ? width * (resolved.height / resolved.width)
      : width * (1024 / 576);
  return {
    position: 'absolute',
    left: 0,
    width,
    height,
    top: underlayNudgeTop(index),
  };
}

// Fixed story order — no shuffle
const FEEDBACK_UNDERLAY_IMAGES = [
  require('../../../assets/feedback_underlay_1.jpg'), // Conrad — Vertrauen
  require('../../../assets/feedback_underlay_11.jpg'), // Alessandra — Power User
  require('../../../assets/feedback_underlay_9.jpg'), // Diaz — Feature-Wunsch
  require('../../../assets/feedback_underlay_2.jpg'), // Tammy — Chaos
  require('../../../assets/feedback_underlay_3.jpg'), // Tasha
  require('../../../assets/feedback_underlay_7.jpg'), // Maya — Humor
  require('../../../assets/feedback_underlay_8.jpg'), // Ingrid — positiv
  require('../../../assets/feedback_underlay_5.jpg'), // Luca — Easter Egg
  require('../../../assets/feedback_underlay_4.jpg'), // Jade — provokant
  require('../../../assets/feedback_underlay_10.jpg'), // Goldie — Finale
];
const FEEDBACK_UNDERLAY_NAMES = [
  'feedback_underlay_1.jpg', // Conrad
  'feedback_underlay_11.jpg', // Alessandra
  'feedback_underlay_9.jpg', // Diaz
  'feedback_underlay_2.jpg', // Tammy
  'feedback_underlay_3.jpg', // Tasha
  'feedback_underlay_7.jpg', // Maya
  'feedback_underlay_8.jpg', // Ingrid
  'feedback_underlay_5.jpg', // Luca
  'feedback_underlay_4.jpg', // Jade
  'feedback_underlay_10.jpg', // Goldie
];
const THANKS_UNDERLAY = require('../../../assets/feedback_thanks_underlay.jpg');

function FeedbackSuccessView({ theme, t, onBack }) {
  const insets = useSafeAreaInsets();
  const fade = useRef(new Animated.Value(0)).current;
  const scale = useRef(new Animated.Value(0.96)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fade, {
        toValue: 1,
        duration: 380,
        useNativeDriver: true,
      }),
      Animated.timing(scale, {
        toValue: 1,
        duration: 380,
        useNativeDriver: true,
      }),
    ]).start();
  }, [fade, scale]);

  return (
    <ImageBackground
      source={THANKS_UNDERLAY}
      style={styles.flex}
      imageStyle={styles.thanksUnderlayImage}
      resizeMode="cover"
    >
      <LinearGradient
        colors={['rgba(0,0,0,0.28)', 'transparent', 'transparent', 'rgba(0,0,0,0.58)']}
        locations={[0, 0.2, 0.48, 1]}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      />

      <Animated.View
        style={[
          styles.flex,
          { opacity: fade, transform: [{ scale }] },
        ]}
      >
        <ScrollView
          style={styles.flex}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          bounces={false}
        >
          <View style={styles.spacer} />

          <View style={styles.heroCopy}>
            <Text style={styles.heroTitle}>{t('feedbackScreen.successTitle')}</Text>
            <Text style={styles.heroSubtitle}>{t('feedbackScreen.successSubtitle')}</Text>
          </View>

          <View
            style={[
              styles.formCard,
              styles.thanksCard,
              {
                backgroundColor: theme.surface,
                borderColor: theme.border || 'rgba(0,0,0,0.08)',
                paddingBottom: Math.max(insets.bottom, 12) + 10,
              },
            ]}
          >
            <Text style={[styles.thanksCardText, { color: theme.textSecondary }]}>
              {t('feedbackScreen.successNote')}
            </Text>
            <TouchableOpacity
              style={styles.sendButton}
              onPress={onBack}
              activeOpacity={0.85}
            >
              <Text style={styles.sendButtonText}>{t('feedbackScreen.backToMap')}</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </Animated.View>
    </ImageBackground>
  );
}

export default function FeedbackScreen({ navigation, route }) {
  const { t } = useTranslation();
  const { theme } = useTheme();
  const { user } = useAuth();
  const insets = useSafeAreaInsets();
  const [message, setMessage] = useState('');
  const [senderEmail, setSenderEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [sending, setSending] = useState(false);
  const [headerIndex, setHeaderIndex] = useState(0);
  const [underlayReady, setUnderlayReady] = useState(false);

  const canSend = message.trim().length > 0 && !sending;

  useEffect(() => {
    setUnderlayReady(false);
  }, [headerIndex]);

  useFocusEffect(
    React.useCallback(() => {
      setHeaderIndex(0); // always start at Conrad
      mixpanel.track('Feedback Opened', {
        source: route.params?.source ?? 'direct',
      });
    }, [route.params?.source])
  );

  const handleSend = async () => {
    if (!canSend) return;

    setSending(true);
    const { error } = await submitFeedback({ message, senderEmail, userId: user?.id });
    setSending(false);

    if (error) {
      Alert.alert(t('feedbackScreen.sendFailedTitle'), t('feedbackScreen.sendFailedMessage'));
      return;
    }

    mixpanel.track('Feedback Submitted', { message_length: message.trim().length });
    setSent(true);
  };

  if (sent) {
    return (
      <FeedbackSuccessView
        theme={theme}
        t={t}
        onBack={() => navigation.goBack()}
      />
    );
  }

  const photoLayout = underlayPhotoLayout(headerIndex);

  return (
    <View style={styles.flex}>
      <View style={[styles.flex, styles.underlayClip, styles.underlayLetterboxBg]}>
        <Image
          key={headerIndex}
          source={FEEDBACK_UNDERLAY_IMAGES[headerIndex]}
          style={[
            photoLayout,
            { opacity: underlayReady ? 1 : 0 },
          ]}
          resizeMode="cover"
          onLoadEnd={() => setUnderlayReady(true)}
        />
        {/* Soft top for nav + bottom for copy — photo stays vivid in the middle */}
        <LinearGradient
          colors={['rgba(0,0,0,0.35)', 'transparent', 'transparent', 'rgba(0,0,0,0.55)']}
          locations={[0, 0.18, 0.52, 1]}
          style={StyleSheet.absoluteFill}
          pointerEvents="none"
        />

        <ScrollView
          style={styles.flex}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          bounces={false}
        >
            <View style={styles.spacer} />

            <View style={styles.heroCopy}>
              <Text style={styles.heroTitle}>{t('feedbackScreen.heading')}</Text>
              <Text style={styles.heroSubtitle}>{t('feedbackScreen.subtitle')}</Text>
            </View>

            <View
              style={[
                styles.formCard,
                {
                  backgroundColor: theme.surface,
                  borderColor: theme.border || 'rgba(0,0,0,0.08)',
                  paddingBottom: Math.max(insets.bottom, 10),
                },
              ]}
            >
              <TextInput
                style={[
                  styles.messageInput,
                  {
                    backgroundColor: theme.background,
                    borderColor: theme.border,
                    color: theme.text,
                  },
                ]}
                value={message}
                onChangeText={setMessage}
                placeholder={t('feedbackScreen.messagePlaceholder')}
                placeholderTextColor={theme.textTertiary}
                multiline
                textAlignVertical="top"
                editable={!sending}
              />

              <Text style={[styles.label, { color: theme.text }]}>
                {t('feedbackScreen.emailLabel')}
              </Text>
              <TextInput
                style={[
                  styles.emailInput,
                  {
                    backgroundColor: theme.background,
                    borderColor: theme.border,
                    color: theme.text,
                  },
                ]}
                value={senderEmail}
                onChangeText={setSenderEmail}
                placeholder={t('feedbackScreen.emailPlaceholder')}
                placeholderTextColor={theme.textTertiary}
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
                editable={!sending}
              />

              <TouchableOpacity
                style={[styles.sendButton, !canSend && styles.sendButtonDisabled]}
                onPress={handleSend}
                disabled={!canSend}
                activeOpacity={0.85}
              >
                {sending ? (
                  <ActivityIndicator color="#FFFFFF" />
                ) : (
                  <Text style={styles.sendButtonText}>{t('feedbackScreen.send')}</Text>
                )}
              </TouchableOpacity>
            </View>
          </ScrollView>
      </View>

        {SHOW_UNDERLAY_ARROWS && (
          <>
            {headerIndex > 0 && (
              <TouchableOpacity
                style={[styles.headerNavBtn, styles.headerNavLeft]}
                onPress={() => setHeaderIndex((i) => i - 1)}
                hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
              >
                <Ionicons name="chevron-back" size={22} color="#B8B8B8" />
              </TouchableOpacity>
            )}
            {headerIndex < FEEDBACK_UNDERLAY_IMAGES.length - 1 && (
              <TouchableOpacity
                style={[styles.headerNavBtn, styles.headerNavRight]}
                onPress={() => setHeaderIndex((i) => i + 1)}
                hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
              >
                <Ionicons name="chevron-forward" size={22} color="#B8B8B8" />
              </TouchableOpacity>
            )}
            {SHOW_UNDERLAY_FILE_PILL && (
              <View style={styles.headerFilePill} pointerEvents="none">
                <Text style={styles.headerFileText}>
                  {headerIndex + 1}/{FEEDBACK_UNDERLAY_IMAGES.length}{' '}
                  {FEEDBACK_UNDERLAY_NAMES[headerIndex]}
                </Text>
              </View>
            )}
          </>
        )}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  underlayClip: {
    overflow: 'hidden',
  },
  underlayLetterboxBg: {
    backgroundColor: '#1a1510',
  },
  thanksUnderlayImage: {
    top: -44,
    height: '101%',
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'flex-end',
    paddingBottom: 0,
  },
  spacer: {
    minHeight: 100,
  },
  heroCopy: {
    paddingHorizontal: 20,
    paddingBottom: 12,
  },
  heroTitle: {
    fontSize: 26,
    fontWeight: '700',
    color: '#FFFFFF',
    marginBottom: 6,
    textShadowColor: 'rgba(0,0,0,0.55)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 6,
  },
  heroSubtitle: {
    fontSize: 15,
    lineHeight: 21,
    color: 'rgba(255,255,255,0.95)',
    textShadowColor: 'rgba(0,0,0,0.5)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 5,
    maxWidth: 320,
  },
  formCard: {
    marginHorizontal: 0,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderBottomLeftRadius: 0,
    borderBottomRightRadius: 0,
    borderWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: 0,
    paddingHorizontal: 16,
    paddingTop: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.12,
    shadowRadius: 12,
    elevation: 6,
  },
  thanksCard: {
    paddingTop: 18,
  },
  thanksCardText: {
    fontSize: 15,
    lineHeight: 22,
    textAlign: 'center',
    marginBottom: 14,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 6,
  },
  messageInput: {
    minHeight: 76,
    borderRadius: 12,
    borderWidth: 1.5,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    marginBottom: 14,
  },
  emailInput: {
    height: 44,
    borderRadius: 12,
    borderWidth: 1.5,
    paddingHorizontal: 14,
    fontSize: 16,
    marginBottom: 16,
  },
  sendButton: {
    backgroundColor: '#A86230',
    paddingVertical: 15,
    borderRadius: 12,
    alignItems: 'center',
    alignSelf: 'stretch',
    shadowColor: '#7A3E18',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.28,
    shadowRadius: 4,
    elevation: 3,
  },
  sendButtonDisabled: {
    opacity: 0.55,
  },
  sendButtonText: {
    color: '#FFFFFF',
    fontSize: 17,
    fontWeight: '600',
    letterSpacing: Platform.OS === 'ios' ? -0.41 : 0,
  },
  headerNavBtn: {
    position: 'absolute',
    top: '28%',
    marginTop: -18,
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(40,40,40,0.28)',
    opacity: 0.72,
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
    top: 12,
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
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
});
