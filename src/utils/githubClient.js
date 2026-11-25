import {
  getFileExtension,
  getFileNameFromPath,
  isSupportedFile,
  normalizeFilePath,
} from '../constants/fileTypes.js';

export const EXCLUDED_DIRECTORIES = [
  'node_modules',
  '.git',
  'dist',
  'build',
  '.next',
  '.nuxt',
  '.cache',
  'coverage',
  '__pycache__',
  '.venv',
  'venv',
  'target',
  'out',
  '.idea',
  '.vscode',
  'vendor',
];

const EXCLUDED_DIR_SET = new Set(EXCLUDED_DIRECTORIES.map((dir) => dir.toLowerCase()));

export const EXCLUDED_FILES = [
  'package-lock.json',
  'yarn.lock',
  'pnpm-lock.yaml',
  'bun.lockb',
];

const EXCLUDED_FILE_SET = new Set(EXCLUDED_FILES.map((name) => name.toLowerCase()));

export const MAX_FILE_SIZE_BYTES = 512 * 1024;
export const MAX_REPO_FILES = 200;
export const MAX_TOTAL_BYTES = 10 * 1024 * 1024;
export const FETCH_CONCURRENCY = 6;

const VALID_GITHUB_SEGMENT = /^[A-Za-z0-9._-]+$/;
const GITHUB_API_BASE = 'https://api.github.com';
const GITHUB_RAW_BASE = 'https://raw.githubusercontent.com';
const textEncoder = new TextEncoder();

/**
 * Parses a public GitHub repository URL or `owner/repo` shorthand.
 * Preserves multi-segment branch names in `/tree/...` URLs (e.g. `feature/login`).
 *
 * @param {string} input
 * @returns {{ owner: string, repo: string, branch: string|null, repoUrl: string }}
 */
export function parseGitHubUrl(input) {
  const trimmed = typeof input === 'string' ? input.trim() : '';
  if (!trimmed) {
    throw new Error('Please enter a public GitHub repository URL (e.g. https://github.com/owner/repo).');
  }

  let normalizedUrl = trimmed;
  if (!trimmed.includes('://')) {
    if (/^github\.com\//i.test(trimmed) || /^www\.github\.com\//i.test(trimmed)) {
      normalizedUrl = `https://${trimmed}`;
    } else if (/^[^/\s]+\/[^/\s]+$/.test(trimmed)) {
      normalizedUrl = `https://github.com/${trimmed}`;
    } else {
      throw new Error('Invalid GitHub repository format. Use https://github.com/owner/repo or owner/repo.');
    }
  }

  let parsed;
  try {
    parsed = new URL(normalizedUrl);
  } catch {
    throw new Error('Invalid URL. Please provide a valid GitHub repository URL.');
  }

  const host = parsed.hostname.toLowerCase();
  if (host !== 'github.com' && host !== 'www.github.com') {
    throw new Error('Only GitHub repository URLs (github.com) are supported.');
  }

  const segments = parsed.pathname.split('/').filter(Boolean);
  if (segments.length < 2) {
    throw new Error('Repository URL must include both owner and repository name.');
  }

  const owner = decodeURIComponent(segments[0]);
  const repo = decodeURIComponent(segments[1]).replace(/\.git$/i, '');

  if (
    !VALID_GITHUB_SEGMENT.test(owner) ||
    !VALID_GITHUB_SEGMENT.test(repo) ||
    owner === '.' ||
    owner === '..' ||
    repo === '.' ||
    repo === '..'
  ) {
    throw new Error('Invalid GitHub owner or repository name.');
  }

  let branch = null;
  if (segments[2] === 'tree' && segments.length > 3) {
    branch = segments
      .slice(3)
      .map((seg) => decodeURIComponent(seg))
      .join('/');
  }

  return {
    owner,
    repo,
    branch: branch || null,
    repoUrl: `https://github.com/${owner}/${repo}`,
  };
}

/**
 * Checks whether a repository path belongs to an excluded directory or ignored/minified file.
 *
 * @param {string} rawPath
 * @returns {{ excluded: boolean, reason: 'directory' | 'ignored_file' | null }}
 */
