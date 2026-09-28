package org.avrena.tinfoil.workbench;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.ActivityNotFoundException;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.ContentResolver;
import android.content.Context;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.provider.OpenableColumns;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.security.keystore.StrongBoxUnavailableException;
import android.util.AtomicFile;
import android.util.Base64;
import androidx.activity.OnBackPressedCallback;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileNotFoundException;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.security.Key;
import java.security.KeyStore;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.concurrent.atomic.AtomicBoolean;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;
import org.json.JSONObject;

/**
 * The fixed native operations used by the Android host (mobile/native-ops.mjs). There is no
 * generic filesystem, network or intent access: files are read or written only through the
 * system document picker the user sees, and the vault is one fixed file in app-private storage.
 */
@CapacitorPlugin(name = "Workbench")
public class WorkbenchPlugin extends Plugin {

    private static final String KEY_ALIAS = "tinfoil-workbench-vault-v1";
    private static final byte[] WRAP_AAD = "tinfoil-workbench:keystore-wrap:v1".getBytes(StandardCharsets.UTF_8);
    private static final String WRAP_PREFIX = "aks1:";
    private static final String VAULT_FILE = "workspace.vault";
    private static final long MAX_VAULT_BYTES = 96L * 1024 * 1024;
    private static final int MAX_PICK_BYTES = 24 * 1024 * 1024;
    private static final int MAX_PICK_COUNT = 16;

    @Override
    public void load() {
        // Back is decided by the page: close its topmost layer, otherwise move the task back.
        getActivity()
            .getOnBackPressedDispatcher()
            .addCallback(
                getActivity(),
                new OnBackPressedCallback(true) {
                    @Override
                    public void handleOnBackPressed() {
                        notifyListeners("backButton", new JSObject(), false);
                    }
                }
            );
    }

    @Override
    protected void handleOnPause() {
        notifyListeners("pause", new JSObject(), false);
    }

    // ---- Encrypted workspace ------------------------------------------------------------------

    private AtomicFile vault() {
        return new AtomicFile(new File(getContext().getFilesDir(), VAULT_FILE));
    }

    @PluginMethod
    public void vaultRead(PluginCall call) {
        AtomicFile file = vault();
        JSObject result = new JSObject();
        try {
            if (file.getBaseFile().length() > MAX_VAULT_BYTES) {
                call.reject("The encrypted workspace exceeds its size limit.");
                return;
            }
            result.put("envelope", new String(file.readFully(), StandardCharsets.UTF_8));
        } catch (FileNotFoundException missing) {
            result.put("envelope", JSONObject.NULL);
        } catch (IOException error) {
            call.reject("The encrypted workspace could not be read.");
            return;
        }
        call.resolve(result);
    }

    @PluginMethod
    public void vaultWrite(PluginCall call) {
        String envelope = call.getString("envelope");
        if (envelope == null || envelope.isEmpty() || envelope.length() > MAX_VAULT_BYTES) {
            call.reject("The encrypted workspace could not be saved.");
            return;
        }
        // AtomicFile writes a new file, syncs it and renames it over the old one.
        AtomicFile file = vault();
        FileOutputStream out = null;
        try {
            out = file.startWrite();
            out.write(envelope.getBytes(StandardCharsets.UTF_8));
            file.finishWrite(out);
            call.resolve();
        } catch (IOException error) {
            if (out != null) file.failWrite(out);
            call.reject("The encrypted workspace could not be saved.");
        }
    }

    // ---- Android Keystore protection of the random workspace data key -------------------------

    private static SecretKey keystoreKey(boolean create) throws Exception {
        KeyStore keyStore = KeyStore.getInstance("AndroidKeyStore");
        keyStore.load(null);
        Key existing = keyStore.getKey(KEY_ALIAS, null);
        if (existing instanceof SecretKey) return (SecretKey) existing;
        if (!create) throw new IllegalStateException("The workspace key is not present in the Android Keystore.");
        if (Build.VERSION.SDK_INT >= 28) {
            try {
                return generate(true);
            } catch (StrongBoxUnavailableException unavailable) {
                // Fall back to the TEE-backed keystore on devices without StrongBox.
            }
        }
        return generate(false);
    }

    private static SecretKey generate(boolean strongBox) throws Exception {
        KeyGenParameterSpec.Builder spec = new KeyGenParameterSpec.Builder(
            KEY_ALIAS,
            KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT
        )
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setKeySize(256)
            .setRandomizedEncryptionRequired(true);
        if (strongBox && Build.VERSION.SDK_INT >= 28) spec.setIsStrongBoxBacked(true);
        KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
        generator.init(spec.build());
        return generator.generateKey();
    }

