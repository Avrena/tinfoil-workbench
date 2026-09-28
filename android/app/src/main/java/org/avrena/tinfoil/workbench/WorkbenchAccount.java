package org.avrena.tinfoil.workbench;

import android.annotation.SuppressLint;
import android.graphics.Bitmap;
import android.graphics.Color;
import android.net.Uri;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.inputmethod.InputMethodManager;
import android.webkit.GeolocationPermissions;
import android.webkit.PermissionRequest;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;
import androidx.activity.ComponentActivity;
import androidx.activity.OnBackPressedCallback;
import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.webkit.Profile;
import androidx.webkit.ProfileStore;
import androidx.webkit.WebMessageCompat;
import androidx.webkit.WebMessagePortCompat;
import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;
import com.getcapacitor.PluginCall;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.util.Collections;
import java.util.Locale;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.regex.Pattern;
import javax.net.ssl.HttpsURLConnection;
import org.json.JSONException;
import org.json.JSONObject;
import org.json.JSONTokener;

/**
 * Tinfoil Chat sign-in on Android (docs/ANDROID-ACCOUNT.md). Tinfoil's own sign-in page runs in a WebView
 * with no bridge and a WebView profile of its own. It is shown over the app while the user signs in and kept
 * hidden afterwards, so the page's Clerk session can issue identity tokens. The host worker reaches it only
 * through a private message port, and only with fixed operations: show and hide the page, fixed page
 * scripts, sign-out and the Chat key exchange. Nothing here reads form fields or evaluates caller-supplied
 * script, and no credential passes through the Workbench page.
 */
final class WorkbenchAccount {

    static final String ORIGIN = "https://chat.tinfoil.sh";
    static final String SIGN_IN_URL = ORIGIN + "/signin";
    static final String TOKEN_URL = "https://api.tinfoil.sh/api/chat/token";
    static final String PORT_MESSAGE = "tinfoil-account-port";
    static final String PROFILE_PREFIX = "account-";
    /** The page may load only Tinfoil's sign-in hosts. Google refuses OAuth in embedded views, so its hosts stay closed. */
    static final Set<String> PAGE_HOSTS = Set.of("chat.tinfoil.sh", "clerk.tinfoil.sh", "accounts.tinfoil.sh");

    private static final Pattern USER_ID = Pattern.compile("user_[A-Za-z0-9_-]{1,190}");
    private static final Pattern SESSION_ID = Pattern.compile("sess_[A-Za-z0-9]{1,190}");
    private static final Pattern BEARER = Pattern.compile("[\\x21-\\x7e]{1,16384}");
    private static final int MAX_BYTES = 65_536;
    private static final int NETWORK_TIMEOUT_MS = 15_000;
    private static final long SCRIPT_TIMEOUT_MS = 15_000;
    private static final long SIGN_OUT_WAIT_MS = 3_000;
    private static final long POLL_MS = 100;
    private static final String NOT_RESPONDING = "Tinfoil sign-in did not respond. Reopen it and try again.";