export function shouldExcludeRepoPath(rawPath) {
  const normalized = normalizeFilePath(rawPath);
  if (!normalized) {
    return { excluded: true, reason: 'ignored_file' };
  }

  const segments = normalized.split('/').filter(Boolean);
  const dirSegments = segments.slice(0, -1);

  for (const dir of dirSegments) {
    if (EXCLUDED_DIR_SET.has(dir.toLowerCase())) {
      return { excluded: true, reason: 'directory' };
    }
  }

  const baseName = (segments[segments.length - 1] || '').toLowerCase();
  if (
    EXCLUDED_FILE_SET.has(baseName) ||
    baseName.endsWith('.min.js') ||
    baseName.endsWith('.min.css') ||
    baseName.endsWith('.map')
  ) {
    return { excluded: true, reason: 'ignored_file' };
  }

  return { excluded: false, reason: null };
}

/**
 * Formats GitHub API HTTP errors, including unauthenticated rate-limit reset times.
 *
 * @param {Response} response
 * @param {string} [fallbackMessage]
 * @returns {Promise<string>}
 */
export async function formatGitHubApiError(response, fallbackMessage = '') {
  const data = await response.json().catch(() => null);
  const apiMessage = data?.message || '';
  const remaining = response.headers?.get?.('x-ratelimit-remaining');
  const resetHeader = response.headers?.get?.('x-ratelimit-reset');

  const isRateLimit =
    response.status === 429 ||
    (response.status === 403 && (remaining === '0' || /rate limit/i.test(apiMessage)));

  if (isRateLimit) {
    let resetText = ' Please wait and try again later.';
    if (resetHeader && /^\d+$/.test(resetHeader)) {
      const resetTime = new Date(Number(resetHeader) * 1000).toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      });
      resetText = ` Resets at ${resetTime}.`;
    }
    return `GitHub API rate limit exceeded (60 requests/hour for unauthenticated requests).${resetText}`;
  }

  if (response.status === 404) {
    return (
      fallbackMessage ||
      'Repository or branch not found. Make sure the repository is public and the URL/branch is correct.'
    );
  }

  if (response.status === 403) {
    return apiMessage || 'Access denied by GitHub API. Only public repositories are supported.';
  }

  if (apiMessage) {
    return `GitHub API error (${response.status}): ${apiMessage}`;
  }

  return `${fallbackMessage || 'GitHub API request failed'} (HTTP ${response.status}).`;
}

function throwIfAborted(signal) {
  if (signal?.aborted) {
    const err = new Error('GitHub import cancelled.');
    err.name = 'AbortError';
    throw err;
  }
}

async function fetchGitHubJson(url, signal, notFoundMessage) {
  throwIfAborted(signal);
  const response = await fetch(url, {
    headers: { Accept: 'application/vnd.github+json' },
    signal,
  });

  if (!response.ok) {
    const message = await formatGitHubApiError(response, notFoundMessage);
    throw new Error(message);
  }

  return response.json();
}

function filterAndCapTreeEntries(treeItems = []) {
  const candidates = [];
  let totalTreeBlobs = 0;
  let excludedCount = 0;
  let unsupportedCount = 0;
  let oversizedCount = 0;
  let cappedCount = 0;
  let plannedBytes = 0;

  for (const item of treeItems) {
    if (!item || item.type !== 'blob' || !item.path) continue;
    totalTreeBlobs++;

    const normalizedPath = normalizeFilePath(item.path);
    const exclusion = shouldExcludeRepoPath(normalizedPath);
    if (exclusion.excluded) {
      excludedCount++;
      continue;
    }

    if (!isSupportedFile(normalizedPath)) {
      unsupportedCount++;
      continue;
    }

    const size = typeof item.size === 'number' ? item.size : 0;
    if (size > MAX_FILE_SIZE_BYTES) {
      oversizedCount++;
      continue;
    }

    if (candidates.length >= MAX_REPO_FILES || plannedBytes + size > MAX_TOTAL_BYTES) {
      cappedCount++;
      continue;
    }

    plannedBytes += size;
    candidates.push({
      path: normalizedPath,
      name: getFileNameFromPath(normalizedPath),
      extension: getFileExtension(normalizedPath),
      size,
    });
  }

  return {
    candidates,
    stats: {
      totalTreeBlobs,
      excludedCount,
      unsupportedCount,
      oversizedCount,
      cappedCount,
      failedCount: 0,
      truncated: false,
    },
  };
}

/**
 * Fetches a public GitHub repository's supported source files.
 * Uses query-parameter ref resolution so branches containing `/` (e.g. `feature/login`) resolve cleanly,
 * and downloads raw file content from `raw.githubusercontent.com` without consuming REST API quota.
 *
 * @param {object} options
 * @param {string} options.url - Public GitHub repository URL or `owner/repo`
 * @param {string} [options.branch] - Optional branch, tag, or commit SHA override
 * @param {AbortSignal} [options.signal] - Optional cancellation signal
 * @param {(progress: { phase: string, completed: number, total: number, currentPath?: string }) => void} [options.onProgress]
 * @returns {Promise<{ owner: string, repo: string, branch: string, commitSha: string, repoUrl: string, files: Array, stats: object }>}
 */
