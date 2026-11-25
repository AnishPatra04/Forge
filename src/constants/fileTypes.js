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
  '.js': { label: 'JavaScript', color: 'text-amber-400 border-amber-400/20 bg-amber-400/10' },
  '.jsx': { label: 'React JSX', color: 'text-cyan-400 border-cyan-400/20 bg-cyan-400/10' },
  '.ts': { label: 'TypeScript', color: 'text-blue-400 border-blue-400/20 bg-blue-400/10' },
  '.tsx': { label: 'React TSX', color: 'text-sky-400 border-sky-400/20 bg-sky-400/10' },
  '.java': { label: 'Java', color: 'text-red-400 border-red-400/20 bg-red-400/10' },
  '.py': { label: 'Python', color: 'text-emerald-400 border-emerald-400/20 bg-emerald-400/10' },
  '.html': { label: 'HTML', color: 'text-orange-400 border-orange-400/20 bg-orange-400/10' },
  '.css': { label: 'CSS', color: 'text-indigo-400 border-indigo-400/20 bg-indigo-400/10' },
  '.json': { label: 'JSON', color: 'text-yellow-400 border-yellow-400/20 bg-yellow-400/10' },
  '.md': { label: 'Markdown', color: 'text-slate-300 border-slate-600/30 bg-slate-800/40' },
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
