import { describe, expect, it } from 'vitest';
import { DISPLAY_NAME_MAX, PASSWORD_MAX, PASSWORD_MIN, passwordSize, validateDisplayName, validateEmail, validateNewPassword, validatePassword, validateSignIn, validateSignUp } from './validation';

describe('email', () => {
  it('accepts ordinary addresses and trims them', () => {
    for (const e of ['a@b.co', 'first.last+tag@sub.example.com', '  padded@example.org  ']) expect(validateEmail(e), e).toBeNull();
  });
  it('rejects empty, malformed and over-long addresses', () => {
    for (const e of ['', '   ', 'plain', 'a@b', 'a@@b.com', 'a b@c.com', '@b.com', 'a@.com', 'a@b..com', `${'x'.repeat(250)}@b.com`]) expect(validateEmail(e), e).not.toBeNull();
  });
});

describe('password', () => {
  // 'अ' (Devanagari A) is one code point, UTF-16 length 1, and 3 UTF-8 bytes. '🔑' is one code point, UTF-16 length 2, 4 bytes.
  const hindi = (n: number) => 'अ'.repeat(n);
  const emoji = (n: number) => '🔑'.repeat(n);

  it('measures what the tests below rely on', () => {
    expect(passwordSize('a')).toEqual({ codePoints: 1, bytes: 1 });
    expect(passwordSize('अ')).toEqual({ codePoints: 1, bytes: 3 });
    expect(passwordSize('🔑')).toEqual({ codePoints: 1, bytes: 4 });
    expect('🔑'.length).toBe(2); // the trap: .length is neither the code-point count nor the byte count
    expect('अ'.length).toBe(1);
  });

  describe('ASCII (one byte per character)', () => {
    it('requires at least 10 characters', () => {
      expect(PASSWORD_MIN).toBe(10);
      expect(validatePassword('123456789')).toMatch(/at least 10/);
      expect(validatePassword('1234567890')).toBeNull();
    });
    it('allows exactly 72 and refuses 73', () => {
      expect(PASSWORD_MAX).toBe(72);
      expect(validatePassword('x'.repeat(72))).toBeNull();
      expect(validatePassword('x'.repeat(73))).toMatch(/at most 72 bytes/);
    });
    it('counts spaces and keeps them (no trimming of a password)', () => {
      expect(validatePassword('          ')).toBeNull();
    });
  });

  describe('Indian-language characters (about three bytes each)', () => {
    it('counts the minimum in characters, not bytes: 9 letters fail even though they are 27 bytes', () => {
      expect(validatePassword(hindi(9))).toMatch(/at least 10/);
      expect(validatePassword(hindi(10))).toBeNull();
    });
    it('counts the maximum in bytes: 24 letters (72 bytes) pass, 25 (75 bytes) fail although .length is only 25', () => {
      expect(validatePassword(hindi(24))).toBeNull();
      expect(validatePassword(hindi(25))).toMatch(/at most 72 bytes/);
      expect(hindi(25).length).toBeLessThan(72);
    });
    it('handles real words in several scripts, including combining marks', () => {
      const words = { hindi: 'मेरापासवर्डबहुतसुरक्षित', tamil: 'எனதுகடவுச்சொல்', telugu: 'నాపాస్వర్డ్', bengali: 'আমারপাসওয়ার্ড' };
      for (const [name, word] of Object.entries(words)) {
        const { codePoints, bytes } = passwordSize(word);
        const expected = codePoints < 10 ? /at least 10/ : bytes > 72 ? /at most 72 bytes/ : null;
        const result = validatePassword(word);
        if (expected === null) expect(result, name).toBeNull();
        else expect(result, name).toMatch(expected);
      }
      // a sequence of base letters and vowel signs is counted per code point, not per visible letter
      expect(passwordSize('कि').codePoints).toBe(2);
    });
  });

  describe('emoji (one code point, UTF-16 length 2, four bytes)', () => {
    it('counts the minimum in code points: 9 emoji fail although .length is 18', () => {
      expect(emoji(9).length).toBe(18);
      expect(validatePassword(emoji(9))).toMatch(/at least 10/);
      expect(validatePassword(emoji(10))).toBeNull(); // 10 code points, .length 20
    });
    it('counts the maximum in bytes: 18 emoji (72 bytes) pass, 19 (76 bytes) fail', () => {
      expect(validatePassword(emoji(18))).toBeNull();
      expect(validatePassword(emoji(19))).toMatch(/at most 72 bytes/);
    });
    it('counts a joined emoji sequence by code points and bytes', () => {
      const family = '👨\u200D👩\u200D👧'; // 3 emoji joined by 2 zero-width joiners
      expect(passwordSize(family)).toEqual({ codePoints: 5, bytes: 18 });
    });
  });

  it('mixes scripts correctly', () => {
    // 10 code points: 4 ASCII + 3 Devanagari + 3 emoji = 4 + 9 + 12 = 25 bytes
    const mixed = 'abcd' + 'अअअ' + '🔑🔑🔑';
    expect(passwordSize(mixed)).toEqual({ codePoints: 10, bytes: 25 });
    expect(validatePassword(mixed)).toBeNull();
  });

  it('accepts the boundary exactly: 72 bytes made of mixed scripts', () => {
    const exactly72 = 'x'.repeat(20) + 'अ'.repeat(10) + '🔑'.repeat(5) + 'y'.repeat(2); // 20 + 30 + 20 + 2
    expect(passwordSize(exactly72).bytes).toBe(72);
    expect(validatePassword(exactly72)).toBeNull();
    expect(validatePassword(exactly72 + 'z')).toMatch(/at most 72 bytes/);
  });
});

