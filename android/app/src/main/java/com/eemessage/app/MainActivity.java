package com.eemessage.app;

import android.Manifest;
import android.content.Context;
import android.content.pm.PackageManager;
import android.media.AudioAttributes;
import android.media.AudioFocusRequest;
import android.media.AudioManager;
import android.os.Build;
import android.os.Bundle;
import android.util.Log;
import android.webkit.JavascriptInterface;
import android.webkit.PermissionRequest;
import android.webkit.WebChromeClient;
import android.webkit.WebView;
import android.webkit.WebSettings;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;
import com.getcapacitor.BridgeActivity;
import java.util.ArrayList;
import java.util.List;

public class MainActivity extends BridgeActivity {
    private static final String TAG = "EEMessageNative";
    private static final int PERMISSION_REQUEST_CODE = 100;
    private AudioManager audioManager;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        audioManager = (AudioManager) getSystemService(Context.AUDIO_SERVICE);

        // Request Android runtime permissions FIRST
        requestAppPermissions();

        WebView webView = this.bridge.getWebView();

        // Enable WebRTC-related WebView settings
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setDomStorageEnabled(true);

        // Add Native Audio Bridge
        webView.addJavascriptInterface(new AudioBridge(), "AndroidAudio");

        // Auto-grant WebRTC permissions inside WebView
        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onPermissionRequest(final PermissionRequest request) {
                MainActivity.this.runOnUiThread(() -> request.grant(request.getResources()));
            }
        });
    }

    public class AudioBridge {
        @JavascriptInterface
        public void setSpeakerphoneOn(boolean on) {
            MainActivity.this.runOnUiThread(() -> {
                if (audioManager == null) return;
                try {
                    Log.d(TAG, "Setting speakerphone to: " + on);
                    
                    // 1. Request Audio Focus (Communication mode)
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                        AudioFocusRequest focusRequest = new AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN)
                                .setAudioAttributes(new AudioAttributes.Builder()
                                        .setUsage(AudioAttributes.USAGE_VOICE_COMMUNICATION)
                                        .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                                        .build())
                                .build();
                        audioManager.requestAudioFocus(focusRequest);
                    } else {
                        audioManager.requestAudioFocus(null, AudioManager.STREAM_VOICE_CALL, AudioManager.AUDIOFOCUS_GAIN);
                    }

                    // 2. Set Mode - Crucial for routing to earpiece
                    audioManager.setMode(AudioManager.MODE_IN_COMMUNICATION);
                    
                    // 3. Toggle Speaker
                    audioManager.setSpeakerphoneOn(on);
                    
                    Log.d(TAG, "Audio mode set to COMM + Speaker: " + on);
                } catch (Exception e) {
                    Log.e(TAG, "Error setting audio mode", e);
                }
            });
        }
    }

    private void requestAppPermissions() {
        List<String> permissionsNeeded = new ArrayList<>();

        if (ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) {
            permissionsNeeded.add(Manifest.permission.CAMERA);
        }
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            permissionsNeeded.add(Manifest.permission.RECORD_AUDIO);
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
                permissionsNeeded.add(Manifest.permission.POST_NOTIFICATIONS);
            }
        }

        if (!permissionsNeeded.isEmpty()) {
            ActivityCompat.requestPermissions(this, permissionsNeeded.toArray(new String[0]), PERMISSION_REQUEST_CODE);
        }
    }
}