export async function fetchGitHubRepository({ url, branch = '', signal, onProgress } = {}) {
  const { owner, repo, branch: urlBranch, repoUrl } = parseGitHubUrl(url);
  const encodedOwner = encodeURIComponent(owner);
  const encodedRepo = encodeURIComponent(repo);

  onProgress?.({ phase: 'metadata', completed: 0, total: 0 });
  const repoData = await fetchGitHubJson(
    `${GITHUB_API_BASE}/repos/${encodedOwner}/${encodedRepo}`,
    signal,
    `Repository "${owner}/${repo}" was not found or is private.`
  );

  if (repoData.private) {
    throw new Error('Private repositories are not supported. Please provide a public GitHub repository.');
  }

  const targetBranch = (typeof branch === 'string' && branch.trim()) || urlBranch || repoData.default_branch;
  if (!targetBranch) {
    throw new Error('Could not determine a target branch for this repository.');
  }

  onProgress?.({ phase: 'branch', completed: 0, total: 0, currentPath: targetBranch });
  const commitsData = await fetchGitHubJson(
    `${GITHUB_API_BASE}/repos/${encodedOwner}/${encodedRepo}/commits?sha=${encodeURIComponent(targetBranch)}&per_page=1`,
    signal,
    `Branch or ref "${targetBranch}" was not found in "${owner}/${repo}".`
  );

  const headCommit = Array.isArray(commitsData) ? commitsData[0] : null;
  const commitSha = headCommit?.sha;
  const treeSha = headCommit?.commit?.tree?.sha;

  if (!commitSha || !treeSha) {
    throw new Error(`Could not resolve commit tree for branch "${targetBranch}".`);
  }

  onProgress?.({ phase: 'tree', completed: 0, total: 0, currentPath: targetBranch });
  const treeData = await fetchGitHubJson(
    `${GITHUB_API_BASE}/repos/${encodedOwner}/${encodedRepo}/git/trees/${encodeURIComponent(treeSha)}?recursive=1`,
    signal,
    `Failed to load file tree for "${owner}/${repo}" (${targetBranch}).`
  );

  const { candidates, stats } = filterAndCapTreeEntries(treeData.tree);
  stats.truncated = Boolean(treeData.truncated);

  if (candidates.length === 0) {
    throw new Error(
      `No supported source files found in "${owner}/${repo}" (${targetBranch}) after filtering.`
    );
  }

  const downloadedFiles = new Array(candidates.length);
  let nextIndex = 0;
  let completed = 0;
  let failedCount = 0;

  async function worker() {
    while (nextIndex < candidates.length) {
      throwIfAborted(signal);
      const currentIdx = nextIndex++;
      const entry = candidates[currentIdx];
      const encodedPath = entry.path
        .split('/')
        .map((segment) => encodeURIComponent(segment))
        .join('/');
      const rawUrl = `${GITHUB_RAW_BASE}/${encodedOwner}/${encodedRepo}/${encodeURIComponent(commitSha)}/${encodedPath}`;

      try {
        const res = await fetch(rawUrl, { signal });
        if (!res.ok) {
          failedCount++;
        } else {
          const content = await res.text();
          const actualSize = entry.size || textEncoder.encode(content).byteLength;
          downloadedFiles[currentIdx] = {
            ...entry,
            size: actualSize,
            content,
          };
        }
      } catch (err) {
        if (err?.name === 'AbortError') throw err;
        failedCount++;
      } finally {
        completed++;
        onProgress?.({
          phase: 'fetching',
          completed,
          total: candidates.length,
          currentPath: entry.path,
        });
      }
    }
  }

  const workerCount = Math.min(FETCH_CONCURRENCY, candidates.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));

  throwIfAborted(signal);
  const validDownloaded = downloadedFiles.filter(Boolean);
  stats.failedCount = failedCount;

  if (validDownloaded.length === 0) {
    throw new Error(`Failed to download source files from "${owner}/${repo}". Please try again.`);
  }

  return {
    owner,
    repo,
    branch: targetBranch,
    commitSha,
    repoUrl,
    files: validDownloaded,
    stats,
  };
}
