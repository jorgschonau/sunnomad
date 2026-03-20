import React, { createContext, useState, useContext, useEffect } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getLocales } from 'expo-localization';

const UnitContext = createContext();

const getDefaultImperial = () => {
  try {
    const locale = getLocales()[0];
    return locale?.measurementSystem === 'us';
  } catch {
    return false;
  }
};

export const UnitProvider = ({ children }) => {
  const defaultImperial = getDefaultImperial();

  const [useImperial, setUseImperialState] = useState(defaultImperial);
  const [distanceUnit, setDistanceUnit] = useState(defaultImperial ? 'miles' : 'km');
  const [temperatureUnit, setTemperatureUnit] = useState(defaultImperial ? 'fahrenheit' : 'celsius');
  const [windSpeedUnit, setWindSpeedUnit] = useState(defaultImperial ? 'mph' : 'kmh');
  const [precipitationUnit, setPrecipitationUnit] = useState(defaultImperial ? 'inches' : 'mm');
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    loadUnitPreferences();
  }, []);

  const applyImperial = (imperial) => {
    setUseImperialState(imperial);
    setDistanceUnit(imperial ? 'miles' : 'km');
    setTemperatureUnit(imperial ? 'fahrenheit' : 'celsius');
    setWindSpeedUnit(imperial ? 'mph' : 'kmh');
    setPrecipitationUnit(imperial ? 'inches' : 'mm');
  };

  const loadUnitPreferences = async () => {
    try {
      const savedImperial = await AsyncStorage.getItem('useImperial');
      if (savedImperial !== null) {
        applyImperial(savedImperial === 'true');
      }
    } catch (error) {
      console.warn('Failed to load unit preferences:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const setUseImperial = async (imperial) => {
    try {
      applyImperial(imperial);
      await AsyncStorage.setItem('useImperial', imperial.toString());
    } catch (error) {
      console.warn('Failed to save unit preference:', error);
    }
  };

  const value = {
    useImperial,
    setUseImperial,
    distanceUnit,
    temperatureUnit,
    windSpeedUnit,
    precipitationUnit,
    isLoading,
  };

  return <UnitContext.Provider value={value}>{children}</UnitContext.Provider>;
};

export const useUnits = () => {
  const context = useContext(UnitContext);
  if (!context) {
    throw new Error('useUnits must be used within a UnitProvider');
  }
  return context;
};
