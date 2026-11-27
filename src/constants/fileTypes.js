export const SUPPORTED_EXTENSIONS = [
  '.js',
  '.jsx',
  '.ts',
  '.tsx',
  '.java',
  '.py',
  '.html',
  '.css',
  '.json',
  '.md',
];

export const EXTENSION_CONFIG = {
  '.js': { label: 'JavaScript', color: 'text-[#E8B66D] border-[#E8B66D]/25 bg-[#E8B66D]/10' },
  '.jsx': { label: 'React JSX', color: 'text-[#8CD1C4] border-[#8CD1C4]/25 bg-[#8CD1C4]/10' },
  '.ts': { label: 'TypeScript', color: 'text-[#8CB8E8] border-[#8CB8E8]/25 bg-[#8CB8E8]/10' },
  '.tsx': { label: 'React TSX', color: 'text-[#9CC8F0] border-[#9CC8F0]/25 bg-[#9CC8F0]/10' },
  '.java': { label: 'Java', color: 'text-[#EF7777] border-[#EF7777]/25 bg-[#EF7777]/10' },
  '.py': { label: 'Python', color: 'text-[#8CCB9A] border-[#8CCB9A]/25 bg-[#8CCB9A]/10' },
  '.html': { label: 'HTML', color: 'text-[#E69D6E] border-[#E69D6E]/25 bg-[#E69D6E]/10' },
  '.css': { label: 'CSS', color: 'text-[#B5A0E6] border-[#B5A0E6]/25 bg-[#B5A0E6]/10' },
  '.json': { label: 'JSON', color: 'text-[#D4C77A] border-[#D4C77A]/25 bg-[#D4C77A]/10' },
  '.md': { label: 'Markdown', color: 'text-[#929B91] border-white/10 bg-[#222922]' },
};

export const normalizeFilePath = (rawPath = '') => {
  if (typeof rawPath !== 'string') return '';
  return rawPath
    .trim()
    .replace(/\\/g, '/')
    .replace(/\/{2,}/g, '/')
    .replace(/^(\.\/|\/)+/, '');
};

export const getFileNameFromPath = (filePath = '') => {
  const normalized = normalizeFilePath(filePath);
  if (!normalized) return '';
  const lastSlashIndex = normalized.lastIndexOf('/');
  return lastSlashIndex === -1 ? normalized : normalized.slice(lastSlashIndex + 1);
};

export const getFilePath = (file) => {
  if (!file) return '';
  if (typeof file === 'string') return normalizeFilePath(file);
  return normalizeFilePath(
    file.path || file.relativePath || file.webkitRelativePath || file.name || ''
  );
};

export const getFileExtension = (filename = '') => {
  const baseName = getFileNameFromPath(filename);
  if (!baseName) return '';
  const lastDotIndex = baseName.lastIndexOf('.');
  if (lastDotIndex <= 0) return '';
  return baseName.slice(lastDotIndex).toLowerCase();
};

export const isSupportedFile = (filename = '') => {
  const ext = getFileExtension(filename);
  return SUPPORTED_EXTENSIONS.includes(ext);
};
