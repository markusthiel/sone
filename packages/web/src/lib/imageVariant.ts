/**
 * SONE web — making a smaller copy of an image before uploading it.
 *
 * A photograph from a phone is four thousand pixels wide and several megabytes,
 * sent in full to everybody who opens the page, to be drawn six hundred pixels
 * wide. The web version is what a page displays; the original is kept and
 * offered as a download (ADR-0029).
 *
 * Done here rather than on the server: server-side means a native image library
 * in the container, with its own security releases and a build that differs by
 * architecture, for work the uploading machine can do behind a progress bar
 * somebody was going to watch anyway. It also means the network carries the
 * large file once instead of twice.
 */

/** The long edge a displayed image is bounded to. */
export const WEB_BOUND = 2048;

/** And for a profile picture, which is drawn at 22 pixels. */
export const AVATAR_BOUND = 512;

export interface Size {
  width: number;
  height: number;
}

/**
 * The size a web version should be, or null when there should not be one.
 *
 * Null for anything already within the bound. Producing a "web version" the
 * same size as the original is two files where one would do, and a download
 * menu offering two identical files makes somebody choose between nothing.
 *
 * Kept separate from the drawing so it can be tested: the arithmetic is where
 * an off-by-one turns into a picture one pixel narrower every time it is
 * touched.
 */
export function webVariantSize(size: Size, bound = WEB_BOUND): Size | null {
  const longest = Math.max(size.width, size.height);
  if (longest <= bound || longest === 0) return null;

  const scale = bound / longest;
  return {
    // Rounded, and never to zero: a panorama 8000 by 3 pixels is absurd and
    // still somebody's file, and a height of 0 is a canvas that throws.
    width: Math.max(1, Math.round(size.width * scale)),
    height: Math.max(1, Math.round(size.height * scale)),
  };
}

/** Whether this is something worth making a variant of at all. */
export const canResize = (type: string): boolean =>
  /^image\/(jpeg|png|webp)$/.test(type);

/**
 * Draw a smaller copy.
 *
 * Returns null when there is nothing to do, and also when anything at all goes
 * wrong: a corrupt file, a format the browser will not decode, a canvas the
 * browser refuses because the image is enormous. The caller then uploads the
 * original alone, which is exactly what a client without this code does — so
 * the failure path is one the server already supports rather than a new one.
 */
export async function webVariant(
  file: File,
  bound = WEB_BOUND,
): Promise<File | null> {
  if (!canResize(file.type)) return null;

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return null;
  }

  try {
    const target = webVariantSize(bitmap, bound);
    if (!target) return null;

    const canvas = document.createElement('canvas');
    canvas.width = target.width;
    canvas.height = target.height;

    const context = canvas.getContext('2d');
    if (!context) return null;
    // Better than the default on a large reduction, and the difference is
    // visible on exactly the photographs this exists for.
    context.imageSmoothingQuality = 'high';
    context.drawImage(bitmap, 0, 0, target.width, target.height);

    const blob = await new Promise<Blob | null>((resolve) => {
      // JPEG for photographs, PNG kept as PNG: re-encoding a screenshot or a
      // diagram as JPEG puts halos around text, which is worse than the size
      // it saves.
      const type = file.type === 'image/png' ? 'image/png' : 'image/jpeg';
      canvas.toBlob(resolve, type, 0.82);
    });
    if (!blob) return null;

    // Larger than the original happens: a small PNG re-encoded can grow. Then
    // there is nothing to gain and a second file to store.
    if (blob.size >= file.size) return null;

    return new File([blob], file.name, { type: blob.type });
  } finally {
    bitmap.close();
  }
}
