/** Profile photos live in localStorage as data URLs, so they are kept deliberately small. */
export const AVATAR_MAX_INPUT_BYTES = 8 * 1024 * 1024;
export const AVATAR_MAX_DATA_URL_CHARS = 60_000;
/** More lenient bound for imported files, which may come from another version of the app. */
export const AVATAR_IMPORT_MAX_CHARS = 200_000;

export const isImageDataUrl = (v: unknown): v is string => typeof v === 'string' && /^data:image\/(jpeg|png|webp);base64,/.test(v);

export function isAcceptableAvatar(v: unknown, maxChars = AVATAR_IMPORT_MAX_CHARS): v is string {
  return isImageDataUrl(v) && v.length <= maxChars;
}

/** Re-encodes at decreasing quality until it fits. Returns null when no quality is small enough. */
export function encodeWithinLimit(encode: (quality: number) => string, maxChars = AVATAR_MAX_DATA_URL_CHARS): string | null {
  for (const quality of [0.85, 0.7, 0.55, 0.4]) {
    const url = encode(quality);
    if (url.length <= maxChars) return url;
  }
  return null;
}

/** Downsizes an uploaded image to a small square data URL. Rejects oversized or unreadable files. */
export function readAvatar(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith('image/')) return reject(new Error('Choose an image file.'));
    if (file.size > AVATAR_MAX_INPUT_BYTES) return reject(new Error('That image is larger than 8 MB. Choose a smaller one.'));
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const size = 128;
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext('2d');
      if (!ctx) return reject(new Error('Image processing is not available in this browser.'));
      const side = Math.min(img.width, img.height);
      ctx.drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, size, size);
      const result = encodeWithinLimit((q) => canvas.toDataURL('image/jpeg', q));
      if (result) resolve(result);
      else reject(new Error('Could not shrink that image enough to store it.'));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('That file is not a readable image.'));
    };
    img.src = url;
  });
}
