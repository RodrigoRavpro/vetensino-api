import { describe, expect, it } from 'vitest';
import { buildPublicS3Url, normalizeStorageKey } from './storagePaths';

describe('storage paths', () => {
  it('normalizes keys without a global prefix and keeps subfolders by demand', () => {
    expect(normalizeStorageKey('/course-covers/123/banner.png')).toBe('course-covers/123/banner.png');
    expect(normalizeStorageKey('course-covers//123///banner.png')).toBe('course-covers/123/banner.png');
    expect(normalizeStorageKey('lesson-material/1/arquivo.pdf')).toBe('lesson-material/1/arquivo.pdf');
  });

  it('builds a public s3 url for the dedicated bucket', () => {
    expect(buildPublicS3Url('course-covers/123/banner.png', 'sa-east-1', 'purple-vet-cursos')).toBe(
      'https://purple-vet-cursos.s3.sa-east-1.amazonaws.com/course-covers/123/banner.png',
    );
  });
});
