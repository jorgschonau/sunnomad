const IS_DEV = process.env.APP_VARIANT === 'development';

export default {
  expo: {
    name: IS_DEV ? 'SunNomad Dev' : 'SunNomad',
    slug: 'sunnomad',
    scheme: IS_DEV ? 'sunnomad-dev' : 'sunnomad',
    version: '1.0.0',
    orientation: 'portrait',
    userInterfaceStyle: 'light',
    splash: {
      backgroundColor: '#F5F0EB',
    },
    icon: './assets/icon.png',
    assetBundlePatterns: ['**/*'],
    ios: {
      supportsTablet: true,
      bundleIdentifier: IS_DEV ? 'com.sunnomad.app.dev' : 'com.sunnomad.app',
      infoPlist: {
        NSLocationWhenInUseUsageDescription: 'SunNomad uses your location to show weather for destinations near you.',
        ITSAppUsesNonExemptEncryption: false,
      },
      config: {
        googleMapsApiKey: 'AIzaSyAcADrrPdRzJK7d_TC3GBajsKviqp0iVBI',
      },
    },
    android: {
      userInterfaceStyle: 'light',
      adaptiveIcon: {
        foregroundImage: './assets/sunnomad-logo.png',
        backgroundColor: '#FF8C42',
      },
      package: IS_DEV ? 'com.sunnomad.app.dev' : 'com.sunnomad.app',
      permissions: ['ACCESS_FINE_LOCATION', 'ACCESS_COARSE_LOCATION'],
      config: {
        googleMaps: {
          apiKey: 'AIzaSyAcADrrPdRzJK7d_TC3GBajsKviqp0iVBI',
        },
      },
    },
    web: {},
    plugins: [
      'expo-font',
      [
        'expo-location',
        {
          locationAlwaysAndWhenInUsePermission:
            'SunNomad nutzt deinen Standort um Reiseziele in deiner Nähe zu finden.',
        },
      ],
      'expo-localization',
      ['@sentry/react-native/expo', {
        organization: 'goldieapps',
        project: 'react-native',
      }],
    ],
    extra: {
      eas: {
        projectId: '5df2c512-288e-4749-93ef-e5cb018de180',
      },
      appVariant: IS_DEV ? 'development' : 'production',
      googleMapsApiKey: 'AIzaSyAcADrrPdRzJK7d_TC3GBajsKviqp0iVBI',
      supabaseUrl: 'https://skkkoxdobvimqpfqzbdx.supabase.co',
      supabaseAnonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNra2tveGRvYnZpbXFwZnF6YmR4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjczMDE0MzAsImV4cCI6MjA4Mjg3NzQzMH0.b6aT0cpaET-M685gL1fj-uwcTWO0e6WNDvqTWhQpH6A',
    },
  },
};
