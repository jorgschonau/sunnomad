import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Alert,
  Image,
  Animated,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { useFocusEffect } from '@react-navigation/native';
import { useTheme } from '../../theme/ThemeProvider';
import { useAuth } from '../../contexts/AuthContext';
import { submitFeedback } from '../../services/feedbackService';
import { mixpanel } from '../../services/mixpanel';

const AUTO_CLOSE_MS = 6000;
const GOLDIE_HEIGHT = 179;

const goldieThanks = require('../../../assets/goldie-feedback-thanks.png');

function FeedbackSuccessView({ theme, t, onBack }) {
  const fade = useRef(new Animated.Value(0)).current;
  const scale = useRef(new Animated.Value(0.94)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fade, {
        toValue: 1,
        duration: 300,
        useNativeDriver: true,
      }),
      Animated.timing(scale, {
        toValue: 1,
        duration: 300,
        useNativeDriver: true,
      }),
    ]).start();
  }, [fade, scale]);

  return (
    <View style={[styles.flex, { backgroundColor: theme.background }]}>
      <ScrollView
        style={styles.flex}
        contentContainerStyle={styles.successScroll}
        showsVerticalScrollIndicator={false}
        bounces={false}
      >
        <Animated.View
          style={[
            styles.goldieWrap,
            { opacity: fade, transform: [{ scale }] },
          ]}
        >
          <Image
            source={goldieThanks}
            style={styles.goldieImage}
            resizeMode="contain"
            accessibilityLabel="Goldie"
          />
        </Animated.View>

        <Text style={[styles.successHeadline, { color: theme.text }]}>
          {t('feedbackScreen.successTitle')}
        </Text>
        <Text style={[styles.successSubtitle, { color: theme.textSecondary }]}>
          {t('feedbackScreen.successSubtitle')}
        </Text>

        <TouchableOpacity
          style={[styles.sendButton, styles.successButton]}
          onPress={onBack}
          activeOpacity={0.85}
        >
          <Text style={styles.sendButtonText}>{t('feedbackScreen.backToMap')}</Text>
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}

export default function FeedbackScreen({ navigation }) {
  const { t } = useTranslation();
  const { theme } = useTheme();
  const { user } = useAuth();
  const [message, setMessage] = useState('');
  const [senderEmail, setSenderEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [sending, setSending] = useState(false);

  const canSend = message.trim().length > 0 && !sending;

  useFocusEffect(
    React.useCallback(() => {
      mixpanel.track('Feedback Opened');
    }, [])
  );

  useEffect(() => {
    if (!sent) return undefined;
    const timer = setTimeout(() => {
      if (navigation.canGoBack()) navigation.goBack();
    }, AUTO_CLOSE_MS);
    return () => clearTimeout(timer);
  }, [sent, navigation]);

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

  return (
    <KeyboardAvoidingView
      style={[styles.flex, { backgroundColor: theme.background }]}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView
        style={styles.flex}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <Text style={[styles.title, { color: theme.text }]}>{t('feedbackScreen.heading')}</Text>
        <Text style={[styles.subtitle, { color: theme.textSecondary }]}>
          {t('feedbackScreen.subtitle')}
        </Text>

        <TextInput
          style={[
            styles.messageInput,
            {
              backgroundColor: theme.surface,
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

        <Text style={[styles.label, { color: theme.text }]}>{t('feedbackScreen.emailLabel')}</Text>
        <TextInput
          style={[
            styles.emailInput,
            {
              backgroundColor: theme.surface,
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
          style={[
            styles.sendButton,
            !canSend && styles.sendButtonDisabled,
          ]}
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
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  scrollContent: {
    padding: 20,
    paddingBottom: 40,
  },
  successScroll: {
    paddingTop: 28,
    paddingHorizontal: 24,
    paddingBottom: Platform.OS === 'ios' ? 54 : 44,
    alignItems: 'center',
  },
  goldieWrap: {
    marginBottom: 4,
    alignItems: 'center',
    marginLeft: 10,
  },
  goldieImage: {
    height: GOLDIE_HEIGHT,
    width: GOLDIE_HEIGHT * (4 / 3),
  },
  successHeadline: {
    fontSize: 32,
    fontWeight: '700',
    textAlign: 'center',
    lineHeight: 38,
    letterSpacing: Platform.OS === 'ios' ? 0.37 : 0,
    marginBottom: 12,
  },
  successSubtitle: {
    fontSize: 17,
    fontWeight: '400',
    textAlign: 'center',
    lineHeight: 24,
    letterSpacing: Platform.OS === 'ios' ? -0.41 : 0,
    maxWidth: 320,
  },
  successButton: {
    marginTop: 32,
    alignSelf: 'stretch',
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    marginBottom: 12,
  },
  subtitle: {
    fontSize: 16,
    lineHeight: 24,
    marginBottom: 28,
  },
  label: {
    fontSize: 15,
    fontWeight: '600',
    marginBottom: 8,
  },
  messageInput: {
    minHeight: 160,
    borderRadius: 12,
    borderWidth: 1.5,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 16,
    marginBottom: 20,
  },
  emailInput: {
    height: 48,
    borderRadius: 12,
    borderWidth: 1.5,
    paddingHorizontal: 16,
    fontSize: 16,
    marginBottom: 28,
  },
  sendButton: {
    backgroundColor: '#C87840',
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center',
    alignSelf: 'stretch',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.14,
    shadowRadius: 4,
    elevation: 3,
  },
  sendButtonDisabled: {
    opacity: 0.5,
  },
  sendButtonText: {
    color: '#FFFFFF',
    fontSize: 17,
    fontWeight: '600',
    letterSpacing: Platform.OS === 'ios' ? -0.41 : 0,
  },
});
