import React, { createContext, useState, useContext, useEffect } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

const ThemeContext = createContext();

export const themes = {
  standard: {
    id: 'standard',
    primary: '#4E7AA6',
    primaryDark: '#3A6080',
    primaryLight: '#6B97BF',
    background: '#F5F5F5',
    surface: '#FFFFFF',
    text: '#000000',
    textSecondary: '#333333',
    textTertiary: '#666666',
    border: '#424242',
    error: '#D32F2F',
    success: '#2E7D32',
    shadow: '#000000',
  },
  light: {
    id: 'light',
    primary: '#757575',
    primaryDark: '#424242',
    primaryLight: '#9E9E9E',
    background: '#FAFAFA',
    surface: '#FFFFFF',
    text: '#000000',
    textSecondary: '#212121',
    textTertiary: '#757575',
    border: '#E0E0E0',
    error: '#D32F2F',
    success: '#4CAF50',
    shadow: '#000000',
  },
  dark: {
    id: 'dark',
    primary: '#90CAF9',
    primaryDark: '#42A5F5',
    primaryLight: '#BBDEFB',
    background: '#121212',
    surface: '#1E1E1E',
    text: '#FFFFFF',
    textSecondary: '#E0E0E0',
    textTertiary: '#BDBDBD',
    border: '#424242',
    error: '#EF5350',
    success: '#66BB6A',
    shadow: '#000000',
  },
  blue: {
    id: 'blue',
    primary: '#4A7FB5',
    primaryDark: '#2D5A8E',
    primaryLight: '#6B9EC8',
    background: '#EDF3F8',
    surface: '#FAFCFE',
    text: '#2D4A6B',
    textSecondary: '#3A5880',
    textTertiary: '#4A7FB5',
    border: '#BDD0E0',
    error: '#D32F2F',
    success: '#4A7FB5',
    shadow: '#2D5A8E',
  },
  amber: {
    id: 'amber',
    primary: '#C87828',
    primaryDark: '#9E4820',
    primaryLight: '#D4923A',
    background: '#FBF4E8',
    surface: '#FEF9F0',
    text: '#7A4820',
    textSecondary: '#8A5830',
    textTertiary: '#A06830',
    border: '#D4A878',
    error: '#D32F2F',
    success: '#A06830',
    shadow: '#9E4820',
  },
};

export const ThemeProvider = ({ children }) => {
  const [currentTheme, setCurrentTheme] = useState('standard');

  useEffect(() => {
    loadTheme();
  }, []);

  const loadTheme = async () => {
    try {
      const savedTheme = await AsyncStorage.getItem('appTheme');
      if (savedTheme && themes[savedTheme]) {
        setCurrentTheme(savedTheme);
      }
    } catch (error) {
      console.error('Error loading theme:', error);
    }
  };

  const changeTheme = async (themeId) => {
    try {
      await AsyncStorage.setItem('appTheme', themeId);
      setCurrentTheme(themeId);
    } catch (error) {
      console.error('Error saving theme:', error);
    }
  };

  const theme = themes[currentTheme];

  return (
    <ThemeContext.Provider value={{ theme, currentTheme, changeTheme, themes }}>
      {children}
    </ThemeContext.Provider>
  );
};

export const useTheme = () => {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within ThemeProvider');
  }
  return context;
};


