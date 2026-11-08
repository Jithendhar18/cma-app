/**
 * Form validation for the account screens. Pure and synchronous. The limits mirror the database and the auth server:
 *   display name  1 to 80 characters after trimming (profiles.display_name check, and the trigger's 80-character cap)
 *   password      at least 10 Unicode CODE POINTS (supabase/config.toml minimum_password_length = 10) and at most 72 UTF-8 BYTES
 *                 (the bcrypt limit; Supabase Auth REJECTS a longer password, it does not truncate it)
 *
 * The two limits are measured differently on purpose. JavaScript's string `.length` counts UTF-16 code units, which is neither:
 * an emoji has length 2 but is one code point and four bytes, and a Devanagari letter has length 1 but is three bytes. So the
 * minimum counts code points (`[...value]`) and the maximum counts the bytes that `TextEncoder` would send.
 */

export const PASSWORD_MIN = 10;
export const PASSWORD_MAX = 72;
export const DISPLAY_NAME_MAX = 80;

// Deliberately simple: the server is the real judge of deliverability. This catches typos, not every exotic address.
const EMAIL = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001F\u007F]/;

export function normaliseEmail(value: string): string {
  return value.trim();
}

export function validateEmail(value: string): string | null {
  const email = normaliseEmail(value);
  if (email === '') return 'Enter your email address.';
  if (email.length > 254 || !EMAIL.test(email)) return 'Enter a valid email address, like name@example.com.';
  return null;
}

const encoder = new TextEncoder();

/** How a password is measured: Unicode code points for the minimum, UTF-8 bytes for the maximum. */
export function passwordSize(value: string): { codePoints: number; bytes: number } {
  return { codePoints: [...value].length, bytes: encoder.encode(value).length };
}

export function validatePassword(value: string): string | null {
  const { codePoints, bytes } = passwordSize(value);
  if (codePoints < PASSWORD_MIN) return `Use at least ${PASSWORD_MIN} characters.`;
  if (bytes > PASSWORD_MAX) {
    return `Use at most ${PASSWORD_MAX} bytes. Most letters take 1 byte, but letters from other scripts take about 3 and emoji 4, so a password in those may need to be shorter.`;
  }
  return null;
}

export function validateDisplayName(value: string): string | null {
  const name = value.trim();
  if (name === '') return 'Enter the name you want to see in the app.';
  if (name.length > DISPLAY_NAME_MAX) return `Use at most ${DISPLAY_NAME_MAX} characters.`;
  if (CONTROL.test(name)) return 'That name contains characters that are not allowed.';
  return null;
}

export interface SignUpFields {
  displayName: string;
  email: string;
  password: string;
  confirmPassword: string;
}
export type FieldErrors<K extends string> = Partial<Record<K, string>>;

export function validateSignUp(fields: SignUpFields): FieldErrors<keyof SignUpFields> {
  const errors: FieldErrors<keyof SignUpFields> = {};
  const name = validateDisplayName(fields.displayName);
  if (name) errors.displayName = name;
  const email = validateEmail(fields.email);
  if (email) errors.email = email;
  const password = validatePassword(fields.password);
  if (password) errors.password = password;
  // Only judge the confirmation once the password itself is acceptable, so one mistake does not raise two errors.
  if (!password) {
    if (fields.confirmPassword === '') errors.confirmPassword = 'Re-enter your password to confirm it.';
    else if (fields.confirmPassword !== fields.password) errors.confirmPassword = 'The passwords do not match.';
  }
  return errors;
}

export function validateSignIn(fields: { email: string; password: string }): FieldErrors<'email' | 'password'> {
  const errors: FieldErrors<'email' | 'password'> = {};
  const email = validateEmail(fields.email);
  if (email) errors.email = email;
  // Sign-in does not judge length: an older account may predate the rule. It only needs something to send.
  if (fields.password === '') errors.password = 'Enter your password.';
  return errors;
}

export function validateNewPassword(fields: { password: string; confirmPassword: string }): FieldErrors<'password' | 'confirmPassword'> {
  const errors: FieldErrors<'password' | 'confirmPassword'> = {};
  const password = validatePassword(fields.password);
  if (password) errors.password = password;
  else if (fields.confirmPassword !== fields.password) errors.confirmPassword = 'The passwords do not match.';
  return errors;
}