    // Fixed page scripts, mirroring desktop/account-window.mjs; tests/android-account.test.mjs runs them against a
    // stand-in Clerk page. evaluateJavascript does not await promises, so the asynchronous scripts leave their
    // result in a one-time page global that COLLECT_SCRIPT takes. %SLOT%, %FORCE%, %USER% and %SESSION% are
    // replaced only with validated values.
    static final String SESSION_SCRIPT = """
        (()=>{const slot=%SLOT%;window[slot]=undefined;(async()=>{
          if(location.origin!=="https://chat.tinfoil.sh")return null;
          const clerk=window.Clerk;if(!clerk?.loaded)return null;if(!clerk.user||!clerk.session)return {signedOut:true};
          const id=clerk.user.id,sid=clerk.session.id,user=%USER%,session=%SESSION%;
          if(user&&id!==user)return {changed:'user'};
          if(session&&sid!==session)return {changed:'session'};
          if(typeof clerk.session.status==='string'&&clerk.session.status!=='active')return {signedOut:true};
          const drift=()=>clerk.user?.id!==id?{changed:'user'}:clerk.session?.id!==sid||clerk.session?.user?.id!==id?{changed:'session'}:null;
          let moved=drift();if(moved)return moved;
          if(%FORCE%)await clerk.user.reload();
          moved=drift();if(moved)return moved;
          const bearer=await clerk.session.getToken({skipCache:%FORCE%});
          moved=drift();if(moved)return moved;
          const u=clerk.user,p=u.publicMetadata??{},email=u.primaryEmailAddress;
          return {sessionUserId:id,sessionId:sid,bearer,profile:{id,name:[u.firstName,u.lastName].filter(Boolean).join(' ')||u.username||'Tinfoil account',email:email?.emailAddress??'',emailVerified:email?.verification?.status==='verified',subscriptionStatus:p.chat_subscription_status??null,subscriptionExpiresAt:p.chat_subscription_expires_at??null}};
        })().then(value=>{window[slot]=JSON.stringify({value})},()=>{window[slot]=JSON.stringify({failed:true})});return true;})()""";
    static final String IDENTITY_SCRIPT = """
        (()=>{
          if(location.origin!=="https://chat.tinfoil.sh")return null;
          const clerk=window.Clerk;if(!clerk?.loaded)return null;if(!clerk.user||!clerk.session)return {signedOut:true};
          if(clerk.user.id!==%USER%)return {changed:'user'};
          if(clerk.session.id!==%SESSION%||clerk.session.user?.id!==clerk.user.id)return {changed:'session'};
          return {sessionUserId:clerk.user.id,sessionId:clerk.session.id};
        })()""";
    static final String MANAGE_SCRIPT = """
        (()=>{if(location.origin==="https://chat.tinfoil.sh"&&window.Clerk?.user?.id===%USER%&&window.Clerk.session?.id===%SESSION%){window.Clerk.openUserProfile();return true;}return false;})()""";
    static final String SIGN_OUT_SCRIPT = """
        (()=>{const slot=%SLOT%;window[slot]=undefined;(async()=>{if(location.origin==="https://chat.tinfoil.sh"&&window.Clerk?.session)await window.Clerk.session.end();})().then(()=>{window[slot]=JSON.stringify({value:true})},()=>{window[slot]=JSON.stringify({failed:true})});return true;})()""";
    static final String COLLECT_SCRIPT = """
        (()=>{const slot=%SLOT%,v=window[slot];if(v===undefined)return null;delete window[slot];return v;})()""";

    private final ComponentActivity activity;
    private final WebView page;
    private final Handler main = new Handler(Looper.getMainLooper());
    private final ExecutorService network = Executors.newSingleThreadExecutor();
    private final OnBackPressedCallback back;
    private WebMessagePortCompat port;
    private boolean issued;
    private WebView view;
    private LinearLayout overlay;
    private TextView title, hint, notice;
    private Button close;
    private int navigations;
    private int generation;
    private int channels;

    WorkbenchAccount(ComponentActivity activity, WebView page) {
        this.activity = activity;
        this.page = page;
        // Added after the plugin's handler, so it runs first; enabled only while Tinfoil's page is shown.
        back = new OnBackPressedCallback(false) {
            @Override
            public void handleOnBackPressed() {
                dismiss();
            }
        };
        activity.getOnBackPressedDispatcher().addCallback(activity, back);
    }

