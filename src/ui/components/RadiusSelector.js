import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Modal } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../../theme/ThemeProvider';
import { useUnits } from '../../contexts/UnitContext';
import { formatDistance } from '../../utils/unitConversion';

const RADIUS_OPTIONS = [200, 400, 600, 1500, 3000];

const RadiusSelector = ({ selectedRadius, onRadiusChange }) => {
  const { t } = useTranslation();
  const { theme } = useTheme();
  const { distanceUnit } = useUnits();
  const [modalVisible, setModalVisible] = useState(false);

  const handleSelectRadius = (radius) => {
    onRadiusChange(radius);
    setModalVisible(false);
  };

  return (
    <View style={styles.container}>
      <Text style={[styles.label, { color: theme.text }]}>{t('radius.title')}</Text>
      <TouchableOpacity
        style={[styles.radiusButton, {
          backgroundColor: theme.surface,
          borderColor: theme.border
        }]}
        onPress={() => setModalVisible(true)}
      >
        <Text style={[styles.radiusButtonText, { color: theme.text }]}>
          {formatDistance(selectedRadius, distanceUnit, 0)}
        </Text>
        <Text style={[styles.arrow, { color: theme.textSecondary }]}>▼</Text>
      </TouchableOpacity>

      <Modal
        transparent={true}
        animationType="fade"
        visible={modalVisible}
        onRequestClose={() => setModalVisible(false)}
      >
        <TouchableOpacity
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={() => setModalVisible(false)}
        >
          <View style={[styles.modalContent, { backgroundColor: theme.surface }]}>
            <Text style={[styles.modalTitle, { 
              color: theme.text,
              borderBottomColor: theme.border
            }]}>{t('radius.title')}</Text>
            {RADIUS_OPTIONS.map((radius) => (
              <TouchableOpacity
                key={radius}
                style={[styles.modalOption, { borderBottomColor: theme.background }]}
                onPress={() => handleSelectRadius(radius)}
              >
                <Text
                  style={[
                    styles.modalOptionText,
                    { color: theme.text },
                    selectedRadius === radius && { fontWeight: '700', color: theme.primary },
                  ]}
                >
                  {formatDistance(radius, distanceUnit, 0)}
                </Text>
                {selectedRadius === radius && (
                  <Text style={[styles.checkmark, { color: theme.primary }]}>✓</Text>
                )}
              </TouchableOpacity>
            ))}
          </View>
        </TouchableOpacity>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    marginBottom: 8,
  },
  label: {
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 10,
  },
  radiusButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 18,
    minHeight: 64,
    borderRadius: 8,
    borderWidth: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 3,
    elevation: 3,
  },
  radiusButtonText: {
    fontSize: 20,
    fontWeight: '600',
  },
  arrow: {
    fontSize: 16,
    marginLeft: 8,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalContent: {
    borderRadius: 16,
    width: '80%',
    maxWidth: 400,
    paddingVertical: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: '700',
    paddingHorizontal: 20,
    paddingVertical: 20,
    borderBottomWidth: 2,
  },
  modalOption: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 24,
    minHeight: 72,
    borderBottomWidth: 1,
  },
  modalOptionText: {
    fontSize: 22,
    fontWeight: '500',
  },
  checkmark: {
    fontSize: 28,
    fontWeight: 'bold',
  },
});

export default RadiusSelector;