describe('display name', () => {
  it('matches the database limit of 1 to 80 characters after trimming', () => {
    expect(DISPLAY_NAME_MAX).toBe(80);
    expect(validateDisplayName('')).not.toBeNull();
    expect(validateDisplayName('    ')).not.toBeNull();
    expect(validateDisplayName('A')).toBeNull();
    expect(validateDisplayName('x'.repeat(80))).toBeNull();
    expect(validateDisplayName('x'.repeat(81))).not.toBeNull();
    expect(validateDisplayName(`  ${'x'.repeat(80)}  `)).toBeNull(); // trimmed first, as the trigger does
  });
  it('allows ordinary punctuation and non-Latin names, and rejects control characters', () => {
    for (const n of ["O'Brien-Smith", 'Aarav Sharma', 'अनन्या', '<b>bold</b>']) expect(validateDisplayName(n), n).toBeNull(); // markup is allowed as TEXT; it is escaped on display
    expect(validateDisplayName('bad\u0000name')).not.toBeNull();
    expect(validateDisplayName('line\nbreak')).not.toBeNull();
  });
});

describe('forms', () => {
  const good = { displayName: 'Asha', email: 'asha@example.test', password: 'correct horse', confirmPassword: 'correct horse' };
  it('sign-up passes when everything is right', () => expect(validateSignUp(good)).toEqual({}));
  it('sign-up reports every field at once', () => {
    const errors = validateSignUp({ displayName: '', email: 'nope', password: 'short', confirmPassword: '' });
    expect(Object.keys(errors).sort()).toEqual(['displayName', 'email', 'password']);
  });
  it('sign-up asks for the confirmation when it is empty but the password is fine', () => {
    expect(validateSignUp({ ...good, confirmPassword: '' })).toEqual({ confirmPassword: 'Re-enter your password to confirm it.' });
  });
  it('sign-up reports a mismatch only on the confirmation field', () => {
    const errors = validateSignUp({ ...good, confirmPassword: 'correct horsE' });
    expect(errors).toEqual({ confirmPassword: 'The passwords do not match.' });
  });
  it('sign-in needs a valid email and any password, and does not judge password length', () => {
    expect(validateSignIn({ email: 'a@b.co', password: 'x' })).toEqual({});
    expect(validateSignIn({ email: '', password: '' })).toEqual({ email: expect.any(String), password: expect.any(String) });
  });
  it('sign-up and the new-password form apply the same byte rule', () => {
    const tooLong = 'अ'.repeat(25); // 75 bytes
    expect(validateSignUp({ displayName: 'A', email: 'a@b.co', password: tooLong, confirmPassword: tooLong }).password).toMatch(/at most 72 bytes/);
    expect(validateNewPassword({ password: tooLong, confirmPassword: tooLong }).password).toMatch(/at most 72 bytes/);
    const okay = 'अ'.repeat(24); // 72 bytes
    expect(validateSignUp({ displayName: 'A', email: 'a@b.co', password: okay, confirmPassword: okay })).toEqual({});
    expect(validateNewPassword({ password: okay, confirmPassword: okay })).toEqual({});
  });
  it('a new password follows the same length and match rules', () => {
    expect(validateNewPassword({ password: 'a long password', confirmPassword: 'a long password' })).toEqual({});
    expect(validateNewPassword({ password: 'short', confirmPassword: 'short' }).password).toBeDefined();
    expect(validateNewPassword({ password: 'a long password', confirmPassword: 'different' }).confirmPassword).toBeDefined();
  });
});