    /** Profiles, a private channel and message ports: without them the app stays on developer API keys. */
    static boolean supported() {
        return WebViewFeature.isFeatureSupported(WebViewFeature.MULTI_PROFILE)
            && WebViewFeature.isFeatureSupported(WebViewFeature.CREATE_WEB_MESSAGE_CHANNEL)
            && WebViewFeature.isFeatureSupported(WebViewFeature.POST_WEB_MESSAGE)
            && WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_PORT_SET_MESSAGE_CALLBACK)
            && WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_PORT_POST_MESSAGE)
            && WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_PORT_CLOSE);
    }

    /**
     * A sign-in is not remembered across launches. WebView cannot delete a profile that this process has loaded,
     * so each launch deletes the sign-in profiles of earlier runs before any is loaded.
     */
    static void deleteStoredSessions() {
        if (!WebViewFeature.isFeatureSupported(WebViewFeature.MULTI_PROFILE)) return;
        ProfileStore store = ProfileStore.getInstance();
        for (String name : store.getAllProfileNames()) {
            if (!name.startsWith(PROFILE_PREFIX)) continue;
            try {
                store.deleteProfile(name);
            } catch (IllegalStateException loaded) {
                // Loaded by this process (the activity was recreated); the next launch deletes it.
            }
        }
    }

    // ---- Private channel ------------------------------------------------------------------------

    /** Issues the channel once per page load. mobile/bridge.mjs hands the port to the host worker unread. */
    void issueChannel(PluginCall call) {
        if (!supported()) {
            call.reject("Tinfoil Chat sign-in needs a newer Android System WebView.");
            return;
        }
        if (issued) {
            call.reject("The account channel was already issued.");
            return;
        }
        issued = true;
        WebMessagePortCompat[] ports = WebViewCompat.createWebMessageChannel(page);
        port = ports[0];
        // The callback receives a new wrapper object each time, so the channel is identified by number.
        int channel = ++channels;
        port.setWebMessageCallback(
            new WebMessagePortCompat.WebMessageCallbackCompat() {
                @Override
                public void onMessage(@NonNull WebMessagePortCompat from, @Nullable WebMessageCompat message) {
                    if (channel == channels && port != null && message != null) handle(message.getData());
                }
            }
        );
        WebViewCompat.postWebMessage(page, new WebMessageCompat(PORT_MESSAGE, new WebMessagePortCompat[] { ports[1] }), Uri.parse("https://localhost"));
        call.resolve();
    }

    /** A new page load starts a new host worker without account state: end the old channel and the website session. */
    void pageStarted() {
        if (port != null) {
            try {
                port.close();
            } catch (RuntimeException ignored) {
                // Already closed.
            }
            port = null;
        }
        issued = false;
        channels++;
        clear(null);
    }

    /** The activity is going away: no page script can be awaited, so the page is cleared and destroyed at once. */
    void destroy() {
        if (port != null) {
            try {
                port.close();
            } catch (RuntimeException ignored) {
                // Already closed.
            }
            port = null;
        }
        generation++;
        hide();
        if (view != null) finishClear(view, overlay, null);
        view = null;
        overlay = null;
        network.shutdownNow();
    }

    private void handle(@Nullable String data) {
        int id = 0;
        try {
            JSONObject request = new JSONObject(data == null ? "" : data);
            id = request.getInt("id");
            JSONObject args = request.optJSONObject("args");
            if (args == null) args = new JSONObject();
            switch (request.getString("op")) {
                case "show" -> show(id);
                case "hide" -> {
                    hide();
                    reply(id, true);
                }
                case "session" -> session(id, args.optBoolean("force", false), optionalId(args, "user", USER_ID), optionalId(args, "session", SESSION_ID));
                case "identity" -> identity(id, requiredId(args, "user", USER_ID), requiredId(args, "session", SESSION_ID));
                case "manage" -> manage(id, requiredId(args, "user", USER_ID), requiredId(args, "session", SESSION_ID));
                case "clear" -> clear(id);
                case "exchange" -> exchange(id, args.optString("bearer", ""));
                default -> fail(id, "Unsupported account operation.");
            }
        } catch (JSONException | IllegalArgumentException invalid) {
            fail(id, "The Android sign-in operation was refused.");
        }
    }

    private void reply(int id, @Nullable Object value) {
        try {
            send(new JSONObject().put("id", id).put("ok", true).put("value", value == null ? JSONObject.NULL : value));
        } catch (JSONException ignored) {
            fail(id, NOT_RESPONDING);
        }
    }

    private void fail(int id, String message) {
        try {
            send(new JSONObject().put("id", id).put("ok", false).put("error", message));
        } catch (JSONException ignored) {
            // A fixed string always serializes.
        }
    }

    private void event(String name, @Nullable String host) {
        try {
            JSONObject message = new JSONObject().put("event", name);
            if (host != null) message.put("host", host);
            send(message);
        } catch (JSONException ignored) {
            // Fixed strings always serialize.
        }
    }

    private void send(JSONObject message) {
        if (port != null) port.postMessage(new WebMessageCompat(message.toString()));
    }

    private static @Nullable String optionalId(JSONObject args, String key, Pattern pattern) {
        if (args.isNull(key)) return null;
        String value = args.optString(key, "");
        if (!pattern.matcher(value).matches()) throw new IllegalArgumentException("Invalid " + key);
        return value;
    }

    private static String requiredId(JSONObject args, String key, Pattern pattern) {
        String value = optionalId(args, key, pattern);
        if (value == null) throw new IllegalArgumentException("Missing " + key);
        return value;
    }

    private static String quoted(@Nullable String value) {
        return value == null ? "null" : JSONObject.quote(value);
    }

    private static String slot() {
        return "__workbenchAccount_" + UUID.randomUUID().toString().replace("-", "");
    }

    private static @Nullable Object parse(@Nullable String json) {
        if (json == null) return null;
        try {
            Object value = new JSONTokener(json).nextValue();
            return value == JSONObject.NULL ? null : value;
        } catch (JSONException invalid) {
            return null;
        }
    }

    // ---- Tinfoil's page ---------------------------------------------------------------------

    private boolean onOrigin(@Nullable WebView web) {
        String url = web == null ? null : web.getUrl();
        if (url == null) return false;
        Uri uri = Uri.parse(url);
        return "https".equals(uri.getScheme()) && "chat.tinfoil.sh".equals(uri.getHost()) && uri.getPort() == -1 && uri.getUserInfo() == null;
    }

    private void session(int id, boolean force, @Nullable String user, @Nullable String session) {
        if (!onOrigin(view)) {
            reply(id, null);
            return;
        }
        String slot = slot();
        String script = SESSION_SCRIPT.replace("%SLOT%", JSONObject.quote(slot))
            .replace("%FORCE%", force ? "true" : "false")
            .replace("%USER%", quoted(user))
            .replace("%SESSION%", quoted(session));
        WebView web = view;
        int nav = navigations, gen = generation;
        web.evaluateJavascript(script, started -> collect(id, web, slot, nav, gen, SystemClock.uptimeMillis() + SCRIPT_TIMEOUT_MS));
    }

    /** Takes an asynchronous script's result; a page that moved meanwhile is "not ready" (null), never a sign-out. */
    private void collect(int id, WebView web, String slot, int nav, int gen, long deadline) {
        if (web != view || gen != generation || nav != navigations || !onOrigin(web)) {
            reply(id, null);
            return;
        }
        web.evaluateJavascript(
            COLLECT_SCRIPT.replace("%SLOT%", JSONObject.quote(slot)),
            raw -> {
                Object outer = parse(raw);
                if (!(outer instanceof String)) {
                    if (SystemClock.uptimeMillis() > deadline) fail(id, NOT_RESPONDING);
                    else main.postDelayed(() -> collect(id, web, slot, nav, gen, deadline), POLL_MS);
                    return;
                }
                if (web != view || gen != generation || nav != navigations || !onOrigin(web)) {
                    reply(id, null);
                    return;
                }
                try {
                    JSONObject result = new JSONObject((String) outer);
                    if (result.optBoolean("failed", false)) fail(id, NOT_RESPONDING);
                    else reply(id, result.opt("value"));
                } catch (JSONException invalid) {
                    fail(id, NOT_RESPONDING);
                }
            }
        );
    }

    private void identity(int id, String user, String session) {
        if (!onOrigin(view)) {
            reply(id, null);
            return;
        }
        WebView web = view;
        int nav = navigations, gen = generation;
        web.evaluateJavascript(
            IDENTITY_SCRIPT.replace("%USER%", JSONObject.quote(user)).replace("%SESSION%", JSONObject.quote(session)),
            raw -> reply(id, web == view && gen == generation && nav == navigations && onOrigin(web) ? parse(raw) : null)
        );
    }

    private void manage(int id, String user, String session) {
        if (!onOrigin(view)) {
            fail(id, "The Tinfoil sign-in page is not ready. Try again in a moment.");
            return;
        }
        present(false);
        view.evaluateJavascript(MANAGE_SCRIPT.replace("%USER%", JSONObject.quote(user)).replace("%SESSION%", JSONObject.quote(session)), raw -> reply(id, true));
    }

    private void show(int id) {
        if (view == null) create();
        present(true);
        reply(id, true);
    }

    private void present(boolean signIn) {
        title.setText(signIn ? "Sign in to Tinfoil Chat" : "Tinfoil account");
        hint.setText(
            signIn
                ? "Use your email and password. Google and Apple sign-in are not available in the Android app."
                : "Profile, password and security changes are made on Tinfoil’s page."
        );
        close.setText(signIn ? "Cancel" : "Done");
        notice.setVisibility(View.GONE);
        overlay.setVisibility(View.VISIBLE);
        overlay.bringToFront();
        back.setEnabled(true);
        view.requestFocus();
    }

    private void hide() {
        if (overlay != null && overlay.getVisibility() == View.VISIBLE) {
            InputMethodManager keyboard = activity.getSystemService(InputMethodManager.class);
            if (keyboard != null) keyboard.hideSoftInputFromWindow(overlay.getWindowToken(), 0);
            overlay.setVisibility(View.GONE);
            page.requestFocus();
        }
        back.setEnabled(false);
    }

    /** Back or Cancel: the page is hidden, and the host worker ends a sign-in that is waiting. */
    private void dismiss() {
        hide();
        event("closed", null);
    }

    @SuppressLint("SetJavaScriptEnabled")
    private void create() {
        WebView web = new WebView(activity);
        // A fresh profile per sign-in, set before the first load; earlier ones are deleted at the next launch.
        WebViewCompat.setProfile(web, PROFILE_PREFIX + UUID.randomUUID());
        WebSettings settings = web.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setGeolocationEnabled(false);
        settings.setSupportMultipleWindows(false);
        settings.setJavaScriptCanOpenWindowsAutomatically(false);
        settings.setMediaPlaybackRequiresUserGesture(true);
        web.setDownloadListener((url, agent, disposition, mime, length) -> {});
        web.setWebViewClient(new PageClient());
        web.setWebChromeClient(new PageChrome());

        LinearLayout root = new LinearLayout(activity);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(Color.rgb(30, 30, 30));
        root.setClickable(true);
        root.setFocusable(true);
        LinearLayout bar = new LinearLayout(activity);
        bar.setOrientation(LinearLayout.HORIZONTAL);
        bar.setGravity(Gravity.CENTER_VERTICAL);
        bar.setPadding(dp(16), dp(8), dp(8), dp(8));
        LinearLayout texts = new LinearLayout(activity);
        texts.setOrientation(LinearLayout.VERTICAL);
        title = text(16, Color.rgb(230, 232, 236));
        hint = text(12, Color.rgb(184, 188, 196));
        texts.addView(title);
        texts.addView(hint);
        close = new Button(activity);
        close.setAllCaps(false);
        close.setOnClickListener(v -> dismiss());
        bar.addView(texts, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1));
        bar.addView(close);
        notice = text(13, Color.rgb(240, 209, 205));
        notice.setBackgroundColor(Color.rgb(73, 50, 48));
        notice.setPadding(dp(16), dp(10), dp(16), dp(10));
        notice.setVisibility(View.GONE);
        root.addView(bar);
        root.addView(notice);
        root.addView(web, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1));
        // Kept clear of the status bar, navigation bar and cutout; the keyboard is handled by the window.
        ViewCompat.setOnApplyWindowInsetsListener(root, (v, insets) -> {
            Insets bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout());
            v.setPadding(bars.left, bars.top, bars.right, bars.bottom);
            return WindowInsetsCompat.CONSUMED;
        });
        activity.addContentView(root, new ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        ViewCompat.requestApplyInsets(root);
        overlay = root;
        view = web;
        web.loadUrl(SIGN_IN_URL);
    }

    private TextView text(int sp, int color) {
        TextView label = new TextView(activity);
        label.setTextSize(TypedValue.COMPLEX_UNIT_SP, sp);
        label.setTextColor(color);
        return label;
    }

    private int dp(int value) {
        return Math.round(value * activity.getResources().getDisplayMetrics().density);
    }

    /**
     * Sign-out and cancellation. The Clerk session is ended where the page allows it, then the profile's cookies
     * and storage are cleared and the page destroyed. The profile's files are deleted at the next launch.
     */
    private void clear(@Nullable Integer id) {
        generation++;
        hide();
        WebView web = view;
        LinearLayout box = overlay;
        view = null;
        overlay = null;
        if (web == null) {
            if (id != null) reply(id, true);
            return;
        }
        if (!onOrigin(web)) {
            finishClear(web, box, id);
            return;
        }
        String slot = slot();
        long deadline = SystemClock.uptimeMillis() + SIGN_OUT_WAIT_MS;
        web.evaluateJavascript(SIGN_OUT_SCRIPT.replace("%SLOT%", JSONObject.quote(slot)), started -> awaitSignOut(web, box, slot, deadline, id));
    }

    private void awaitSignOut(WebView web, LinearLayout box, String slot, long deadline, @Nullable Integer id) {
        web.evaluateJavascript(
            COLLECT_SCRIPT.replace("%SLOT%", JSONObject.quote(slot)),
            raw -> {
                if (parse(raw) instanceof String || SystemClock.uptimeMillis() > deadline) finishClear(web, box, id);
                else main.postDelayed(() -> awaitSignOut(web, box, slot, deadline, id), POLL_MS);
            }
        );
    }

    private void finishClear(WebView web, @Nullable LinearLayout box, @Nullable Integer id) {
        try {
            Profile profile = WebViewCompat.getProfile(web);
            profile.getCookieManager().removeAllCookies(null);
            profile.getWebStorage().deleteAllData();
        } catch (IllegalStateException | UnsupportedOperationException ignored) {
            // Already destroyed; the profile is deleted at the next launch either way.
        }
        web.clearCache(true);
        if (box != null && box.getParent() instanceof ViewGroup parent) parent.removeView(box);
        web.destroy();
        if (id != null) reply(id, true);
    }

    private void refuse(Uri url) {
        String host = url.getHost() == null ? "" : url.getHost().toLowerCase(Locale.ROOT);
        boolean social = host.startsWith("accounts.google.") || host.equals("appleid.apple.com");
        notice.setText(
            social
                ? "Google and Apple sign-in are not available in the Android app. Sign in with your email and password."
                : "The sign-in page tried to open " + host + ", which Workbench does not open here."
        );
        notice.setVisibility(View.VISIBLE);
        event("blocked", host);
        // A refused redirect can leave the page between hosts; return to Tinfoil's sign-in page.
        if (view != null && !onOrigin(view)) view.loadUrl(SIGN_IN_URL);
    }

    static boolean allowedPage(Uri url) {
        String host = url.getHost();
        return "https".equals(url.getScheme()) && url.getUserInfo() == null && url.getPort() == -1 && host != null && PAGE_HOSTS.contains(host.toLowerCase(Locale.ROOT));
    }

    /** Sub-resources and frames: HTTPS only, as in the desktop sign-in window's partition. */
    static boolean allowedResource(Uri url) {
        String scheme = url.getScheme();
        if ("data".equals(scheme) || "blob".equals(scheme) || "about".equals(scheme)) return true;
        return "https".equals(scheme) && url.getUserInfo() == null;
    }

    private final class PageClient extends WebViewClient {

        @Override
        public boolean shouldOverrideUrlLoading(WebView web, WebResourceRequest request) {
            if (web != view) return true; // a page that is being cleared goes nowhere
            if (!request.isForMainFrame()) return !allowedResource(request.getUrl());
            if (allowedPage(request.getUrl())) return false;
            refuse(request.getUrl());
            return true;
        }

        @Override
        public WebResourceResponse shouldInterceptRequest(WebView web, WebResourceRequest request) {
            if (allowedResource(request.getUrl())) return null;
            return new WebResourceResponse("text/plain", "utf-8", 403, "Blocked", Collections.emptyMap(), new ByteArrayInputStream(new byte[0]));
        }

        @Override
        public void onPageStarted(WebView web, String url, Bitmap favicon) {
            if (web == view) navigations++;
        }

        @Override
        public boolean onRenderProcessGone(WebView web, RenderProcessGoneDetail detail) {
            if (web == view) {
                LinearLayout box = overlay;
                view = null;
                overlay = null;
                generation++;
                hide();
                if (box != null && box.getParent() instanceof ViewGroup parent) parent.removeView(box);
                event("gone", null);
            }
            web.destroy();
            return true;
        }
    }

    private static final class PageChrome extends WebChromeClient {

        @Override
        public void onPermissionRequest(PermissionRequest request) {
            request.deny();
        }

        @Override
        public void onGeolocationPermissionsShowPrompt(String origin, GeolocationPermissions.Callback callback) {
            callback.invoke(origin, false, false);
        }

        @Override
        public boolean onShowFileChooser(WebView web, ValueCallback<Uri[]> callback, FileChooserParams params) {
            callback.onReceiveValue(null);
            return true;
        }
    }

    // ---- Chat key exchange --------------------------------------------------------------------

    /**
     * The fixed exchange, run natively so the host worker receives the Date and Retry-After headers its renewal
     * rules need (a cross-origin response hides them). No redirects, a 15-second timeout, and at most one byte
     * over the 64 KiB limit is read, so AccountSession applies the limit itself.
     */
    private void exchange(int id, String bearer) {
        if (!BEARER.matcher(bearer).matches()) {
            fail(id, "Your Tinfoil session is unavailable. Sign in again.");
            return;
        }
        network.execute(() -> {
            JSONObject result = null;
            HttpsURLConnection connection = null;
            try {
                connection = (HttpsURLConnection) URI.create(TOKEN_URL).toURL().openConnection();
                connection.setInstanceFollowRedirects(false);
                connection.setUseCaches(false);
                connection.setConnectTimeout(NETWORK_TIMEOUT_MS);
                connection.setReadTimeout(NETWORK_TIMEOUT_MS);
                connection.setRequestProperty("Authorization", "Bearer " + bearer);
                connection.setRequestProperty("Accept", "application/json");
                int status = connection.getResponseCode();
                InputStream stream = status >= 400 ? connection.getErrorStream() : connection.getInputStream();
                byte[] body = stream == null ? new byte[0] : readAtMost(stream, MAX_BYTES + 1);
                result = new JSONObject()
                    .put("status", status)
                    .put("date", header(connection, "Date"))
                    .put("retryAfter", header(connection, "Retry-After"))
                    .put("contentLength", header(connection, "Content-Length"))
                    .put("body", new String(body, StandardCharsets.UTF_8));
            } catch (IOException | JSONException | ClassCastException failed) {
                result = null;
            } finally {
                if (connection != null) connection.disconnect();
            }
            JSONObject done = result;
            main.post(() -> {
                if (done != null) reply(id, done);
                else fail(id, "Tinfoil account access failed. Check your connection and sign-in session.");
            });
        });
    }

    private static Object header(HttpsURLConnection connection, String name) {
        String value = connection.getHeaderField(name);
        return value == null || value.length() > 200 ? JSONObject.NULL : value;
    }

    private static byte[] readAtMost(InputStream stream, int limit) throws IOException {
        try (InputStream in = stream) {
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buffer = new byte[8192];
            int read;
            while (out.size() < limit && (read = in.read(buffer, 0, Math.min(buffer.length, limit - out.size()))) != -1) out.write(buffer, 0, read);
            return out.toByteArray();
        }
    }
}
