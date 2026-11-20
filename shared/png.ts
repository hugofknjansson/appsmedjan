/** Size and transparency of a PNG image, read from its header. Null when the bytes are not a PNG. */
export function pngInfo(data: Uint8Array): { width: number; height: number; alpha: boolean } | null {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (data.length < 33 || signature.some((byte, i) => data[i] !== byte)) return null;
  // The first chunk is always IHDR: length (4), "IHDR" (4), width (4), height (4), depth (1), colour type (1).
  if (String.fromCharCode(data[12]!, data[13]!, data[14]!, data[15]!) !== 'IHDR') return null;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const colorType = data[25]!;
  // 4 and 6 carry an alpha channel; palettes (3) may hold transparency too, so they count as well.
  return { width: view.getUint32(16), height: view.getUint32(20), alpha: colorType === 4 || colorType === 6 || colorType === 3 };
}
