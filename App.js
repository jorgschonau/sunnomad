import 'react-native-gesture-handler';
import React, { useEffect, useState, useCallback } from 'react';
import { ActivityIndicator, View, Image, Text, StyleSheet } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { NavigationContainer } from '@react-navigation/native';
import { createStackNavigator } from '@react-navigation/stack';
import * as SplashScreen from 'expo-splash-screen';
import { useFonts, Yellowtail_400Regular } from '@expo-google-fonts/yellowtail';
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
  const [splashPhase, setSplashPhase] = useState('intro');
  const [fontsLoaded] = useFonts({ Yellowtail_400Regular });

  useEffect(() => {
    const introTimer = setTimeout(() => setSplashPhase('main'), 3500);
    const mainTimer = setTimeout(() => setSplashPhase('done'), 8000);
    return () => { clearTimeout(introTimer); clearTimeout(mainTimer); };
  }, []);

  const onSplashLayout = useCallback(() => {
    SplashScreen.hideAsync();
  }, []);

  if (splashPhase === 'intro') {
    return (
      <View style={splashStyles.container} onLayout={onSplashLayout}>
        <Image
          source={require('./assets/goldieapps.png')}
          style={splashStyles.introLogo}
          resizeMode="contain"
        />
        <Text style={[splashStyles.presentsText, fontsLoaded && { fontFamily: 'Yellowtail_400Regular' }]}>Goldie presents</Text>
      </View>
    );
  }

  if (splashPhase === 'main' || loading) {
    return (
      <View style={[splashStyles.container, { paddingBottom: 60 }]}>
        <Image
          source={require('./assets/sunnomad-logo.png')}
          style={splashStyles.logo}
          resizeMode="contain"
        />
      </View>
    );
  }

  return (
    <NavigationContainer>
      {isAuthenticated ? <MainNavigator /> : <AuthNavigator />}
    </NavigationContainer>
  );
}

const splashStyles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F5F0EB',
    justifyContent: 'center',
    alignItems: 'center',
  },
  introLogo: {
    width: 160,
    height: 160,
  },
  presentsText: {
    marginTop: 14,
    fontSize: 30,
    color: '#8B6914',
    letterSpacing: 1,
  },
  logo: {
    width: '85%',
    height: 140,
  },
});

export default function App() {
  return (
    <ThemeProvider>
      <UnitProvider>
        <AuthProvider>
          <StatusBar style="dark" backgroundColor="#F5F0EB" />
          <RootNavigator />
        </AuthProvider>
      </UnitProvider>
    </ThemeProvider>
  );
}
