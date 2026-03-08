import * as Haptics from 'expo-haptics';

/**
 * Play haptic feedback ONLY - ultra-fast, no sound, no problems!
 * Sound caused timeouts and UI lag, so we're using ONLY haptics now.
 */
export const playTickSound = () => {
  try {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  } catch (e) {
    // Ignore
  }
};

/**
 * Play a medium haptic feedback for more important interactions
 */
export const playMediumHaptic = async () => {
  try {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  } catch (error) {
    console.debug('Haptic feedback not available:', error.message);
  }
};

/**
 * Play a success haptic feedback
 */
export const playSuccessHaptic = async () => {
  try {
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  } catch (error) {
    console.debug('Haptic feedback not available:', error.message);
  }
};

/**
 * TODO: Play a motor/engine sound effect
 * Requires: Real audio file (engine.mp3/wav) using expo-av Audio.Sound
 * NOTE: Don't use haptic feedback - user wants real sound or nothing!
 */
export const playMotorSound = async () => {
  // Disabled for now - needs real audio implementation
  // User feedback: "keine haptic scheisse! das nervt nur!"
};

/**
 * Cleanup sound resources (no-op since we switched to haptics only)
 */
export const cleanupSound = async () => {};

