/**
 * Types for `hls.js/light`.
 *
 * The package ships types for its main entry point and not for the light one:
 * its `exports` entry has no `types` field. This says the two have the same
 * shape, which they do — the light build is the same class with several optional
 * controllers left out.
 *
 * The alternative was importing the full build for the sake of its declaration
 * file: 177 kB over the wire against 113, so 64 kB per reader to avoid writing
 * these four lines.
 */
declare module 'hls.js/light' {
  import Hls from 'hls.js';

  export default Hls;
}
