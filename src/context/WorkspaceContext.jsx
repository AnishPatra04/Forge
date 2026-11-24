import React, { createContext, useContext, useState, useCallback, useMemo } from 'react';
import { isSupportedFile, getFileExtension } from '../constants/fileTypes';
import { SAMPLE_PROJECT_FILES } from '../constants/sampleProject';
import {
  extractAstMetadata,
  calculateStructuralMetrics,
  performAstAwareSearch,
  resolveFileDependencies,
} from '../utils/astParser';

const WorkspaceContext = createContext(null);

export function WorkspaceProvider({ children }) {
  const [projectName, setProjectName] = useState('Forge Core');
  const [files, setFiles] = useState([]);
  const [activeTab, setActiveTab] = useState('workspace');
  const [activityLog, setActivityLog] = useState([
    {
      id: 'init-1',
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
      type: 'session',
      title: 'Workspace Initialized',
      detail: 'Started fresh FORGE session. Ready for project ingestion.',
    },
  ]);
  const [selectedFile, setSelectedFile] = useState(null);
  const [placeholderModal, setPlaceholderModal] = useState(null);

  // Search state
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState(null);
  const [isSearching, setIsSearching] = useState(false);

  const addActivity = useCallback((type, title, detail) => {
    const newEntry = {
      id: 'act-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
      type,
      title,
      detail,
    };
    setActivityLog((prev) => [newEntry, ...prev]);
  }, []);

  const updateProjectName = useCallback((newName) => {
    const trimmed = newName.trim();
    if (!trimmed) return;
    setProjectName(trimmed);
    addActivity('rename', 'Project Renamed', `Project name updated to "${trimmed}"`);
  }, [addActivity]);

  const importFiles = useCallback(async (fileList) => {
    const validFiles = [];
    const skippedFiles = [];

    for (let i = 0; i < fileList.length; i++) {
      const file = fileList[i];
      if (isSupportedFile(file.name)) {
        try {
          const content = await file.text();
          const lines = content.split('\n');
          const astMetadata = extractAstMetadata(content, file.name);
          validFiles.push({
            id: 'file-' + Date.now() + '-' + i + '-' + Math.random().toString(36).slice(2, 6),
            name: file.name,
            extension: getFileExtension(file.name),
            size: file.size,
            lineCount: lines.length,
            content,
            lastModified: file.lastModified || Date.now(),
            astMetadata,
          });
        } catch (err) {
          console.error(`Failed to read file ${file.name}:`, err);
          skippedFiles.push(file.name);
        }
      } else {
        skippedFiles.push(file.name);
      }
    }

    if (validFiles.length > 0) {
      setFiles((prev) => {
        // Prevent exact duplicates by filename
        const existingNames = new Set(prev.map((f) => f.name));
        const filteredNew = validFiles.filter((f) => !existingNames.has(f.name));
        const combined = [...prev, ...filteredNew];
        return resolveFileDependencies(combined);
      });

      addActivity(
        'import',
        `Imported ${validFiles.length} File${validFiles.length === 1 ? '' : 's'}`,
        `Ingested: ${validFiles.map((f) => f.name).join(', ')}${skippedFiles.length > 0 ? ` (${skippedFiles.length} unsupported files skipped)` : ''}`
      );
    } else if (skippedFiles.length > 0) {
      addActivity(
        'import_warning',
        'Files Skipped',
        `No supported source code files found in selected items (${skippedFiles.join(', ')}).`
      );
    }

    return { addedCount: validFiles.length, skippedCount: skippedFiles.length };
  }, [addActivity]);

  const loadSampleProject = useCallback(() => {
    const sampleFilesWithAst = SAMPLE_PROJECT_FILES.map((sample) => ({
      ...sample,
      astMetadata: extractAstMetadata(sample.content, sample.name),
    }));
    const resolvedSamples = resolveFileDependencies(sampleFilesWithAst);
    setFiles(resolvedSamples);
    setProjectName('Forge Core Engine (Sample)');
    addActivity(
      'import',
      'Loaded Sample Project',
      `Loaded ${SAMPLE_PROJECT_FILES.length} reference files across TypeScript, JavaScript, Python, JSON, and Markdown.`
    );
  }, [addActivity]);

  const removeFile = useCallback((fileId) => {
    setFiles((prev) => {
      const target = prev.find((f) => f.id === fileId);
      if (target) {
        addActivity('remove', 'File Removed', `Removed ${target.name} from current workspace.`);
      }
      const remaining = prev.filter((f) => f.id !== fileId);
      return resolveFileDependencies(remaining);
    });

    if (selectedFile?.id === fileId) {
      setSelectedFile(null);
    }

    // Refresh search results if active
    if (searchResults) {
      setSearchResults((prev) => (prev ? prev.filter((r) => r.fileId !== fileId) : null));
    }
  }, [addActivity, selectedFile, searchResults]);

  const clearAllFiles = useCallback(() => {
    const count = files.length;
    setFiles([]);
    setSelectedFile(null);
    setSearchResults(null);
    setSearchQuery('');
    addActivity('clear', 'Workspace Cleared', `Cleared all ${count} files from the active session.`);
  }, [files.length, addActivity]);

  const executeSearch = useCallback((query) => {
    const raw = query.trim();
    setSearchQuery(raw);

    if (!raw) {
      setSearchResults(null);
      return;
    }

    setIsSearching(true);

    const { results, grandTotalMatches } = performAstAwareSearch(files, raw);

    setSearchResults(results);
    setIsSearching(false);

    addActivity(
      'search',
      `Searched "${raw}"`,
      results && results.length > 0
        ? `Found ${grandTotalMatches} match${grandTotalMatches === 1 ? '' : 'es'} across ${results.length} file${results.length === 1 ? '' : 's'}.`
        : `No matches found across ${files.length} loaded files.`
    );
  }, [files, addActivity]);

  const clearActivityLog = useCallback(() => {
    setActivityLog([
      {
        id: 'init-cleared',
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
        type: 'session',
        title: 'Activity Log Reset',
        detail: 'Session events cleared by user.',
      },
    ]);
  }, []);

  const openPlaceholder = useCallback((featureName, targetMilestone = 'Milestone 2') => {
    setPlaceholderModal({
      isOpen: true,
      featureName,
      targetMilestone,
    });
  }, []);

  const closePlaceholder = useCallback(() => {
    setPlaceholderModal(null);
  }, []);

  const structuralMetrics = useMemo(() => {
    return calculateStructuralMetrics(files);
  }, [files]);

  return (
    <WorkspaceContext.Provider
      value={{
        projectName,
        updateProjectName,
        files,
        importFiles,
        loadSampleProject,
        removeFile,
        clearAllFiles,
        activeTab,
        setActiveTab,
        activityLog,
        clearActivityLog,
        selectedFile,
        setSelectedFile,
        searchQuery,
        setSearchQuery,
        searchResults,
        isSearching,
        executeSearch,
        placeholderModal,
        openPlaceholder,
        closePlaceholder,
        structuralMetrics,
        totalFunctions: structuralMetrics.totalFunctions,
        totalClasses: structuralMetrics.totalClasses,
        totalVariables: structuralMetrics.totalVariables,
        totalImports: structuralMetrics.totalImports,
        totalExports: structuralMetrics.totalExports,
      }}
    >
      {children}
    </WorkspaceContext.Provider>
  );
}

export function useWorkspace() {
  const context = useContext(WorkspaceContext);
  if (!context) {
    throw new Error('useWorkspace must be used within a WorkspaceProvider');
  }
  return context;
}
