/** The only native operations the Android host worker may request. mobile/bridge.mjs validates
 * each request against these shapes before calling the Workbench plugin; anything else is refused.
 * There is deliberately no generic filesystem, network, shell or JavaScript-evaluation operation. */
const MAX_TEXT = 4 * 1024 * 1024;
// Exports stay importable, so saved files and picked files share the 24 MiB import limit.
const MAX_FILE = 24 * 1024 * 1024;
const MAX_FILE_BASE64 = Math.ceil(MAX_FILE / 3) * 4;
const MAX_ENVELOPE = 96 * 1024 * 1024 * 4 / 3;
const string = (value, max, name, required = true) => {
  if (typeof value !== 'string' || value.length > max || (required && !value)) throw new TypeError('Invalid ' + name + '.');
  return value;
};
const base64 = (value, max, name) => {
  string(value, max, name, false);
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(value)) throw new TypeError('Invalid ' + name + '.');
  return value;
};
const count = (value, max, name) => {
  if (!Number.isInteger(value) || value < 1 || value > max) throw new TypeError('Invalid ' + name + '.');
  return value;
};

export const NATIVE_VALIDATORS = Object.freeze({
  vaultRead: () => ({}),
  vaultWrite: a => ({ envelope: string(a.envelope, MAX_ENVELOPE, 'vault envelope') }),
  keyWrap: a => ({ key: base64(a.key, 64, 'data key') }),
  keyUnwrap: a => ({ wrapped: string(a.wrapped, 4096, 'wrapped key') }),
  confirm: a => ({ title: string(a.title, 300, 'dialog title'), message: string(a.message, 40000, 'dialog message'),
    confirm: string(a.confirm, 60, 'dialog button'), cancel: string(a.cancel, 60, 'dialog button'), danger: a.danger === true }),
  openDocuments: a => ({ multiple: a.multiple === true, maxCount: count(a.maxCount, 16, 'file count'), maxBytes: count(a.maxBytes, MAX_FILE, 'file size') }),
  saveDocument: a => ({ name: string(a.name, 255, 'file name'), mime: string(a.mime, 100, 'file type'), data: base64(a.data, MAX_FILE_BASE64, 'file data') }),
  copyText: a => ({ text: string(a.text, MAX_TEXT, 'clipboard text', false) }),
  openExternal: a => {
    const url = string(a.url, 4096, 'link');
    const parsed = new URL(url);
    if (!['https:', 'http:'].includes(parsed.protocol) || parsed.username || parsed.password) throw new TypeError('Invalid link.');
    return { url };
  },
});
export const NATIVE_OPERATIONS = Object.freeze(Object.keys(NATIVE_VALIDATORS));

/** Validate a worker request; returns the sanitized arguments or throws. */
export function nativeRequest(op, args) {
  if (typeof op !== 'string' || !Object.hasOwn(NATIVE_VALIDATORS, op)) throw new TypeError('Unsupported Android operation.');
  return NATIVE_VALIDATORS[op](args && typeof args === 'object' ? args : {});
}
