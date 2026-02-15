# Future Features - Social Component

## Overview
This document outlines the planned social features and how they would integrate with the current SunNomad app architecture.

## Architecture Considerations

### Current Structure (Ready for Extension)
- ✅ Modular component structure (`src/components/`)
- ✅ Screen-based navigation (`src/screens/`)
- ✅ Service layer for API calls (`src/services/`)
- ✅ i18n system for multi-language support
- ✅ Location tracking already implemented

### New Components Needed

#### 1. Authentication Flow
- Login/Register screens
- Email/Password or OAuth (Google, Apple)
- Session management

#### 2. Profile Management
- Profile screen (`src/screens/ProfileScreen.js`)
- Edit profile screen
- Avatar upload component
- Settings screen

#### 3. Friends System
- Friends list screen (`src/screens/FriendsScreen.js`)
- Friend requests screen
- Add friend functionality
- Friend search

#### 4. Activity Feed
- Feed screen (`src/screens/FeedScreen.js`)
- Activity item component
- Filter by friends/all

#### 5. Notifications
- Notification center screen
- Push notification setup
- In-app notification badges

## Backend Architecture (Supabase)

### Database Schema (PostgreSQL)

```sql
-- Users table (extends Supabase auth.users)
CREATE TABLE profiles (
  id UUID REFERENCES auth.users PRIMARY KEY,
  username TEXT UNIQUE,
  display_name TEXT,
  avatar_url TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Friendships table
CREATE TABLE friendships (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES profiles(id),
  friend_id UUID REFERENCES profiles(id),
  status TEXT CHECK (status IN ('pending', 'accepted', 'blocked')),
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(user_id, friend_id)
);

-- Activities table
CREATE TABLE activities (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES profiles(id),
  type TEXT CHECK (type IN ('trip_started', 'destination_arrived', 'destination_favorited')),
  destination_name TEXT,
  destination_lat DECIMAL,
  destination_lon DECIMAL,
  weather_condition TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Notification preferences
CREATE TABLE notification_preferences (
  user_id UUID REFERENCES profiles(id) PRIMARY KEY,
  friend_activities BOOLEAN DEFAULT true,
  trip_started BOOLEAN DEFAULT true,
  destination_arrived BOOLEAN DEFAULT true
);
```

### Real-time Subscriptions
- Subscribe to friend activities
- Subscribe to friend requests
- Real-time feed updates

### Storage
- Profile images: `avatars/{user_id}/{filename}`
- Public read access for avatars

## Implementation Phases

### Phase 1: Foundation (Week 1)
- [ ] Set up Supabase project
- [ ] Configure authentication
- [ ] Create database schema
- [ ] Basic profile screen

### Phase 2: Friends System (Week 2)
- [ ] Friend search
- [ ] Send/accept friend requests
- [ ] Friends list screen
- [ ] Privacy settings

### Phase 3: Activity Tracking (Week 3)
- [ ] Detect trip start/arrival
- [ ] Create activity records
- [ ] Activity feed screen
- [ ] Filter activities

### Phase 4: Notifications (Week 4)
- [ ] Push notification setup
- [ ] Notification preferences
- [ ] Notification center
- [ ] Real-time updates

## Cost Estimation (5k active users/month)

### Supabase Pro Plan: $25/month
- 8 GB database storage
- 100 GB file storage
- 250 GB bandwidth
- Real-time subscriptions included
- Push notifications via Expo

### Additional Costs
- Expo Push Notifications: Free
- Cloudflare R2 (if needed for images): ~$1-5/month

**Total: ~$25-30/month**

## Code Structure (Future)

```
src/
├── screens/
│   ├── ProfileScreen.js
│   ├── FriendsScreen.js
│   ├── FeedScreen.js
│   └── NotificationScreen.js
├── components/
│   ├── FriendCard.js
│   ├── ActivityItem.js
│   └── Avatar.js
├── services/
│   ├── supabase.js
│   ├── friendsService.js
│   └── activityService.js
└── hooks/
    ├── useAuth.js
    └── useFriends.js
```

## Integration Points

### Current App → Social Features
1. **Trip Detection**: When user changes location significantly, detect trip start
2. **Destination Arrival**: When user taps "Drive There" and arrives, create activity
3. **Favorite Destinations**: Allow sharing favorites with friends
4. **Weather Sharing**: Share interesting weather finds with friends

### Privacy Considerations
- Users can choose to be private/public
- Friend-only vs public activities
- Location sharing granularity
- Opt-out from all social features

## Destination Badges System

### Overview
Destinations can earn special badges/awards based on various criteria to help users make better decisions.

### Badge Types

#### 1. 🚗 Worth the Drive
- **Criteria**: Best weather improvement per kilometer/hour of driving
- **Calculation**: `(destination_temp - current_temp) / distance_km`
- **Purpose**: Highlight destinations where the weather gain justifies the distance
- **Display**: Gold badge on map marker + detail screen

#### 2. ☀️ Warm & Dry
- **Criteria**: Maximum warmth with acceptable conditions
- **Requirements**:
  - Highest temperature in search radius
  - Weather condition not rainy
  - Wind speed below threshold (e.g., < 25 km/h)
  - Suitable for day/night (based on time)
- **Purpose**: Find the warmest spot that's actually pleasant
- **Display**: Orange-red badge

#### 3. 🏕️ Best Stop
- **Criteria**: Combined score of weather + surroundings + amenities
- **Requirements**:
  - Good weather score (temp + condition)
  - Nearby amenities (supermarkets, gas stations, parking)
  - POIs (Points of Interest) for campers
  - Requires: Google Places API integration
- **Purpose**: Perfect stop for campers/travelers
- **Display**: Green badge

### Implementation

**Domain Model**: `src/domain/destinationBadge.js`
- Badge types enum
- Badge metadata (icons, colors, priority)
- `calculateBadges()` function (TODO: implement when data available)

**Translations**: Added to `de.json`, `en.json`, `fr.json`
- Badge names
- Badge descriptions

**UI Integration** (Future):
- Badge overlay on map markers
- Badge section in detail screen
- Filter destinations by badge type

### Data Requirements
- Current location
- Destination weather data ✅
- Distance calculations ✅
- Wind speed data (available in OpenWeatherMap) ✅
- Nearby amenities (requires Google Places API) ❌
- Driving time (requires Google Maps Directions API) ❌

### Cost Implications (for Best Stop badge)
- **Google Places API**: $0.017 per request
- **Estimate**: 50 destinations × 1 request = $0.85 per search
- **Optimization**: Cache POI data, limit to top 10 destinations
- **Realistic cost**: ~$5-10/month with moderate usage

## Notes
- Current architecture is modular and ready for extension
- No breaking changes needed to existing code
- Social features can be added incrementally
- All existing features remain functional independently
- Badge system prepared but UI integration pending

