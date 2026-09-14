/**
 * Generate a URL-friendly slug from a string.
 */
export const slugify = (text: string): string => {
  return text
    .toString()
    .normalize('NFD') // Normalize accented characters (e.g. é -> e + accent)
    .replace(/[\u0300-\u036f]/g, '') // Remove accent marks
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '') // Remove invalid chars
    .replace(/[\s_-]+/g, '-') // Replace spaces and underscores with a single hyphen
    .replace(/^-+|-+$/g, ''); // Trim leading and trailing hyphens
};
