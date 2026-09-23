export const normalizeStorageKey = (input: string): string => {
  const safe = String(input ?? '').trim().replace(/\\/g, '/');
  const withoutLeadingSlash = safe.replace(/^\/+/, '');
  const collapsed = withoutLeadingSlash.replace(/\/+/g, '/');
  return collapsed.replace(/\/$/, '');
};

export const buildPublicS3Url = (
  key: string,
  region: string,
  bucket: string,
): string => {
  const normalizedKey = normalizeStorageKey(key);
  return `https://${bucket}.s3.${region}.amazonaws.com/${normalizedKey}`;
};
