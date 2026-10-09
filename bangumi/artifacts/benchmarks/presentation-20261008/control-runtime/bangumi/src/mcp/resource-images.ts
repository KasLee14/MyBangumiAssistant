import { AppError } from '../support/errors.js';
import type { JsonSchema } from '../support/tool-schema.js';

export const RESOURCE_IMAGE_SIZES = ['large', 'common', 'medium', 'small', 'grid'] as const;
export type ResourceImageSize = typeof RESOURCE_IMAGE_SIZES[number];
export type ResourceImages = Partial<Record<ResourceImageSize, string>>;
const address: JsonSchema = { type: 'string', minLength: 1, maxLength: 2048, pattern: '^https://[^\\s]+$' };
export const resourceImagesSchema: JsonSchema = { anyOf: [{ type: 'null' }, {
  type: 'object', properties: Object.fromEntries(RESOURCE_IMAGE_SIZES.map(size => [size, address])), additionalProperties: false,
}] };
export const resourceImageSchema: JsonSchema = { anyOf: [address, { type: 'null' }] };

/** 仅使用已取得的地址；显式尺寸无替代，展示默认优先中等尺寸。 */
export function selectResourceImage(images: ResourceImages | null, size?: ResourceImageSize): string | null {
  if (!images) return null;
  if (size) return images[size] ?? null;
  for (const key of ['medium', 'common', 'large', 'small', 'grid'] as const) if (images[key]) return images[key];
  return null;
}

export function normalizeResourceImages(raw: Record<string, unknown>, field = 'images'): { images?: ResourceImages | null; image?: string | null } {
  if (!Object.hasOwn(raw, field)) return {};
  const value = raw[field];
  if (value == null) return { images: null, image: null };
  if (typeof value !== 'object' || Array.isArray(value)) throw new AppError('INVALID_RESPONSE', '图片资料必须是尺寸地址对象或空值。');
  const source = value as Record<string, unknown>, images: ResourceImages = {};
  for (const size of RESOURCE_IMAGE_SIZES) {
    const url = source[size];
    // 上游用空串表示该尺寸无图；与尚未取得images、非法地址分别处理。
    if (url == null || url === '') continue;
    if (typeof url !== 'string' || url.length > 2048 || !/^https:\/\/[^\s]+$/.test(url))
      throw new AppError('INVALID_RESPONSE', '图片地址必须是已取得的有效HTTPS地址。');
    let parsed: URL;
    try { parsed = new URL(url); } catch { throw new AppError('INVALID_RESPONSE', '图片地址无效。'); }
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password)
      throw new AppError('INVALID_RESPONSE', '图片地址必须是无凭据的HTTPS地址。');
    images[size] = url;
  }
  return { images, image: selectResourceImage(images) };
}
