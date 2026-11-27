import React, { useState, useEffect } from 'react';
import { WorkspaceProvider, useWorkspace } from './context/WorkspaceContext';
import { Sidebar } from './components/Sidebar';
import { Header } from './components/Header';
import { WorkspaceView } from './views/WorkspaceView';
import { AssistantView } from './views/AssistantView';
import { CodeReviewView } from './views/CodeReviewView';
import { ChangeImpactView } from './views/ChangeImpactView';
import { ProjectGraphView } from './views/ProjectGraphView';
import { ArchitectureView } from './views/ArchitectureView';
import { InterviewView } from './views/InterviewView';
import { TestCasesView } from './views/TestCasesView';
import { ProjectsView } from './views/ProjectsView';
import { ActivityView } from './views/ActivityView';
import { SettingsView } from './views/SettingsView';
import { CodeViewerModal } from './components/CodeViewerModal';
import { PlaceholderModal } from './components/PlaceholderModal';
import { GitHubImportModal } from './components/GitHubImportModal';
import { CommandPaletteModal } from './components/CommandPaletteModal';

function AppContent() {
  const { activeTab } = useWorkspace();
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false);

  const toggleSidebar = () => {
    setIsSidebarCollapsed((prev) => !prev);
  };

  useEffect(() => {
    const handleKeyDown = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key?.toLowerCase() === 'k') {
        e.preventDefault();
        setIsCommandPaletteOpen((prev) => !prev);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-background text-foreground antialiased select-none font-sans">
      {/* Dynamic Collapsible Sidebar */}
      <Sidebar isCollapsed={isSidebarCollapsed} onToggle={toggleSidebar} />

      {/* Main Inset Content Area */}
      <div className="flex-1 flex flex-col min-w-0 h-screen overflow-hidden bg-background">
        <Header
          isSidebarCollapsed={isSidebarCollapsed}
          onToggleSidebar={toggleSidebar}
          onOpenCommandPalette={() => setIsCommandPaletteOpen(true)}
        />

        <main className="flex-1 flex overflow-hidden">
          {activeTab === 'workspace' && <WorkspaceView />}
          {activeTab === 'assistant' && <AssistantView />}
          {activeTab === 'review' && <CodeReviewView />}
          {activeTab === 'impact' && <ChangeImpactView />}
          {activeTab === 'graph' && <ProjectGraphView />}
          {activeTab === 'architecture' && <ArchitectureView />}
          {activeTab === 'interview' && <InterviewView />}
          {activeTab === 'tests' && <TestCasesView />}
          {activeTab === 'projects' && <ProjectsView />}
          {activeTab === 'activity' && <ActivityView />}
          {activeTab === 'settings' && <SettingsView />}
        </main>
      </div>

      {/* Global Modals */}
      <CodeViewerModal />
      <PlaceholderModal />
      <GitHubImportModal />
      <CommandPaletteModal
        isOpen={isCommandPaletteOpen}
        onClose={() => setIsCommandPaletteOpen(false)}
      />
    </div>
  );
}

export default function App() {
  return (
    <WorkspaceProvider>
      <AppContent />
    </WorkspaceProvider>
  );
}
