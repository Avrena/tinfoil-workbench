package org.avrena.tinfoil.workbench;

import android.app.AlertDialog;
import android.graphics.Bitmap;
import android.net.Uri;
import android.os.Bundle;
import android.webkit.GeolocationPermissions;
import android.webkit.PermissionRequest;
import android.webkit.ValueCallback;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import androidx.webkit.WebViewFeature;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebChromeClient;
import com.getcapacitor.BridgeWebViewClient;
import java.io.ByteArrayInputStream;
import java.util.Collections;
import java.util.Locale;

/**
 * Hosts the Workbench page with the Android equivalents of the desktop session restrictions
 * (desktop/main.mjs): the page stays on its own origin, network requests are limited to the app
 * itself and Tinfoil's attested service hosts, and web content cannot open file choosers or
 * request device permissions. Capacitor's built-in native HTTP, cookie and server-path plugins are
 * replaced by stubs so page script has no network route around those limits.
 */
public class MainActivity extends BridgeActivity {

    private static final String APP_HOST = "localhost";
    private WorkbenchAccount account;

    /** Tinfoil Chat sign-in (docs/ANDROID-ACCOUNT.md); null when this WebView cannot support it. */
    WorkbenchAccount account() {
        return account;
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        registerPlugin(WorkbenchPlugin.class);
        registerPlugin(DisabledPlugins.Http.class);
        registerPlugin(DisabledPlugins.Cookies.class);
        registerPlugin(DisabledPlugins.ServerPath.class);
        super.onCreate(savedInstanceState);
        if (getBridge() == null) return; // No WebView is installed; Capacitor shows its own message.

        WebView webView = getBridge().getWebView();
        // The native bridge must be origin-restricted; older WebViews fall back to an interface that
        // every frame could reach, including model-generated HTML previews.
        if (!WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)
            || !WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) {
            webView.stopLoading();
            webView.removeJavascriptInterface("androidBridge");
            webView.loadUrl("about:blank");
            new AlertDialog.Builder(this)
                .setTitle(R.string.webview_update_title)
                .setMessage(R.string.webview_update_message)
                .setCancelable(false)
                .setPositiveButton(android.R.string.ok, (dialog, which) -> finish())
                .show();
            return;
        }

        // Sign-in profiles of earlier runs are deleted before any profile is loaded in this process.
        if (WorkbenchAccount.supported()) {
            WorkbenchAccount.deleteStoredSessions();
            account = new WorkbenchAccount(this, webView);
        }

        WebSettings settings = webView.getSettings();
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setGeolocationEnabled(false);
        settings.setJavaScriptCanOpenWindowsAutomatically(false);
        settings.setSupportMultipleWindows(false);

        getBridge().setWebViewClient(new BridgeWebViewClient(getBridge()) {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                if (!allowedRequest(request.getUrl())) return blocked();
                return super.shouldInterceptRequest(view, request);
            }

            @Override
            public void onPageStarted(WebView view, String url, Bitmap favicon) {
                super.onPageStarted(view, url, favicon);
                // A new page gets a new host worker: the old account channel and website session end.
                if (account != null) account.pageStarted();
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                // Links leave the app only through the confirmed open.url command.
                Uri url = request.getUrl();
                return !("https".equals(url.getScheme()) && APP_HOST.equals(url.getHost()));
            }
        });
        webView.setWebChromeClient(new BridgeWebChromeClient(getBridge()) {
            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                // Attachments and imports use the native document picker through the host.
                callback.onReceiveValue(null);
                return true;
            }

            @Override
            public void onPermissionRequest(PermissionRequest request) {
                request.deny();
            }

            @Override
            public void onGeolocationPermissionsShowPrompt(String origin, GeolocationPermissions.Callback callback) {
                callback.invoke(origin, false, false);
            }
        });
    }

    @Override
    public void onDestroy() {
        if (account != null) account.destroy();
        super.onDestroy();
    }

    /** The app's own files, and HTTPS to Tinfoil's attested service hosts. Everything else is refused. */
    static boolean allowedRequest(Uri url) {
        String scheme = url.getScheme(), host = url.getHost();
        if (host == null || !"https".equals(scheme) || url.getUserInfo() != null) return "data".equals(scheme) || "blob".equals(scheme);
        host = host.toLowerCase(Locale.ROOT);
        if (APP_HOST.equals(host)) return url.getPort() == -1;
        return host.endsWith(".tinfoil.sh") && (url.getPort() == -1 || url.getPort() == 443);
    }

    private static WebResourceResponse blocked() {
        return new WebResourceResponse("text/plain", "utf-8", 403, "Blocked", Collections.emptyMap(), new ByteArrayInputStream(new byte[0]));
    }
}
