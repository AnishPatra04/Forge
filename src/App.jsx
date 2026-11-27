import React, { useState } from 'react';
import { WorkspaceProvider, useWorkspace } from './context/WorkspaceContext';
import { Sidebar } from './components/Sidebar';
import { Header } from './components/Header';
import { WorkspaceView } from './views/WorkspaceView';
import { ProjectGraphView } from './views/ProjectGraphView';
import { ArchitectureView } from './views/ArchitectureView';
import { InterviewView } from './views/InterviewView';
import { ProjectsView } from './views/ProjectsView';
import { ActivityView } from './views/ActivityView';
import { SettingsView } from './views/SettingsView';
import { CodeViewerModal } from './components/CodeViewerModal';
import { PlaceholderModal } from './components/PlaceholderModal';
import { GitHubImportModal } from './components/GitHubImportModal';

function AppContent() {
  const { activeTab } = useWorkspace();
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);

  const toggleSidebar = () => {
    setIsSidebarCollapsed((prev) => !prev);
  };

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-background text-foreground antialiased select-none">
      {/* Dynamic Collapsible Sidebar */}
      <Sidebar isCollapsed={isSidebarCollapsed} onToggle={toggleSidebar} />

      {/* Main Inset Content Area */}
      <div className="flex-1 flex flex-col min-w-0 h-screen overflow-hidden bg-background">
        <Header isSidebarCollapsed={isSidebarCollapsed} onToggleSidebar={toggleSidebar} />

        <main className="flex-1 flex overflow-hidden">
          {activeTab === 'workspace' && <WorkspaceView />}
          {activeTab === 'graph' && <ProjectGraphView />}
          {activeTab === 'architecture' && <ArchitectureView />}
          {activeTab === 'interview' && <InterviewView />}
          {activeTab === 'projects' && <ProjectsView />}
          {activeTab === 'activity' && <ActivityView />}
          {activeTab === 'settings' && <SettingsView />}
        </main>
      </div>

      {/* Global Modals */}
      <CodeViewerModal />
      <PlaceholderModal />
      <GitHubImportModal />
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
