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
  '.js': { label: 'JavaScript', color: 'text-white/80 border-white/10 bg-white/5' },
  '.jsx': { label: 'React JSX', color: 'text-white/80 border-white/10 bg-white/5' },
  '.ts': { label: 'TypeScript', color: 'text-white/80 border-white/10 bg-white/5' },
  '.tsx': { label: 'React TSX', color: 'text-white/80 border-white/10 bg-white/5' },
  '.java': { label: 'Java', color: 'text-white/80 border-white/10 bg-white/5' },
  '.py': { label: 'Python', color: 'text-white/80 border-white/10 bg-white/5' },
  '.html': { label: 'HTML', color: 'text-white/80 border-white/10 bg-white/5' },
  '.css': { label: 'CSS', color: 'text-white/80 border-white/10 bg-white/5' },
  '.json': { label: 'JSON', color: 'text-white/80 border-white/10 bg-white/5' },
  '.md': { label: 'Markdown', color: 'text-white/70 border-white/10 bg-white/5' },
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