    @PluginMethod
    public void keyWrap(PluginCall call) {
        byte[] key = decode(call.getString("key"));
        try {
            if (key == null || key.length != 32) {
                call.reject("The workspace key is invalid.");
                return;
            }
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.ENCRYPT_MODE, keystoreKey(true));
            cipher.updateAAD(WRAP_AAD);
            byte[] sealed = cipher.doFinal(key);
            JSObject result = new JSObject();
            result.put("wrapped", WRAP_PREFIX + encode(cipher.getIV()) + ":" + encode(sealed));
            call.resolve(result);
        } catch (Exception error) {
            call.reject("The Android Keystore could not protect the workspace key.");
        } finally {
            if (key != null) Arrays.fill(key, (byte) 0);
        }
    }

    @PluginMethod
    public void keyUnwrap(PluginCall call) {
        String wrapped = call.getString("wrapped");
        String[] parts = wrapped != null && wrapped.startsWith(WRAP_PREFIX) ? wrapped.substring(WRAP_PREFIX.length()).split(":", -1) : new String[0];
        byte[] iv = parts.length == 2 ? decode(parts[0]) : null;
        byte[] sealed = parts.length == 2 ? decode(parts[1]) : null;
        if (iv == null || iv.length != 12 || sealed == null || sealed.length != 48) {
            call.reject("The encrypted workspace key is invalid.");
            return;
        }
        byte[] key = null;
        try {
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.DECRYPT_MODE, keystoreKey(false), new GCMParameterSpec(128, iv));
            cipher.updateAAD(WRAP_AAD);
            key = cipher.doFinal(sealed);
            JSObject result = new JSObject();
            result.put("key", encode(key));
            call.resolve(result);
        } catch (Exception error) {
            call.reject("The workspace key could not be unlocked with this device's Android Keystore.");
        } finally {
            if (key != null) Arrays.fill(key, (byte) 0);
        }
    }

    // ---- Native confirmation (the page cannot answer these dialogs itself) --------------------

    @PluginMethod
    public void confirm(PluginCall call) {
        String title = call.getString("title", "");
        String message = call.getString("message", "");
        String confirm = call.getString("confirm", "OK");
        String cancel = call.getString("cancel", "Cancel");
        AtomicBoolean answered = new AtomicBoolean(false);
        getActivity()
            .runOnUiThread(() -> {
                AlertDialog dialog = new AlertDialog.Builder(getActivity(), android.R.style.Theme_DeviceDefault_Dialog_Alert)
                    .setTitle(title)
                    .setMessage(message)
                    .setPositiveButton(confirm, (d, which) -> answer(call, answered, true))
                    .setNegativeButton(cancel, (d, which) -> answer(call, answered, false))
                    .setOnCancelListener(d -> answer(call, answered, false))
                    .create();
                dialog.setOnDismissListener(d -> answer(call, answered, false));
                dialog.show();
            });
    }

    private static void answer(PluginCall call, AtomicBoolean answered, boolean confirmed) {
        if (!answered.compareAndSet(false, true)) return;
        JSObject result = new JSObject();
        result.put("confirmed", confirmed);
        call.resolve(result);
    }

    // ---- System document picker ---------------------------------------------------------------

    @PluginMethod
    public void openDocuments(PluginCall call) {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType("*/*");
        if (call.getBoolean("multiple", false)) intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
        startActivityForResult(call, intent, "documentsPicked");
    }

    @ActivityCallback
    private void documentsPicked(PluginCall call, ActivityResult result) {
        if (call == null) return;
        Intent data = result.getData();
        List<Uri> uris = new ArrayList<>();
        if (result.getResultCode() == Activity.RESULT_OK && data != null) {
            if (data.getClipData() != null) {
                for (int i = 0; i < data.getClipData().getItemCount(); i++) uris.add(data.getClipData().getItemAt(i).getUri());
            } else if (data.getData() != null) {
                uris.add(data.getData());
            }
        }
        int maxCount = Math.max(1, Math.min(MAX_PICK_COUNT, call.getInt("maxCount", 1)));
        int maxBytes = Math.max(1, Math.min(MAX_PICK_BYTES, call.getInt("maxBytes", MAX_PICK_BYTES)));
        if (uris.size() > maxCount) {
            call.reject("Too many files were selected.");
            return;
        }
        getBridge()
            .execute(() -> {
                JSArray files = new JSArray();
                ContentResolver resolver = getContext().getContentResolver();
                try {
                    for (Uri uri : uris) {
                        JSObject file = new JSObject();
                        file.put("name", displayName(resolver, uri));
                        file.put("data", encode(readBounded(resolver, uri, maxBytes)));
                        files.put(file);
                    }
                } catch (TooLarge tooLarge) {
                    call.reject("The selected file is too large.");
                    return;
                } catch (Exception error) {
                    call.reject("The selected file could not be read.");
                    return;
                }
                JSObject response = new JSObject();
                response.put("files", files);
                call.resolve(response);
            });
    }

    private static final class TooLarge extends Exception {}

    private static byte[] readBounded(ContentResolver resolver, Uri uri, int maxBytes) throws Exception {
        try (InputStream in = resolver.openInputStream(uri)) {
            if (in == null) throw new FileNotFoundException();
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buffer = new byte[64 * 1024];
            int total = 0, read;
            while ((read = in.read(buffer)) != -1) {
                total += read;
                if (total > maxBytes) throw new TooLarge();
                out.write(buffer, 0, read);
            }
            return out.toByteArray();
        }
    }

    private static String displayName(ContentResolver resolver, Uri uri) {
        String name = null;
        try (Cursor cursor = resolver.query(uri, new String[] { OpenableColumns.DISPLAY_NAME }, null, null, null)) {
            if (cursor != null && cursor.moveToFirst()) name = cursor.getString(0);
        } catch (Exception ignored) {
            // Fall back to a neutral name.
        }
        if (name == null || name.trim().isEmpty()) name = "file";
        name = name.replaceAll("[\\\\/\\x00-\\x1f]", "_");
        return name.length() > 255 ? name.substring(name.length() - 255) : name;
    }

    @PluginMethod
    public void saveDocument(PluginCall call) {
        String name = call.getString("name", "file");
        String mime = call.getString("mime", "application/octet-stream");
        Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT)
            .addCategory(Intent.CATEGORY_OPENABLE)
            .setType(mime)
            .putExtra(Intent.EXTRA_TITLE, name);
        startActivityForResult(call, intent, "documentCreated");
    }

    @ActivityCallback
    private void documentCreated(PluginCall call, ActivityResult result) {
        if (call == null) return;
        Intent data = result.getData();
        if (result.getResultCode() != Activity.RESULT_OK || data == null || data.getData() == null) {
            JSObject response = new JSObject();
            response.put("saved", false);
            call.resolve(response);
            return;
        }
        Uri uri = data.getData();
        getBridge()
            .execute(() -> {
                byte[] bytes = decode(call.getString("data", ""));
                if (bytes == null) {
                    call.reject("The file could not be saved.");
                    return;
                }
                try (OutputStream out = getContext().getContentResolver().openOutputStream(uri, "wt")) {
                    if (out == null) throw new FileNotFoundException();
                    out.write(bytes);
                    JSObject response = new JSObject();
                    response.put("saved", true);
                    call.resolve(response);
                } catch (Exception error) {
                    call.reject("The file could not be saved.");
                }
            });
    }

    // ---- Clipboard, external links and task control -------------------------------------------

    @PluginMethod
    public void copyText(PluginCall call) {
        String text = call.getString("text", "");
        getActivity()
            .runOnUiThread(() -> {
                try {
                    ClipboardManager clipboard = (ClipboardManager) getContext().getSystemService(Context.CLIPBOARD_SERVICE);
                    clipboard.setPrimaryClip(ClipData.newPlainText("Tinfoil Workbench", text));
                    call.resolve();
                } catch (Exception error) {
                    call.reject("Android could not update the clipboard.");
                }
            });
    }

    @PluginMethod
    public void openExternal(PluginCall call) {
        Uri uri = Uri.parse(call.getString("url", ""));
        String scheme = uri.getScheme();
        if (!("https".equals(scheme) || "http".equals(scheme)) || uri.getHost() == null || uri.getUserInfo() != null) {
            call.reject("Only HTTP or HTTPS links can be opened.");
            return;
        }
        Intent intent = new Intent(Intent.ACTION_VIEW, uri).addCategory(Intent.CATEGORY_BROWSABLE).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        try {
            getActivity().startActivity(intent);
            call.resolve();
        } catch (ActivityNotFoundException missing) {
            call.reject("No browser is available to open this link.");
        }
    }

    @PluginMethod
    public void moveTaskToBack(PluginCall call) {
        getActivity()
            .runOnUiThread(() -> {
                getActivity().moveTaskToBack(true);
                call.resolve();
            });
    }

    // ---- Helpers -----------------------------------------------------------------------------

    private static String encode(byte[] bytes) {
        return Base64.encodeToString(bytes, Base64.NO_WRAP);
    }

    private static byte[] decode(String value) {
        if (value == null) return null;
        try {
            return Base64.decode(value, Base64.NO_WRAP);
        } catch (IllegalArgumentException invalid) {
            return null;
        }
    }
}
