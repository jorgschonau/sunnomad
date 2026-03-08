import React from 'react';
import { Marker } from 'react-native-maps';
import WeatherMarker from './WeatherMarker'; // Oder wie dein Marker heißt

export default function FavoriteMarkers({ allPlaces, favoriteIds }) {
  // Super simple - keine Tricks, keine Optimierung
  const favorites = allPlaces.filter(place => {
    return favoriteIds.includes(place.id);
  });
  
  console.log('⭐ RENDERING FAVORITES:', favorites.length);
  
  return (
    <>
      {favorites.map((place) => {
        console.log('⭐ Rendering:', place.name);
        return (
          <Marker
            key={`favorite-${place.id}`}
            coordinate={{
              latitude: place.latitude || place.lat,
              longitude: place.longitude || place.lon,
            }}
            zIndex={9999}
            tracksViewChanges={true}
          >
            <WeatherMarker place={place} isFavorite={true} />
          </Marker>
        );
      })}
    </>
  );
}