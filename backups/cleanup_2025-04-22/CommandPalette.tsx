import React, { createContext, useContext } from 'react';
import {
  KBarProvider,
  KBarPortal,
  KBarPositioner,
  KBarAnimator,
  KBarSearch,
  KBarResults,
  useMatches,
  ActionImpl,
  ActionId,
  useKBar,
  createAction
} from 'kbar';
import { useNavigate } from 'react-router-dom';
import { eventBus } from '../App'; // Import the event bus

// Create a context to expose the KBar query
export const CommandPaletteContext = createContext({ toggle: () => {} });
export const useCommandPalette = () => useContext(CommandPaletteContext);

// This is the inner component that uses KBar hooks
const CommandPaletteInner: React.FC = () => {
  const { query } = useKBar();
  
  // Set up the context with the toggle function
  React.useEffect(() => {
    // Update the global toggle function to use this query
    window.toggleCommandPalette = () => query.toggle();
  }, [query]);

  // Component to render the results list
  const RenderResults = () => {
    const { results, rootActionId } = useMatches();

    return (
      <KBarResults
        items={results}
        onRender={({ item, active }) =>
          typeof item === 'string' ? (
            // Render section header
            <div className="px-4 pt-4 pb-2 text-xs uppercase text-gray-500 dark:text-gray-400 tracking-wider">{item}</div>
          ) : (
            // Render action item
            <div
                className={`flex items-center justify-between px-4 py-2 cursor-pointer transition-colors duration-100 ${
                active ? 'bg-blue-100 dark:bg-blue-800/50' : 'bg-transparent'
              }`}
            >
              <div className="flex items-center gap-3">
                 {item.icon && <span className="text-gray-500 dark:text-gray-400">{item.icon}</span>}
                <span className="text-sm text-gray-800 dark:text-gray-100">{item.name}</span>
              </div>
               {item.shortcut?.length ? (
                <div aria-hidden className="grid grid-flow-col gap-1">
                  {item.shortcut.map((sc) => (
                    <kbd key={sc} className="px-1.5 py-0.5 text-xs font-mono text-gray-500 dark:text-gray-400 bg-gray-100 dark:bg-gray-700 rounded border border-gray-300 dark:border-gray-600">
                      {sc}
                    </kbd>
                  ))}
                </div>
              ) : null}
            </div>
          )
        }
      />
    );
  };

  return (
    <KBarPortal>
      <KBarPositioner className="fixed inset-0 z-50 bg-black bg-opacity-50 backdrop-blur-sm flex items-start justify-center pt-20">
        <KBarAnimator className="w-full max-w-xl bg-white dark:bg-gray-800 rounded-lg shadow-xl overflow-hidden border border-gray-200 dark:border-gray-700">
          <KBarSearch
            className="w-full px-4 py-3 text-lg outline-none bg-transparent text-gray-800 dark:text-gray-100 border-b border-gray-200 dark:border-gray-700"
            placeholder="Type a command or search..."
          />
          <RenderResults />
          <div className="px-4 py-2 text-xs text-center text-gray-500 dark:text-gray-400 border-t border-gray-200 dark:border-gray-700">
            Tip: Use <kbd className="px-1 py-0.5 text-xs font-mono bg-gray-100 dark:bg-gray-700 rounded border border-gray-300 dark:border-gray-600">↑</kbd> <kbd className="px-1 py-0.5 text-xs font-mono bg-gray-100 dark:bg-gray-700 rounded border border-gray-300 dark:border-gray-600">↓</kbd> to navigate, <kbd className="px-1 py-0.5 text-xs font-mono bg-gray-100 dark:bg-gray-700 rounded border border-gray-300 dark:border-gray-600">Enter</kbd> to select.
          </div>
        </KBarAnimator>
      </KBarPositioner>
    </KBarPortal>
  );
};

// Add the global toggle function to window
declare global {
  interface Window {
    toggleCommandPalette: () => void;
  }
}
window.toggleCommandPalette = () => {};

// This is the outer component that provides context
const CommandPalette: React.FC = () => {
  const navigate = useNavigate();

  // Define actions available in the command palette
  const actions = [
    // Navigation Actions
    {
      id: 'dashboard',
      name: 'Dashboard',
      shortcut: ['g', 'd'],
      keywords: 'home overview main',
      section: 'Navigation',
      perform: () => navigate('/'),
      icon: <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path d="M10.707 2.293a1 1 0 00-1.414 0l-7 7a1 1 0 001.414 1.414L4 10.414V17a1 1 0 001 1h2a1 1 0 001-1v-2a1 1 0 011-1h2a1 1 0 011 1v2a1 1 0 001 1h2a1 1 0 001-1v-6.586l.293.293a1 1 0 001.414-1.414l-7-7z" /></svg>,
    },
    {
      id: 'projects',
      name: 'Projects',
      shortcut: ['g', 'p'],
      keywords: 'project list view manage',
      section: 'Navigation',
      perform: () => navigate('/projects'),
      icon: <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path d="M2 6a2 2 0 012-2h5l2 2h5a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" /></svg>,
    },
     {
      id: 'documents',
      name: 'Documents',
      shortcut: ['g', 'o'], // 'o' for documents seems reasonable
      keywords: 'docs files notes knowledge',
      section: 'Navigation',
      perform: () => navigate('/documents'),
      icon: <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4zm2 6a1 1 0 011-1h6a1 1 0 110 2H7a1 1 0 01-1-1zm1 3a1 1 0 100 2h6a1 1 0 100-2H7z" clipRule="evenodd" /></svg>,
    },
     {
      id: 'tasks',
      name: 'Tasks',
      shortcut: ['g', 't'],
      keywords: 'task todo list action',
      section: 'Navigation',
      perform: () => navigate('/tasks'),
      icon: <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" /></svg>,
    },
     // TODO: Add actions for:
    // - Creating new project
    // - Creating new task
    // - Creating new document
    // - Activating a project workspace
    // - Toggling focus mode
    // - Searching specific content types (projects, tasks, docs)

      {
      id: 'toggleFocus',
      name: 'Toggle Focus Monitor',
      shortcut: ['f', 'm'],
      keywords: 'focus mode distraction block',
      section: 'General',
      perform: () => {
        // Need to interact with backend via API or trigger an event listened to by Sidebar
        // Option 1: Direct API call (if simple)
        fetch('http://localhost:8000/focus/toggle', { method: 'POST' })
          .then(res => {
            if (!res.ok) throw new Error('Failed to toggle focus');
            // Trigger UI update (if not handled by WebSocket already)
            eventBus.emit('focus_status_changed', {}); // Emit generic event
          })
          .catch(error => console.error('Error toggling focus from KBar:', error));

        // Option 2: Event Bus (preferred if Sidebar handles state)
        // eventBus.emit('toggle_focus_request', {});
      },
      icon: <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM7 9a1 1 0 000 2h6a1 1 0 100-2H7z" clipRule="evenodd" /></svg>,
    },
  ];

  return (
    <CommandPaletteContext.Provider value={{ toggle: () => window.toggleCommandPalette() }}>
      <KBarProvider actions={actions}>
        <CommandPaletteInner />
      </KBarProvider>
    </CommandPaletteContext.Provider>
  );
};

export default CommandPalette;