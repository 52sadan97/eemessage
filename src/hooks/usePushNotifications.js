import { useEffect, useRef, useCallback } from 'react';
import { API_URL } from '../config';

const isNative = () => window?.Capacitor?.isNativePlatform?.() === true;

/**
 * usePushNotifications hook
 * Handles FCM token registration and push notification listeners on native Android.
 * On web, this is a no-op.
 */
export default function usePushNotifications(currentUser) {
  const tokenRef = useRef(null);
  const setupDoneRef = useRef(false);

  // Register FCM token with server
  const registerToken = useCallback(async (token) => {
    if (!currentUser || !token) return;
    try {
      const authToken = localStorage.getItem('eemessage_token');
      await fetch(`${API_URL}/api/push/register`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`
        },
        body: JSON.stringify({
          userId: currentUser.id,
          fcmToken: token
        })
      });
      console.log('[FCM] Token registered with server');
    } catch (err) {
      console.error('[FCM] Failed to register token:', err);
    }
  }, [currentUser]);

  useEffect(() => {
    if (!isNative() || !currentUser || setupDoneRef.current) return;

    const setup = async () => {
      try {
        const { PushNotifications } = await import('@capacitor/push-notifications');

        // Create notification channel for Android 8+
        try {
          await PushNotifications.createChannel({
            id: 'eemessage_messages',
            name: 'EEMessage Bildirimleri',
            description: 'Mesaj ve arama bildirimleri',
            importance: 5, // MAX importance
            visibility: 1, // PUBLIC — show on lock screen
            sound: 'notification', // uses res/raw/notification.mp3
            vibration: true,
            lights: true,
          });
          console.log('[FCM] Notification channel created');
        } catch (e) {
          console.warn('[FCM] Channel creation error (might already exist):', e);
        }

        // Request permission
        const permResult = await PushNotifications.requestPermissions();
        if (permResult.receive !== 'granted') {
          console.warn('[FCM] Permission not granted');
          return;
        }

        // Register with FCM
        await PushNotifications.register();

        // Listen for token
        PushNotifications.addListener('registration', (token) => {
          console.log('[FCM] Token received:', token.value?.substring(0, 20) + '...');
          tokenRef.current = token.value;
          registerToken(token.value);
        });

        // Token error
        PushNotifications.addListener('registrationError', (err) => {
          console.error('[FCM] Registration error:', err);
        });

        // Notification received while app is in foreground
        PushNotifications.addListener('pushNotificationReceived', (notification) => {
          console.log('[FCM] Foreground notification:', notification);
          // Show local notification since FCM doesn't auto-show in foreground
          try {
            if ('Notification' in window && Notification.permission === 'granted') {
              new Notification(notification.title || 'EEMessage', {
                body: notification.body || '',
                icon: '/app-icon.jpg',
              });
            }
          } catch (e) {
            console.warn('[FCM] Could not show foreground notification:', e);
          }
        });

        // User tapped on a notification
        PushNotifications.addListener('pushNotificationActionPerformed', (action) => {
          console.log('[FCM] Notification tapped:', action);
        });

        setupDoneRef.current = true;
      } catch (err) {
        console.error('[FCM] Setup error:', err);
      }
    };

    setup();

    return () => {
      // Don't remove listeners on re-render, only on unmount
    };
  }, [currentUser, registerToken]);

  return tokenRef;
}
