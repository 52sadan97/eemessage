import { useEffect, useRef, useCallback } from 'react';
import { PushNotifications } from '@capacitor/push-notifications';
import { API_URL } from '../config';

const isNative = () => window?.Capacitor?.isNativePlatform?.() === true;

/**
 * usePushNotifications hook
 * Handles FCM token registration and push notification listeners on native Android.
 * On web, this is a no-op.
 */
export default function usePushNotifications(currentUser) {
  const tokenRef = useRef(null);

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
    if (!isNative() || !currentUser) return;

    const setup = async () => {
      try {
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
          // We don't show anything here — the app is already open
        });

        // User tapped on a notification
        PushNotifications.addListener('pushNotificationActionPerformed', (notification) => {
          console.log('[FCM] Notification tapped:', notification);
          // Could navigate to specific chat here
        });

      } catch (err) {
        console.error('[FCM] Setup error:', err);
      }
    };

    setup();

    return () => {
      PushNotifications.removeAllListeners();
    };
  }, [currentUser, registerToken]);

  return tokenRef;
}
