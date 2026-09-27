import { fromArrayBuffer } from 'geotiff';
import { decode as decodePng } from 'fast-png';

/** 디코딩 결과. RGB면 채널 3개를 보관해 회색 변환 방식을 나중에 바꿀 수 있게 한다. */
export interface DecodedImage {
  width: number;
  height: number;
  bitDepth: 8 | 16 | 32;
  maxValue: number;
  channels: Float32Array[];
  pageCount: number;
  page: number;
  format: 'tiff' | 'png' | 'jpeg' | 'other';
  lossy: boolean;
  warnings: string[];
}

export function detectFormat(bytes: Uint8Array, fileName: string): DecodedImage['format'] {
  if ((bytes[0] === 0x49 && bytes[1] === 0x49) || (bytes[0] === 0x4d && bytes[1] === 0x4d)) return 'tiff';
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'png';
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return 'jpeg';
  const ext = fileName.toLowerCase().split('.').pop();
  if (ext === 'tif' || ext === 'tiff') return 'tiff';
  return 'other';
}

export async function decodeImage(buffer: ArrayBuffer, fileName: string, page = 0): Promise<DecodedImage> {
  const bytes = new Uint8Array(buffer);
  const format = detectFormat(bytes, fileName);
  if (format === 'tiff') return decodeTiff(buffer, page);
  if (format === 'png') return decodePngFile(bytes);
  return decodeBrowser(buffer, format);
}

async function decodeTiff(buffer: ArrayBuffer, page: number): Promise<DecodedImage> {
  const tiff = await fromArrayBuffer(buffer);
  const pageCount = await tiff.getImageCount();
  const img = await tiff.getImage(Math.min(page, pageCount - 1));
  const width = img.getWidth();
  const height = img.getHeight();
  const spp = img.getSamplesPerPixel();
  const bps = img.getBitsPerSample(0);
  const sampleFormat = img.getSampleFormat(0); // 1 uint, 2 int, 3 float
  const fd = img.getFileDirectory();
  const photometric = Number(fd.getValue('PhotometricInterpretation') ?? 1);
  const warnings: string[] = [];

  const rasters = (await img.readRasters()) as unknown as ArrayLike<number>[];
  const n = width * height;
  let channels: Float32Array[];

  if (photometric === 3) {
    // 팔레트 이미지: 색상표를 통해 RGB로 풀어낸다 (ColorMap은 16-bit, R…G…B 순서)
    const map = (await fd.loadValue('ColorMap')) as ArrayLike<number> | undefined;
    const idx = rasters[0];
    if (!map) throw new Error('팔레트 TIFF의 ColorMap을 읽을 수 없습니다.');
    const size = map.length / 3;
    channels = [new Float32Array(n), new Float32Array(n), new Float32Array(n)];
    for (let i = 0; i < n; i++) {
      const k = idx[i];
      channels[0][i] = map[k] / 257;
      channels[1][i] = map[k + size] / 257;
      channels[2][i] = map[k + 2 * size] / 257;
    }
    warnings.push('팔레트(인덱스 컬러) TIFF입니다. 정량용 원본인지 확인하세요.');
    return { width, height, bitDepth: 8, maxValue: 255, channels, pageCount, page, format: 'tiff', lossy: false, warnings };
  }

  const useCh = photometric === 2 && spp >= 3 ? 3 : 1;
  channels = [];
  for (let c = 0; c < useCh; c++) {
    const src = rasters[c];
    const out = new Float32Array(n);
    for (let i = 0; i < n; i++) out[i] = src[i];
    channels.push(out);
  }

  let bitDepth: 8 | 16 | 32;
  let maxValue: number;
  if (sampleFormat === 3 || bps === 32) {
    bitDepth = 32;
    maxValue = 0;
    for (const ch of channels) for (let i = 0; i < n; i++) if (ch[i] > maxValue && Number.isFinite(ch[i])) maxValue = ch[i];
    warnings.push('32-bit 이미지입니다. 포화 판정은 이미지 최댓값 기준으로 합니다.');
  } else if (bps <= 8) {
    bitDepth = 8;
    maxValue = (1 << bps) - 1;
  } else {
    bitDepth = 16;
    maxValue = bps >= 16 ? 65535 : (1 << bps) - 1;
  }

  if (photometric === 0) {
    // WhiteIsZero: 표준 방향(0 = 검정)으로 되돌린다
    for (const ch of channels) for (let i = 0; i < n; i++) ch[i] = maxValue - ch[i];
  }
  if (bitDepth === 16) {
    // 12/14-bit 데이터가 16-bit 컨테이너에 담긴 경우 안내
    let m = 0;
    for (let i = 0; i < n; i++) if (channels[0][i] > m) m = channels[0][i];
    if (m > 0 && m <= 4095) warnings.push('실제 값이 12-bit 범위(≤4095)입니다. 포화 기준을 확인하세요.');
  }
  if (pageCount > 1) warnings.push(`멀티페이지 TIFF (${pageCount}페이지) 중 ${page + 1}페이지를 불러왔습니다.`);

  return { width, height, bitDepth, maxValue, channels, pageCount, page, format: 'tiff', lossy: false, warnings };
}

