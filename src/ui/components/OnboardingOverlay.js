import React from 'react';
import {
  View,
  Text,
  Image,
  StyleSheet,
  TouchableOpacity,
  Modal,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';

const goldieAvatar = require('../../../assets/goldieapps.png');

const STEPS = [
  { icon: 'options-outline', key: 'step1' },
  { icon: 'trophy-outline', key: 'step2' },
  { icon: 'location-outline', key: 'step3' },
  { icon: 'navigate-outline', key: 'step4' },
];

const OnboardingOverlay = ({ visible, onClose }) => {
  const { t } = useTranslation();

  return (
    <Modal
      visible={visible}
      transparent={true}
      animationType="fade"
      onRequestClose={onClose}
    >
      <View style={styles.overlay}>
        <LinearGradient
          colors={['#FFF8F0', '#FFFFFF']}
          style={styles.content}
        >
          <Image source={goldieAvatar} style={styles.avatar} />

          <Text style={styles.title}>{t('onboarding.welcome')}</Text>
          <Text style={styles.tagline}>{t('onboarding.tagline')}</Text>

          <View style={styles.steps}>
            {STEPS.map(({ icon, key }) => (
              <View key={key} style={styles.step}>
                <Ionicons name={icon} size={22} color="#FF8C00" style={styles.stepIcon} />
                <Text style={styles.stepText}>{t(`onboarding.${key}`)}</Text>
              </View>
            ))}
          </View>

          <TouchableOpacity style={styles.buttonWrap} onPress={onClose} activeOpacity={0.85}>
            <LinearGradient
              colors={['#FF8C00', '#FFD700']}
              start={{ x: 0, y: 0.5 }}
              end={{ x: 1, y: 0.5 }}
              style={styles.button}
            >
              <Text style={styles.buttonText}>{t('onboarding.letsGo')}</Text>
            </LinearGradient>
          </TouchableOpacity>
        </LinearGradient>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.75)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  content: {
    borderRadius: 24,
    paddingTop: 24,
    paddingBottom: 28,
    paddingHorizontal: 28,
    width: '100%',
    maxWidth: 380,
    alignItems: 'center',
  },
  avatar: {
    width: 80,
    height: 80,
    borderRadius: 40,
    marginBottom: 12,
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    color: '#1A1A1A',
    textAlign: 'center',
  },
  tagline: {
    fontSize: 15,
    fontWeight: '400',
    fontStyle: 'italic',
    color: '#888',
    marginTop: 4,
    marginBottom: 16,
    textAlign: 'center',
  },
  steps: {
    width: '100%',
    marginBottom: 20,
  },
  step: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 14,
    paddingHorizontal: 4,
  },
  stepIcon: {
    width: 30,
    textAlign: 'center',
    marginRight: 10,
  },
  stepText: {
    flex: 1,
    fontSize: 16,
    fontWeight: '500',
    color: '#333',
    lineHeight: 23,
  },
  buttonWrap: {
    width: '100%',
    borderRadius: 14,
    overflow: 'hidden',
    shadowColor: '#FF8C00',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 8,
    elevation: 8,
  },
  button: {
    paddingVertical: 18,
    alignItems: 'center',
    borderRadius: 14,
  },
  buttonText: {
    fontSize: 20,
    fontWeight: '700',
    color: '#fff',
  },
});

export default OnboardingOverlay;
