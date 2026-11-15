/** Geometry for an edge-only lens. The image is a displacement field, never a
 * capture of user content. Coordinates and displacement are measured in CSS px. */
export interface GlassOpticalMap {
  readonly url: string;
  /** Bitmap dimensions. Place feImage over the original CSS width and height. */
  readonly width: number;
  readonly height: number;
  /** SVG displacement scale: its two-sided range is twice the maximum bend. */
  readonly scale: number;
  readonly edgeWidth: number;
}

const MAX_WIDTH = 1024;
const MAX_HEIGHT = 768;
const MAX_PIXELS = 400_000;
const MAX_ENTRIES = 4;
const MAX_CACHE_BYTES = 4 * 1024 * 1024;
const cache = new Map<string, { map: GlassOpticalMap; bytes: number }>();
let cacheBytes = 0;

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const finite = (value: number, fallback: number) => Number.isFinite(value) ? value : fallback;

function bitmap(width: number, height: number) {
  const stride = Math.ceil(width * 3 / 4) * 4;
  const bytes = new Uint8Array(54 + stride * height);
  const header = new DataView(bytes.buffer);
  bytes[0] = 0x42;
  bytes[1] = 0x4d;
  header.setUint32(2, bytes.length, true);
  header.setUint32(10, 54, true);
  header.setUint32(14, 40, true);
  header.setInt32(18, width, true);
  header.setInt32(22, height, true);
  header.setUint16(26, 1, true);
  header.setUint16(28, 24, true);
  header.setUint32(34, stride * height, true);
  return { bytes, stride };
}

function dataUrl(bytes: Uint8Array): string {
  let binary = '';
  // Keep argument counts below browser stack limits; no Buffer or canvas needed.
  for (let offset = 0; offset < bytes.length; offset += 24_576) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 24_576));
  }
  return `data:image/bmp;base64,${btoa(binary)}`;
}

/** The renderer must calibrate map channels with slope 255/254 and intercept
 * -1/254 before displacement, so the neutral byte 128 becomes exactly 0.5.
 * R/G encode inward sampling; B independently stores the edge opacity mask. */
export function getGlassOpticalMap(width: number, height: number, radius = 22, edgeWidth = 16): GlassOpticalMap {
  const cssWidth = Math.max(1, finite(width, 1));
  const cssHeight = Math.max(1, finite(height, 1));
  const halfWidth = cssWidth / 2;
  const halfHeight = cssHeight / 2;
  const corner = clamp(finite(radius, 22), 0, Math.min(halfWidth, halfHeight));
  const band = Math.min(clamp(finite(edgeWidth, 16), 12, 18), halfWidth, halfHeight);
  const key = `${cssWidth}:${cssHeight}:${corner}:${band}`;
  const cached = cache.get(key);
  if (cached) {
    cache.delete(key);
    cache.set(key, cached);
    return cached.map;
  }

  // One reduction factor for both axes. Sample the field in CSS coordinates,
  // including after rounding, rather than stretching a generic circular map.
  const reduction = Math.min(1, MAX_WIDTH / cssWidth, MAX_HEIGHT / cssHeight,
    Math.sqrt(MAX_PIXELS / cssWidth / cssHeight));
  const mapWidth = Math.max(1, Math.floor(cssWidth * reduction));
  const mapHeight = Math.max(1, Math.floor(cssHeight * reduction));
  const { bytes, stride } = bitmap(mapWidth, mapHeight);

  for (let y = 0; y < mapHeight; y++) {
    const py = (y + .5) / mapHeight * cssHeight - halfHeight;
    const qy = Math.abs(py) - (halfHeight - corner);
    for (let x = 0; x < mapWidth; x++) {
      const px = (x + .5) / mapWidth * cssWidth - halfWidth;
      const qx = Math.abs(px) - (halfWidth - corner);
      const ox = Math.max(qx, 0), oy = Math.max(qy, 0);
      const length = Math.hypot(ox, oy);
      const inset = corner - length - Math.min(Math.max(qx, qy), 0);
      let red = 128, green = 128, mask = 0;
      if (inset >= 0 && inset < band) {
        // Rounded-box outward normal: curved corners join the straight edges.
        const diagonal = Math.SQRT1_2;
        const nx = (length > 0 ? ox / length : qx === qy ? diagonal : qx > qy ? 1 : 0) * Math.sign(px);
        const ny = (length > 0 ? oy / length : qx === qy ? diagonal : qy > qx ? 1 : 0) * Math.sign(py);
        const t = 1 - inset / band;
        const weight = t * t * (3 - 2 * t);
        red = Math.round(128 - 127 * nx * weight);
        green = Math.round(128 - 127 * ny * weight);
        mask = Math.round(255 * weight);
      }
      // BMP rows are bottom-up and colors are BGR, including the independent mask.
      const offset = 54 + (mapHeight - y - 1) * stride + x * 3;
      bytes[offset] = mask;
      bytes[offset + 1] = green;
      bytes[offset + 2] = red;
    }
  }

  const map: GlassOpticalMap = Object.freeze({
    url: dataUrl(bytes), width: mapWidth, height: mapHeight,
    scale: Math.min(8, band / 2) * 2, edgeWidth: band,
  });
  // Account conservatively for UTF-16 strings, even on engines storing ASCII
  // compactly. Transient map buffers are not retained by the cache.
  const storedBytes = (key.length + map.url.length) * 2;
  while (cache.size && (cache.size >= MAX_ENTRIES || cacheBytes + storedBytes > MAX_CACHE_BYTES)) {
    const oldest = cache.keys().next().value!;
    cacheBytes -= cache.get(oldest)!.bytes;
    cache.delete(oldest);
  }
  if (storedBytes <= MAX_CACHE_BYTES) {
    cache.set(key, { map, bytes: storedBytes });
    cacheBytes += storedBytes;
  }
  return map;
}

export function clearGlassOpticsCache(): void {
  cache.clear();
  cacheBytes = 0;
}

export function getGlassOpticsCacheStats() {
  return { entries: cache.size, bytes: cacheBytes, maxEntries: MAX_ENTRIES, maxBytes: MAX_CACHE_BYTES };
}
