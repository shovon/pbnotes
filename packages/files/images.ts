/**
 * Images, as pbnotes keeps them in this store: which types can be stored,
 * the extension each is stored under, and the folder they go in. A note
 * links one as `images/<sha256>.<ext>`, relative to the project.
 *
 * Here rather than in the app so that anything that writes a project (the
 * app, an import) names and places an image the same way. Pure: storing is
 * `save` and naming is `nameOf`, beside it.
 */

/** The folder images go in, in each device's directory. */
export const IMAGES = 'images';

/** What can be stored, and the extension each is stored under. */
const EXTENSIONS = new Map([
  ['image/png', 'png'],
  ['image/jpeg', 'jpg'],
  ['image/gif', 'gif'],
  ['image/webp', 'webp'],
  ['image/svg+xml', 'svg'],
]);

/** Extensions an image is found under that are not the one it is stored under. */
const ALSO = new Map([['jpeg', 'image/jpeg']]);

/** The extension an image of type `mime` is stored under, or undefined for a type that is not stored. */
export function extensionOf(mime: string): string | undefined {
  return EXTENSIONS.get(mime);
}

/**
 * The type of an image file, read off its extension, or undefined for a
 * file that is not a type that is stored.
 */
export function mimeOf(file: string): string | undefined {
  const extension = /\.([^./\\]+)$/.exec(file)?.[1]?.toLowerCase();
  if (extension === undefined) return undefined;
  for (const [mime, it] of EXTENSIONS) if (it === extension) return mime;
  return ALSO.get(extension);
}

/** What a note links a stored image by: `images/<name>`. */
export function linkOf(name: string): string {
  return `${IMAGES}/${name}`;
}
