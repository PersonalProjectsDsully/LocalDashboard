import React from 'react';
import { useNavigate } from 'react-router-dom';
import {
  KBarAnimator,
  KBarPortal,
  KBarPositioner,
  KBarSearch,
  KBarResults,
  useMatches,
  useRegisterActions,
  ActionImpl,
} from 'kbar';

const CommandPalette: React.FC = () => {
  const navigate = useNavigate();
  
  // Register actions
  useRegisterActions([
    // Navigation actions
    {
      id: 'home',
      name: 'Dashboard',
      shortcut: ['g', 'd'],
      keywords: 'home dashboard main',
      perform: () => navigate('/'),
      subtitle: 'Go to Dashboard',
    },
    {
      id: 'projects',
      name: 'Projects',
      shortcut: ['g', 'p'],
      keywords: 'projects',
      perform: () => navigate('/projects'),
      subtitle: 'Go to Projects',
    },
    {
      id: 'documents',
      name: 'Documents',
      shortcut: ['g', 'o'],
      keywords: 'docs documents',
      perform: () => navigate('/documents'),
      subtitle: 'Go to Documents',
    },
    {
      id: 'tasks',
      name: 'Tasks',
      shortcut: ['g', 't'],
      keywords: 'tasks todo',
      perform: () => navigate('/tasks'),
      subtitle: 'Go to Tasks',
    },
    
    // Creation actions
    {
      id: 'new-project',
      name: 'New Project',
      shortcut: ['n', 'p'],
      keywords: 'create new project',
      perform: () => console.log('Create new project'),
      subtitle: 'Create a new project',
    },
    {
      id: 'new-document',
      name: 'New Document',
      shortcut: ['n', 'd'],
      keywords: 'create new document',
      perform: () => console.log('Create new document'),
      subtitle: 'Create a new document',
    },
    {
      id: 'new-task',
      name: 'New Task',
      shortcut: ['n', 't'],
      keywords: 'create new task',
      perform: () => console.log('Create new task'),
      subtitle: 'Create a new task',
    },
    {
      id: 'new-alarm',
      name: 'New Alarm',
      shortcut: ['n', 'a'],
      keywords: 'create new alarm countdown',
      perform: () => console.log('Create new alarm'),
      subtitle: 'Create a new alarm',
    },
    
    // Workspace actions
    {
      id: 'start-workspace',
      name: 'Start Workspace',
      shortcut: ['w', 's'],
      keywords: 'workspace start launch',
      perform: () => console.log('Start workspace'),
      subtitle: 'Start a workspace (⌘ W)',
    },
    
    // Focus Monitor actions
    {
      id: 'toggle-focus-monitor',
      name: 'Toggle Focus Monitor',
      shortcut: ['f', 'm'],
      keywords: 'focus monitor toggle',
      perform: () => console.log('Toggle focus monitor'),
      subtitle: 'Toggle focus monitoring',
    },
    
    // Activity Feed actions
    {
      id: 'toggle-quiet-mode',
      name: 'Toggle Quiet Mode',
      shortcut: ['q', 'm'],
      keywords: 'quiet mode toggle',
      perform: () => console.log('Toggle quiet mode'),
      subtitle: 'Toggle activity feed notifications',
    },
    
    // Command Palette
    {
      id: 'open-command-palette',
      name: 'Command Palette',
      shortcut: ['⌘', '⇧', 'p'],
      keywords: 'command palette search',
      perform: () => {}, // Already open
      subtitle: 'Search for commands (⌘ ⇧ P)',
    },
  ]);
  
  return (
    <KBarPortal>
      <KBarPositioner className="kbar-positioner">
        <KBarAnimator className="kbar-animator">
          <KBarSearch className="kbar-search" placeholder="Type a command or search... (⌘ ⇧ P)" />
          <RenderResults />
        </KBarAnimator>
      </KBarPositioner>
    </KBarPortal>
  );
};

// Custom results renderer
const RenderResults = () => {
  const { results, rootActionId } = useMatches();
  
  return (
    <KBarResults
      items={results}
      onRender={({ item, active }) => (
        <div className={`kbar-result-item ${active ? 'active' : ''}`}>
          {typeof item === 'string' ? (
            <div className="kbar-section-header">{item}</div>
          ) : (
            <ResultItem action={item} active={active} />
          )}
        </div>
      )}
    />
  );
};

// Individual result item
const ResultItem = React.forwardRef(
  ({ action, active }: { action: ActionImpl; active: boolean }, ref: React.Ref<HTMLDivElement>) => {
    return (
      <div ref={ref} className="kbar-result-item-inner">
        <div className="kbar-result-item-icon">
          {/* Icon would go here */}
          <span>{action.name[0]}</span>
        </div>
        <div className="kbar-result-item-text">
          <span>{action.name}</span>
          {action.subtitle && <span className="kbar-result-item-subtitle">{action.subtitle}</span>}
        </div>
        {action.shortcut?.length ? (
          <div className="kbar-result-item-shortcuts">
            {action.shortcut.map((shortcut) => (
              <kbd key={shortcut} className="kbar-shortcut">
                {shortcut}
              </kbd>
            ))}
          </div>
        ) : null}
      </div>
    );
  }
);

ResultItem.displayName = 'ResultItem';

export default CommandPalette;
