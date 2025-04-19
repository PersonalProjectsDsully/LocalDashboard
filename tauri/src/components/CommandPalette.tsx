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
    },
    {
      id: 'projects',
      name: 'Projects',
      shortcut: ['g', 'p'],
      keywords: 'projects',
      perform: () => navigate('/projects'),
    },
    {
      id: 'documents',
      name: 'Documents',
      shortcut: ['g', 'o'],
      keywords: 'docs documents',
      perform: () => navigate('/documents'),
    },
    {
      id: 'tasks',
      name: 'Tasks',
      shortcut: ['g', 't'],
      keywords: 'tasks todo',
      perform: () => navigate('/tasks'),
    },
    
    // Creation actions
    {
      id: 'new-project',
      name: 'New Project',
      shortcut: ['n', 'p'],
      keywords: 'create new project',
      perform: () => console.log('Create new project'),
    },
    {
      id: 'new-document',
      name: 'New Document',
      shortcut: ['n', 'd'],
      keywords: 'create new document',
      perform: () => console.log('Create new document'),
    },
    {
      id: 'new-task',
      name: 'New Task',
      shortcut: ['n', 't'],
      keywords: 'create new task',
      perform: () => console.log('Create new task'),
    },
    {
      id: 'new-alarm',
      name: 'New Alarm',
      shortcut: ['n', 'a'],
      keywords: 'create new alarm countdown',
      perform: () => console.log('Create new alarm'),
    },
    
    // Workspace actions
    {
      id: 'start-workspace',
      name: 'Start Workspace',
      shortcut: ['w', 's'],
      keywords: 'workspace start launch',
      perform: () => console.log('Start workspace'),
    },
    
    // Focus Monitor actions
    {
      id: 'toggle-focus-monitor',
      name: 'Toggle Focus Monitor',
      shortcut: ['f', 'm'],
      keywords: 'focus monitor toggle',
      perform: () => console.log('Toggle focus monitor'),
    },
    
    // Activity Feed actions
    {
      id: 'toggle-quiet-mode',
      name: 'Toggle Quiet Mode',
      shortcut: ['q', 'm'],
      keywords: 'quiet mode toggle',
      perform: () => console.log('Toggle quiet mode'),
    },
  ]);
  
  return (
    <KBarPortal>
      <KBarPositioner className="kbar-positioner">
        <KBarAnimator className="kbar-animator">
          <KBarSearch className="kbar-search" placeholder="Type a command or search..." />
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
