import 'react-native-gesture-handler';
import React, { useEffect } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createStackNavigator } from '@react-navigation/stack';
import * as SplashScreen from 'expo-splash-screen';
import Toast from 'react-native-toast-message';

import MapScreen from './src/ui/screens/MapScreen';
import SettingsScreen from './src/ui/screens/SettingsScreen';
import DestinationDetailScreen from './src/ui/screens/DestinationDetailScreen';
import FavouritesScreen from './src/ui/screens/FavouritesScreen';
import LoginScreen from './src/ui/screens/LoginScreen';
import RegisterScreen from './src/ui/screens/RegisterScreen';
import ProfileScreen from './src/ui/screens/ProfileScreen';

import { ThemeProvider, useTheme } from './src/theme/ThemeProvider';
import { AuthProvider } from './src/contexts/AuthContext';
import './src/i18n';
import { useTranslation } from 'react-i18next';

const Stack = createStackNavigator();

// Keep the splash screen visible while we fetch resources
SplashScreen.preventAutoHideAsync();

function AppNavigator() {
  const { theme } = useTheme();
  const { t } = useTranslation();

  useEffect(() => {
    const prepare = async () => {
      // Keep splash screen visible for 2.5 seconds (0.5 sec longer fade-out)
      await new Promise(resolve => setTimeout(resolve, 2500));
      await SplashScreen.hideAsync();
    };
    prepare();
  }, []);

  return (
    <NavigationContainer>
      <Stack.Navigator
        initialRouteName="Map"
        screenOptions={{
          headerStyle: {
            backgroundColor: theme.background,
          },
          headerTintColor: theme.text,
          headerTitleStyle: {
            fontWeight: 'bold',
          },
        }}
      >
        {/* Main App Screens */}
        <Stack.Screen
          name="Map"
          component={MapScreen}
          options={{
            title: t('app.title'),
            headerBackTitle: t('app.back'),
          }}
        />
        <Stack.Screen
          name="Settings"
          component={SettingsScreen}
          options={{
            title: t('app.settings'),
            headerBackTitle: t('app.back'),
          }}
        />
        <Stack.Screen
          name="DestinationDetail"
          component={DestinationDetailScreen}
          options={{
            title: t('app.title'),
            headerBackTitle: t('app.back'),
          }}
        />
        <Stack.Screen
          name="Favourites"
          component={FavouritesScreen}
          options={{
            title: t('app.favourites'),
            headerBackTitle: t('app.back'),
          }}
        />

        {/* Auth Screens */}
        <Stack.Screen
          name="Login"
          component={LoginScreen}
          options={{
            title: t('auth.login'),
            headerBackTitle: t('app.back'),
          }}
        />
        <Stack.Screen
          name="Register"
          component={RegisterScreen}
          options={{
            title: t('auth.signUp'),
            headerBackTitle: t('app.back'),
          }}
        />
        <Stack.Screen
          name="Profile"
          component={ProfileScreen}
          options={{
            title: t('profile.title', 'Profile'),
            headerBackTitle: t('app.back'),
          }}
        />
      </Stack.Navigator>
    </NavigationContainer>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <AppNavigator />
        <Toast />
      </AuthProvider>
    </ThemeProvider>
  );
}