function decodePngFile(bytes: Uint8Array): DecodedImage {
  const png = decodePng(bytes);
  const { width, height, channels: nc, depth } = png;
  const n = width * height;
  const warnings: string[] = [];
  let channels: Float32Array[];
  let maxValue = depth === 16 ? 65535 : 255;

  if (png.palette) {
    const pal = png.palette;
    channels = [new Float32Array(n), new Float32Array(n), new Float32Array(n)];
    for (let i = 0; i < n; i++) {
      const c = pal[png.data[i]] ?? [0, 0, 0];
      channels[0][i] = c[0];
      channels[1][i] = c[1];
      channels[2][i] = c[2];
    }
    maxValue = 255;
  } else {
    const colorCh = nc >= 3 ? 3 : 1;
    channels = [];
    for (let c = 0; c < colorCh; c++) {
      const out = new Float32Array(n);
      for (let i = 0; i < n; i++) out[i] = png.data[i * nc + c];
      channels.push(out);
    }
    if (depth < 8) maxValue = (1 << depth) - 1;
  }
  const bitDepth = depth === 16 ? 16 : 8;
  return { width, height, bitDepth, maxValue, channels, pageCount: 1, page: 0, format: 'png', lossy: false, warnings };
}

async function decodeBrowser(buffer: ArrayBuffer, format: DecodedImage['format']): Promise<DecodedImage> {
  const bitmap = await createImageBitmap(new Blob([buffer]));
  const { width, height } = bitmap;
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('캔버스를 만들 수 없습니다.');
  ctx.drawImage(bitmap, 0, 0);
  const rgba = ctx.getImageData(0, 0, width, height).data;
  const n = width * height;
  const r = new Float32Array(n), g = new Float32Array(n), b = new Float32Array(n);
  let isGray = true;
  for (let i = 0; i < n; i++) {
    r[i] = rgba[i * 4];
    g[i] = rgba[i * 4 + 1];
    b[i] = rgba[i * 4 + 2];
    if (isGray && (r[i] !== g[i] || g[i] !== b[i])) isGray = false;
  }
  const warnings: string[] = [];
  const lossy = format === 'jpeg';
  if (lossy) warnings.push('JPG는 손실 압축이라 픽셀 값이 바뀌어 있습니다. 가능하면 이미저의 원본 TIFF를 사용하세요.');
  return {
    width, height, bitDepth: 8, maxValue: 255,
    channels: isGray ? [r] : [r, g, b],
    pageCount: 1, page: 0, format, lossy, warnings,
  };
}

export async function sha256Hex(buffer: ArrayBuffer): Promise<string> {
  // crypto.subtle은 HTTPS(또는 localhost)에서만 있다. 사내 HTTP 서버에서도 동작하도록 직접 계산으로 대체한다.
  const subtle = globalThis.crypto?.subtle;
  const bytes = subtle ? new Uint8Array(await subtle.digest('SHA-256', buffer)) : sha256(new Uint8Array(buffer));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

const K256 = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

/** 순수 JS SHA-256 (FIPS 180-4) */
export function sha256(data: Uint8Array): Uint8Array {
  const bitLen = data.length * 8;
  const padded = new Uint8Array(((data.length + 9 + 63) >> 6) << 6);
  padded.set(data);
  padded[data.length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(padded.length - 8, Math.floor(bitLen / 2 ** 32));
  view.setUint32(padded.length - 4, bitLen >>> 0);
  const h = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  const w = new Uint32Array(64);
  const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n));
  for (let off = 0; off < padded.length; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(off + i * 4);
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, hh] = h;
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const t1 = (hh + S1 + ((e & f) ^ (~e & g)) + K256[i] + w[i]) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const t2 = (S0 + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
      hh = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    h[0] += a; h[1] += b; h[2] += c; h[3] += d; h[4] += e; h[5] += f; h[6] += g; h[7] += hh;
  }
  const out = new Uint8Array(32);
  const ov = new DataView(out.buffer);
  for (let i = 0; i < 8; i++) ov.setUint32(i * 4, h[i]);
  return out;
}
