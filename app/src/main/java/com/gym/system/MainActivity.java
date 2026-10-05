package com.gym.system;

import android.Manifest;
import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.speech.tts.TextToSpeech;
import android.os.Environment;
import android.print.PrintAttributes;
import android.print.PrintManager;
import android.provider.MediaStore;
import android.webkit.JavascriptInterface;
import android.webkit.PermissionRequest;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import androidx.core.content.FileProvider;

import java.io.File;
import java.io.IOException;
import java.util.Locale;

public class MainActivity extends Activity {
    private TextToSpeech textToSpeech;

    private WebView webView;
    private LocalServer localServer;

    private static final int CAMERA_PERMISSION = 1001;
    private static final int FILE_CHOOSER_REQUEST = 1002;

    private ValueCallback<Uri[]> filePathCallback;
    private Uri cameraOutputUri;
    private PermissionRequest pendingCameraRequest;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        textToSpeech = new TextToSpeech(this, status -> {
            if (status == TextToSpeech.SUCCESS) {
                int result = textToSpeech.setLanguage(Locale.US);

                if (result == TextToSpeech.LANG_MISSING_DATA ||
                    result == TextToSpeech.LANG_NOT_SUPPORTED) {
                    textToSpeech.setLanguage(Locale.getDefault());
                }

                textToSpeech.setSpeechRate(1.0f);
                textToSpeech.setPitch(1.0f);
            }
        });

        webView = new WebView(this);

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(true);
        settings.setAllowContentAccess(true);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setBuiltInZoomControls(false);
        settings.setDisplayZoomControls(false);

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(
                    WebView view,
                    WebResourceRequest request
            ) {
                return handleExternalUrl(request.getUrl());
            }

