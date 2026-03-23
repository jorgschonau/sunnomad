import React from 'react';
import {
  View,
  Text,
  StyleSheet,
} from 'react-native';

const CommunityScreen = () => {

  return (
    <View style={styles.container}>
      <View style={styles.content}>
        <Text style={styles.title}>🌍</Text>
        <Text style={styles.heading}>Community</Text>
        <Text style={styles.subtitle}>Coming Soon</Text>
        <Text style={styles.description}>
          Teile deine Lieblingsorte, entdecke Empfehlungen von anderen Reisenden
          und vernetze dich mit der Community.
        </Text>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  title: {
    fontSize: 64,
    marginBottom: 16,
  },
  heading: {
    fontSize: 32,
    fontWeight: 'bold',
    color: '#2E7D32',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 20,
    color: '#666',
    marginBottom: 24,
  },
  description: {
    fontSize: 16,
    color: '#666',
    textAlign: 'center',
    lineHeight: 24,
    maxWidth: 400,
  },
});

export default CommunityScreen;




