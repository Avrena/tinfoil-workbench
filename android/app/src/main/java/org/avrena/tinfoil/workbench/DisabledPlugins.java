package org.avrena.tinfoil.workbench;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Capacitor registers these built-in plugins for every app. Registering a plugin with the same
 * name afterwards replaces it. Workbench needs none of them: all network traffic belongs to the
 * attested SDK in the host worker, cookies are unused, and the web root must never be switched to
 * another directory. Each stub declares the replaced plugin's methods so calls are rejected
 * explicitly; Capacitor leaves calls to undeclared methods unanswered.
 */
public final class DisabledPlugins {

    private DisabledPlugins() {}

    private static void refuse(PluginCall call) {
        call.reject("This capability is disabled in Tinfoil Workbench.");
    }

    /** Native HTTP would bypass the page CSP and the WebView request allowlist. */
    @CapacitorPlugin(name = "CapacitorHttp")
    public static class Http extends Plugin {

        @PluginMethod
        public void request(PluginCall call) {
            refuse(call);
        }

        @PluginMethod
        public void get(PluginCall call) {
            refuse(call);
        }

        @PluginMethod
        public void post(PluginCall call) {
            refuse(call);
        }

        @PluginMethod
        public void put(PluginCall call) {
            refuse(call);
        }

        @PluginMethod
        public void patch(PluginCall call) {
            refuse(call);
        }

        @PluginMethod
        public void delete(PluginCall call) {
            refuse(call);
        }
    }

    /** Cookie manager access from page script. */
    @CapacitorPlugin(name = "CapacitorCookies")
    public static class Cookies extends Plugin {

        @PluginMethod
        public void getCookies(PluginCall call) {
            refuse(call);
        }

        @PluginMethod
        public void setCookie(PluginCall call) {
            refuse(call);
        }

        @PluginMethod
        public void deleteCookie(PluginCall call) {
            refuse(call);
        }

        @PluginMethod
        public void clearCookies(PluginCall call) {
            refuse(call);
        }

        @PluginMethod
        public void clearAllCookies(PluginCall call) {
            refuse(call);
        }
    }

    /** Changing or persisting the server base path would load a different web bundle. */
    @CapacitorPlugin(name = "WebView")
    public static class ServerPath extends Plugin {

        @PluginMethod
        public void setServerAssetPath(PluginCall call) {
            refuse(call);
        }

        @PluginMethod
        public void setServerBasePath(PluginCall call) {
            refuse(call);
        }

        @PluginMethod
        public void getServerBasePath(PluginCall call) {
            refuse(call);
        }

        @PluginMethod
        public void persistServerBasePath(PluginCall call) {
            refuse(call);
        }
    }
}