            @Override
            public boolean shouldOverrideUrlLoading(
                    WebView view,
                    String url
            ) {
                return handleExternalUrl(Uri.parse(url));
            }
        });

        webView.setWebChromeClient(new WebChromeClient() {

            @Override
            public boolean onShowFileChooser(
                    WebView webView,
                    ValueCallback<Uri[]> filePathCallback,
                    FileChooserParams fileChooserParams
            ) {
                if (MainActivity.this.filePathCallback != null) {
                    MainActivity.this.filePathCallback.onReceiveValue(null);
                }

                MainActivity.this.filePathCallback = filePathCallback;

                boolean capture =
                        fileChooserParams.isCaptureEnabled();

                if (capture) {
                    openCamera();
                } else {
                    openGallery(fileChooserParams);
                }

                return true;
            }

            @Override
            public void onPermissionRequest(
                    final PermissionRequest request
            ) {
                runOnUiThread(() -> {
                    if (Build.VERSION.SDK_INT >= 23 &&
                            checkSelfPermission(
                                    Manifest.permission.CAMERA
                            ) != PackageManager.PERMISSION_GRANTED) {

                        pendingCameraRequest = request;
                        requestPermissions(
                                new String[]{Manifest.permission.CAMERA},
                                CAMERA_PERMISSION
                        );
                        return;
                    }

                    request.grant(
                            new String[]{
                                    PermissionRequest.RESOURCE_VIDEO_CAPTURE
                            }
                    );
                });
            }
        });

        webView.addJavascriptInterface(
                new AndroidBridge(),
                "Android"
        );

        setContentView(webView);

        if (Build.VERSION.SDK_INT >= 23 &&
                checkSelfPermission(
                        Manifest.permission.CAMERA
                ) != PackageManager.PERMISSION_GRANTED) {

            requestPermissions(
                    new String[]{Manifest.permission.CAMERA},
                    CAMERA_PERMISSION
            );
        }

        try {
            localServer = new LocalServer(this);
            localServer.start();

            webView.postDelayed(() -> {
                webView.loadUrl(
                        "http://127.0.0.1:8765/"
                );
            }, 300);

        } catch (Exception e) {
            e.printStackTrace();

            webView.loadData(
                    "<h2>Gym System</h2>" +
                    "<p>Failed to start local server.</p>" +
                    "<pre>" +
                    escapeHtml(String.valueOf(e.getMessage())) +
                    "</pre>",
                    "text/html",
                    "UTF-8"
            );
        }
    }

    private boolean handleExternalUrl(Uri uri) {
        if (uri == null) {
            return false;
        }

        String scheme = uri.getScheme();

        if (scheme == null) {
            return false;
        }

        if (scheme.equalsIgnoreCase("http") ||
                scheme.equalsIgnoreCase("https")) {
            return false;
        }

        try {
            Intent intent = new Intent(
                    Intent.ACTION_VIEW,
                    uri
            );

            startActivity(intent);
            return true;

        } catch (ActivityNotFoundException e) {
            return true;
        }
    }

    private void openCamera() {
        if (Build.VERSION.SDK_INT >= 23 &&
                checkSelfPermission(
                        Manifest.permission.CAMERA
                ) != PackageManager.PERMISSION_GRANTED) {

            requestPermissions(
                    new String[]{Manifest.permission.CAMERA},
                    CAMERA_PERMISSION
            );
            return;
        }

        Intent cameraIntent =
                new Intent(MediaStore.ACTION_IMAGE_CAPTURE);

        if (cameraIntent.resolveActivity(
                getPackageManager()
        ) == null) {
            finishFileChooser(null);
            return;
        }

        try {
            File picturesDir = getExternalFilesDir(
                    Environment.DIRECTORY_PICTURES
            );

            if (picturesDir == null) {
                finishFileChooser(null);
                return;
            }

            if (!picturesDir.exists() &&
                    !picturesDir.mkdirs()) {
                finishFileChooser(null);
                return;
            }

            File photoFile = File.createTempFile(
                    "gym_camera_",
                    ".jpg",
                    picturesDir
            );

            cameraOutputUri = FileProvider.getUriForFile(
                    this,
                    getPackageName() + ".fileprovider",
                    photoFile
            );

            cameraIntent.putExtra(
                    MediaStore.EXTRA_OUTPUT,
                    cameraOutputUri
            );

            cameraIntent.addFlags(
                    Intent.FLAG_GRANT_READ_URI_PERMISSION |
                    Intent.FLAG_GRANT_WRITE_URI_PERMISSION
            );

            startActivityForResult(
                    cameraIntent,
                    FILE_CHOOSER_REQUEST
            );

        } catch (IOException e) {
            e.printStackTrace();
            finishFileChooser(null);
        }
    }

    private void openGallery(
            WebChromeClient.FileChooserParams params
    ) {
        Intent intent;

        try {
            intent = params.createIntent();

            if (intent == null) {
                intent = new Intent(
                        Intent.ACTION_OPEN_DOCUMENT
                );
            }
        } catch (Exception e) {
            intent = new Intent(
                    Intent.ACTION_OPEN_DOCUMENT
            );
        }

        intent.addCategory(
                Intent.CATEGORY_OPENABLE
        );

        intent.setType("image/*");

        try {
            startActivityForResult(
                    intent,
                    FILE_CHOOSER_REQUEST
            );
        } catch (ActivityNotFoundException e) {
            finishFileChooser(null);
        }
    }

    private void finishFileChooser(Uri[] results) {
        if (filePathCallback != null) {
            filePathCallback.onReceiveValue(results);
            filePathCallback = null;
        }

        cameraOutputUri = null;
    }

    @Override
    protected void onActivityResult(
            int requestCode,
            int resultCode,
            Intent data
    ) {
        super.onActivityResult(
                requestCode,
                resultCode,
                data
        );

        if (requestCode != FILE_CHOOSER_REQUEST) {
            return;
        }

        if (resultCode == RESULT_OK) {
            if (cameraOutputUri != null) {
                finishFileChooser(
                        new Uri[]{cameraOutputUri}
                );
            } else if (data != null) {
                Uri result = data.getData();

                if (result != null) {
                    finishFileChooser(
                            new Uri[]{result}
                    );
                } else {
                    finishFileChooser(null);
                }
            } else {
                finishFileChooser(null);
            }
        } else {
            finishFileChooser(null);
        }
    }

    @Override
    public void onRequestPermissionsResult(
            int requestCode,
            String[] permissions,
            int[] grantResults
    ) {
        super.onRequestPermissionsResult(
                requestCode,
                permissions,
                grantResults
        );

        if (requestCode == CAMERA_PERMISSION) {
            if (grantResults.length > 0 &&
                    grantResults[0] ==
                            PackageManager.PERMISSION_GRANTED) {

                // If a webpage requested a camera photo,
                // continue the pending native camera operation.
                if (filePathCallback != null &&
                        cameraOutputUri == null) {
                    openCamera();
                }

                if (pendingCameraRequest != null) {
                    pendingCameraRequest.grant(
                            new String[]{
                                    PermissionRequest.RESOURCE_VIDEO_CAPTURE
                            }
                    );
                    pendingCameraRequest = null;
                }
            } else {
                if (pendingCameraRequest != null) {
                    pendingCameraRequest.deny();
                    pendingCameraRequest = null;
                }

                // Cancel any pending webpage file chooser.
                finishFileChooser(null);
            }
        }
    }

    public class AndroidBridge {

        @JavascriptInterface
        public void speak(String text) {
            runOnUiThread(() -> {
                if (textToSpeech == null) {
                    return;
                }

                String message = text == null ? "" : text.trim();

                if (message.isEmpty()) {
                    return;
                }

                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
                    textToSpeech.speak(
                            message,
                            TextToSpeech.QUEUE_FLUSH,
                            null,
                            "gym_voice"
                    );
                } else {
                    textToSpeech.speak(
                            message,
                            TextToSpeech.QUEUE_FLUSH,
                            null
                    );
                }
            });
        }

        @JavascriptInterface
        public void printPage() {
            runOnUiThread(() -> {
                if (webView == null) {
                    return;
                }

                PrintManager printManager =
                        (PrintManager) getSystemService(
                                PRINT_SERVICE
                        );

                if (printManager == null) {
                    return;
                }

                PrintAttributes attributes =
                        new PrintAttributes.Builder()
                                .setMediaSize(
                                        PrintAttributes.MediaSize.ISO_A4
                                )
                                .setMinMargins(
                                        PrintAttributes.Margins.NO_MARGINS
                                )
                                .build();

                printManager.print(
                        "Gym System",
                        webView.createPrintDocumentAdapter(
                                "Gym System"
                        ),
                        attributes
                );
            });
        }
    }

    private String escapeHtml(String value) {
        return value
                .replace("&", "&amp;")
                .replace("<", "&lt;")
                .replace(">", "&gt;")
                .replace("\"", "&quot;")
                .replace("'", "&#39;");
    }

    @Override
    protected void onDestroy() {
        if (localServer != null) {
            localServer.stop();
            localServer = null;
        }

        if (webView != null) {
            webView.destroy();
            webView = null;
        }

        if (textToSpeech != null) {
            textToSpeech.stop();
            textToSpeech.shutdown();
            textToSpeech = null;
        }

        super.onDestroy();
    }

    @Override
    public void onBackPressed() {
        if (webView != null &&
                webView.canGoBack()) {

            webView.goBack();

        } else {
            super.onBackPressed();
        }
    }
}
