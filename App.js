import 'react-native-gesture-handler';
import React, { useEffect } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { NavigationContainer } from '@react-navigation/native';
import { createStackNavigator } from '@react-navigation/stack';
import * as SplashScreen from 'expo-splash-screen';

import MapScreen from './src/ui/screens/MapScreen';
import SettingsScreen from './src/ui/screens/SettingsScreen';
import CommunityScreen from './src/ui/screens/CommunityScreen';
import DestinationDetailScreen from './src/ui/screens/DestinationDetailScreen';
import FavouritesScreen from './src/ui/screens/FavouritesScreen';
import LoginScreen from './src/ui/screens/LoginScreen';
import RegisterScreen from './src/ui/screens/RegisterScreen';
import ForgotPasswordScreen from './src/ui/screens/ForgotPasswordScreen';
import ProfileScreen from './src/ui/screens/ProfileScreen';

import { ThemeProvider, useTheme } from './src/theme/ThemeProvider';
import { AuthProvider, useAuth } from './src/contexts/AuthContext';
import { UnitProvider } from './src/contexts/UnitContext';
import './src/i18n';
import { useTranslation } from 'react-i18next';

const AuthStack = createStackNavigator();
const AppStack = createStackNavigator();

// Keep the splash screen visible while we fetch resources
SplashScreen.preventAutoHideAsync();

function AuthNavigator() {
  const { theme } = useTheme();
  const { t } = useTranslation();

  return (
    <AuthStack.Navigator
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
      <AuthStack.Screen
        name="Login"
        component={LoginScreen}
        options={{
          title: t('auth.login'),
          headerShown: false,
        }}
      />
      <AuthStack.Screen
        name="Register"
        component={RegisterScreen}
        options={{
          title: t('auth.signUp'),
          headerBackTitle: t('app.back'),
        }}
      />
      <AuthStack.Screen
        name="ForgotPassword"
        component={ForgotPasswordScreen}
        options={{
          title: t('auth.forgotPasswordTitle'),
          headerBackTitle: t('app.back'),
        }}
      />
    </AuthStack.Navigator>
  );
}

function MainNavigator() {
  const { theme } = useTheme();
  const { t } = useTranslation();

  return (
    <AppStack.Navigator
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
      <AppStack.Screen
        name="Map"
        component={MapScreen}
        options={{
          title: t('app.title'),
          headerBackTitle: t('app.back'),
        }}
      />
      <AppStack.Screen
        name="Settings"
        component={SettingsScreen}
        options={{
          title: t('app.settings'),
          headerBackTitle: t('app.back'),
        }}
      />
      <AppStack.Screen
        name="Community"
        component={CommunityScreen}
        options={{
          title: t('app.community'),
          headerBackTitle: t('app.back'),
        }}
      />
      <AppStack.Screen
        name="DestinationDetail"
        component={DestinationDetailScreen}
        options={{
          title: t('app.title'),
          headerBackTitle: t('app.back'),
        }}
      />
      <AppStack.Screen
        name="Favourites"
        component={FavouritesScreen}
        options={{
          title: t('app.favourites'),
          headerBackTitle: t('app.back'),
        }}
      />
      <AppStack.Screen
        name="Profile"
        component={ProfileScreen}
        options={{
          title: t('profile.title', 'Profile'),
          headerBackTitle: t('app.back'),
        }}
      />
    </AppStack.Navigator>
  );
}

function RootNavigator() {
  const { isAuthenticated, loading } = useAuth();
  const { theme } = useTheme();

  useEffect(() => {
    const prepare = async () => {
      // Keep splash screen visible for 2.5 seconds (0.5 sec longer fade-out)
      await new Promise(resolve => setTimeout(resolve, 2500));
      await SplashScreen.hideAsync();
    };
    prepare();
  }, []);

  // Show loading spinner while checking auth state
  if (loading) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: theme.background }}>
        <ActivityIndicator size="large" color={theme.primary} />
      </View>
    );
  }

  return (
    <NavigationContainer>
      {isAuthenticated ? <MainNavigator /> : <AuthNavigator />}
    </NavigationContainer>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <UnitProvider>
        <AuthProvider>
          <StatusBar style="dark" backgroundColor="#F5E6D3" />
          <RootNavigator />
        </AuthProvider>
      </UnitProvider>
    </ThemeProvider>
  );
}
