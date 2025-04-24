import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import axios from 'axios';
import ReactMarkdown from 'react-markdown';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vs2015 } from 'react-syntax-highlighter/dist/styles';
import remarkGfm from 'remark-gfm';
import { useLocation, useNavigate } from 'react-router-dom';
import { eventBus } from '../App';

// --- Interfaces ---
interface Project {
  id: string;
  title: string;
}

interface DocMetadata {
  id: string; // Use path as ID
  title: string;
  path: string;
  project_id: string;
}

interface Document extends DocMetadata {
  content: string;
  lastModified?: string; // Optional, maybe from file system later
}

// --- Menu Button Component ---
const MenuButton = ({ 
  onClick, 
  active = false, 
  disabled = false, 
  label,
  children
}: { 
  onClick: () => void, 
  active?: boolean, 
  disabled?: boolean, 
  label: string,
  children: React.ReactNode
}) => {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={label}
      className={`px-2 py-1 text-sm rounded ${active 
        ? 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200' 
        : 'bg-white text-gray-700 dark:bg-gray-700 dark:text-gray-200'} 
        hover:bg-gray-100 dark:hover:bg-gray-600 border border-gray-300 dark:border-gray-600
        disabled:opacity-50 disabled:cursor-not-allowed transition-colors`}
    >
      {children}
    </button>
  );
};

// --- Markdown Toolbar Component ---
const MarkdownToolbar = ({ 
  onAction 
}: { 
  onAction: (action: string, value?: string) => void 
}) => {
  return (
    <div className="markdown-toolbar flex flex-wrap gap-2 mb-2 bg-gray-100 dark:bg-gray-800 p-2 rounded border border-gray-300 dark:border-gray-600">
      {/* Heading Buttons */}
      <div className="btn-group flex gap-1">
        <MenuButton onClick={() => onAction('heading', '# ')} label="Heading 1">
          H1
        </MenuButton>
        <MenuButton onClick={() => onAction('heading', '## ')} label="Heading 2">
          H2
        </MenuButton>
        <MenuButton onClick={() => onAction('heading', '### ')} label="Heading 3">
          H3
        </MenuButton>
      </div>

      <div className="separator mx-1 border-r border-gray-300 dark:border-gray-600"></div>

      {/* Text Formatting */}
      <MenuButton onClick={() => onAction('bold')} label="Bold">
        <strong>B</strong>
      </MenuButton>
      <MenuButton onClick={() => onAction('italic')} label="Italic">
        <em>I</em>
      </MenuButton>
      
      <div className="separator mx-1 border-r border-gray-300 dark:border-gray-600"></div>

      {/* Lists */}
      <MenuButton onClick={() => onAction('bulletList')} label="Bullet List">
        <span className="text-lg leading-none">•</span>
      </MenuButton>
      <MenuButton onClick={() => onAction('orderedList')} label="Numbered List">
        <span className="text-lg leading-none">#</span>
      </MenuButton>
      
      <div className="separator mx-1 border-r border-gray-300 dark:border-gray-600"></div>

      {/* Code */}
      <MenuButton onClick={() => onAction('inlineCode')} label="Inline Code">
        <code>Code</code>
      </MenuButton>
      <MenuButton onClick={() => onAction('codeBlock')} label="Code Block">
        <span className="font-mono">{"{ }"}</span>
      </MenuButton>
      
      <div className="separator mx-1 border-r border-gray-300 dark:border-gray-600"></div>

      {/* Link */}
      <MenuButton onClick={() => {
        const url = window.prompt('Enter URL');
        const text = window.prompt('Enter link text');
        if (url && text) {
          onAction('link', `[${text}](${url})`);
        }
      }} label="Link">
        🔗
      </MenuButton>
      
      {/* Image - Optional */}
      <MenuButton onClick={() => {
        const url = window.prompt('Enter image URL');
        const alt = window.prompt('Enter image description');
        if (url) {
          onAction('image', `![${alt || 'image'}](${url})`);
        }
      }} label="Insert Image">
        📷
      </MenuButton>
    </div>
  );
};

// --- Component ---
const Documents: React.FC = () => {
  // --- State ---
  const location = useLocation();
  const navigate = useNavigate();
  const passedProjectId = location.state?.projectId;
  const passedDocPath = location.state?.docPath;
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProject, setSelectedProject] = useState<string | null>(passedProjectId || null);
  const [docList, setDocList] = useState<DocMetadata[]>([]);
  const [selectedDocPath, setSelectedDocPath] = useState<string | null>(passedDocPath || null);
  const [selectedDoc, setSelectedDoc] = useState<Document | null>(null);
  const [editMode, setEditMode] = useState(false);
  const [markdownContent, setMarkdownContent] = useState('');
  const [loadingProjects, setLoadingProjects] = useState(true);
  const [loadingList, setLoadingList] = useState(false);
  const [loadingContent, setLoadingContent] = useState(false);
  const [isPinned, setIsPinned] = useState(false);
  const [loadingPinnedStatus, setLoadingPinnedStatus] = useState(false);
  const [pinnedDocs, setPinnedDocs] = useState<string[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const editorRef = useRef<HTMLTextAreaElement>(null);

  // --- Data Fetching Callbacks ---
  const fetchProjects = useCallback(async () => {
    setLoadingProjects(true);
    setError(null); // Clear previous errors
    try {
        const response = await axios.get('http://localhost:8000/projects');
        console.log('Projects API response:', response.data);
        // Handle both formats: direct array or {projects: array}
        const fetchedProjects = Array.isArray(response.data) ? response.data : (response.data.projects || []);
        setProjects(fetchedProjects);
        // Set default selected project only if none is selected/passed and projects exist
        if (fetchedProjects.length > 0 && !selectedProject) {
            setSelectedProject(fetchedProjects[0].id);
        } else if (fetchedProjects.length === 0) {
            setSelectedProject(null); // No projects, clear selection
        }
    } catch (err) {
        console.error('Error fetching projects:', err);
        setError('Failed to load projects.');
        setProjects([]);
        setSelectedProject(null);
    } finally {
        setLoadingProjects(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Run once or when selectedProject logic might need re-evaluation (though unlikely here)

  const fetchDocList = useCallback(async (projectId: string | null) => {
      if (!projectId) {
          setDocList([]);
          setLoadingList(false);
          return; // No project selected
      }
      setLoadingList(true);
      setError(null); // Clear errors specific to doc list loading
      // Clear selected document details when project changes
      setSelectedDoc(null);
      setSelectedDocPath(null);
      setEditMode(false);
      try {
          // Since there's no direct API endpoint for documents, let's mock it for now
          // In a real implementation, this would call the appropriate backend API
          console.log(`Fetching document list for project ${projectId}`);
          
          // Mock data for documents
          const mockDocs: DocMetadata[] = [
              {
                  id: `${projectId}/docs/readme.md`,
                  title: 'README',
                  path: `${projectId}/docs/readme.md`,
                  project_id: projectId
              },
              {
                  id: `${projectId}/docs/notes.md`,
                  title: 'Project Notes',
                  path: `${projectId}/docs/notes.md`,
                  project_id: projectId
              }
          ];
          
          // Simulate API delay
          await new Promise(resolve => setTimeout(resolve, 300));
          
          setDocList(mockDocs);
      } catch (err) {
          console.error('Error fetching document list:', err);
          setError(`Failed to load documents for project.`);
          setDocList([]);
      } finally {
          setLoadingList(false);
      }
  }, []); // No dependencies needed, uses passed projectId

  const fetchDocContent = useCallback(async (docPath: string | null) => {
       if (!docPath) {
           setSelectedDoc(null); // Clear doc content if path is cleared
           setLoadingContent(false);
           return;
       }
       setLoadingContent(true);
       setError(null); // Clear errors specific to content loading
       setEditMode(false); // Always reset to preview mode when loading new doc
       try {
           // Since there's no direct API endpoint for document content, let's check localStorage first
           // then fall back to mock data
           console.log(`Fetching content for document: ${docPath}`);
           
           // Find matching metadata from the list (mostly for title)
           const docMetadata = docList.find(d => d.path === docPath);
           const title = docMetadata?.title || docPath.split('/').pop()?.replace('.md', '') || 'Document';
           
           // Check if we have this document stored in localStorage
           const localStorageKey = `document:${docPath}`;
           const savedContent = localStorage.getItem(localStorageKey);
           
           // Default mock content based on path
           let defaultContent = '';
           if (docPath.endsWith('readme.md')) {
               defaultContent = `# ${title}\n\nThis is a README file for the project. Edit me to add project information.\n\n## Getting Started\n\n1. Create new tasks in the Tasks section\n2. Add project documentation here\n3. Track your progress\n`;
           } else if (docPath.endsWith('notes.md')) {
               defaultContent = `# Project Notes\n\nUse this document to keep track of important project notes and decisions.\n\n## Meeting Notes\n\n- Initial project discussion (YYYY-MM-DD)\n- Follow-up meeting (YYYY-MM-DD)\n\n## Decisions\n\n- Decision 1: Description of the decision\n- Decision 2: Description of the decision\n`;
           } else {
               defaultContent = `# ${title}\n\nThis is a new document. Edit me to add content.`;
           }
           
           // Use localStorage content if available, otherwise use default mock content
           const content = savedContent || defaultContent;
           
           // Simulate API delay
           await new Promise(resolve => setTimeout(resolve, 400));
           
           const newDoc = {
               id: docPath, // path is the ID
               title: title,
               path: docPath,
               project_id: selectedProject || 'unknown', // Should have selectedProject
               content: content,
           };
           
           setSelectedDoc(newDoc);
           setMarkdownContent(content); // Set markdown content for the editor
           
       } catch (err) {
           console.error('Error fetching document content:', err);
           setError(`Failed to load document: ${docPath.split('/').pop()}`);
           setSelectedDoc(null);
           setSelectedDocPath(null); // Reset path if content load fails
       } finally {
           setLoadingContent(false);
       }
  }, [docList, selectedProject]); // Depend on docList to find title, selectedProject for context

  // --- Effects ---
  useEffect(() => {
      fetchProjects(); // Fetch projects on initial mount
  }, [fetchProjects]);

  useEffect(() => {
      fetchDocList(selectedProject); // Fetch doc list when project changes
  }, [selectedProject, fetchDocList]);

  useEffect(() => {
      fetchDocContent(selectedDocPath); // Fetch content when doc path changes
      // Check if document is pinned whenever the selection changes
      if (selectedDocPath) {
        checkPinnedStatus(selectedDocPath);
      }
  }, [selectedDocPath, fetchDocContent]);
  
  // --- Pinned Documents Check ---
  const fetchPinnedDocs = useCallback(async () => {
    try {
        setLoadingPinnedStatus(true);
        const response = await axios.get('http://localhost:8000/meta/pinned_docs');
        const docs = response.data.pinned_docs || [];
        // Extract just the paths for easier checking
        const paths = docs.map((doc: any) => doc.path);
        setPinnedDocs(paths);
        return paths;
    } catch (err) {
        console.error('Error fetching pinned docs status:', err);
        // Fall back to localStorage
        try {
            const storedDocs = localStorage.getItem('pinnedDocs');
            if (storedDocs) {
                const parsedDocs = JSON.parse(storedDocs);
                const paths = parsedDocs.map((doc: any) => doc.path || doc.id);
                setPinnedDocs(paths);
                return paths;
            }
        } catch (storageErr) {
            console.error('Error reading from localStorage:', storageErr);
        }
        return [];
    } finally {
        setLoadingPinnedStatus(false);
    }
  }, []);

  const checkPinnedStatus = useCallback(async (docPath: string) => {
    try {
        setLoadingPinnedStatus(true);
        // First check if we already have the pinned docs list
        let paths = pinnedDocs;
        if (paths.length === 0) {
            paths = await fetchPinnedDocs();
        }
        setIsPinned(paths.includes(docPath));
    } catch (err) {
        console.error('Error checking pinned status:', err);
        setIsPinned(false);
    } finally {
        setLoadingPinnedStatus(false);
    }
  }, [pinnedDocs, fetchPinnedDocs]);

  // Load pinned docs on mount
  useEffect(() => {
    fetchPinnedDocs();
  }, [fetchPinnedDocs]);

  useEffect(() => {
      // Listen for WebSocket document updates for the current project
      const handleDocUpdate = (message: any) => {
          // Ensure message has project_id and path
          if (!message?.project_id || !message?.path) return;
          if (message.project_id === selectedProject) {
              console.log(`Document update received via WS for project ${selectedProject}: ${message.path} (${message.event})`);
              // Refetch the list to get potential new/deleted files
              fetchDocList(selectedProject);
              // If the updated doc is the one currently being viewed/edited
              if (selectedDocPath === message.path) {
                   console.warn(`Currently viewed document ${selectedDocPath} was modified externally (${message.event}).`);
                   // More sophisticated handling needed here:
                   // - If 'deleted', clear selection and show message.
                   // - If 'modified' and in edit mode with unsaved changes, show conflict warning.
                   // - If 'modified' and in preview mode, silently reload or show notification.
                   if (message.event === 'deleted') {
                        setError(`Document '${message.path.split('/').pop()}' was deleted externally.`);
                        setSelectedDocPath(null); // Clear selection
                        setSelectedDoc(null);
                   } else if (editMode && selectedDoc && markdownContent !== selectedDoc.content) {
                         setError(`Conflict: Document '${message.path.split('/').pop()}' was modified externally while you were editing. Please save your changes elsewhere and reload.`);
                         // Disable saving? Or force reload? For now, just show error.
                   } else {
                         // Silently reload content if in preview mode or no local changes
                         setError(`Note: Document '${message.path.split('/').pop()}' was updated externally. Reloaded.`);
                         fetchDocContent(selectedDocPath);
                   }
              }
          }
      };

      // Listen for pinned documents updates
      const handleMetaUpdate = (message: any) => {
          console.log(`Meta update received via WS: ${message.action}`);
          // Refresh pinned status if this is relevant to pinnning/unpinning docs
          if (message.action === 'pin_added' || message.action === 'pin_removed' || message.action === 'pins_reordered') {
              if (selectedDocPath) {
                  checkPinnedStatus(selectedDocPath);
              }
          }
      };

      const docUpdateUnsubscribe = eventBus.on('document_updated', handleDocUpdate);
      const metaUpdateUnsubscribe = eventBus.on('meta_updated', handleMetaUpdate);
      
      return () => {
          docUpdateUnsubscribe();
          metaUpdateUnsubscribe();
      }; // Cleanup listeners
  }, [selectedProject, selectedDocPath, editMode, markdownContent, selectedDoc, fetchDocList, fetchDocContent, checkPinnedStatus]); 

  // --- Style Injection Effect ---
  useEffect(() => {
    // Inject basic prose styles if Tailwind typography plugin isn't used
    const styleId = 'markdown-prose-styles';
    if (!document.getElementById(styleId)) {
        const style = document.createElement('style');
        style.id = styleId;
        style.textContent = `
        .prose h1 { font-size: 1.6em; margin-bottom: 0.6em; padding-bottom: 0.2em; border-bottom: 1px solid #e5e7eb; }
        .prose h2 { font-size: 1.4em; margin-bottom: 0.5em; padding-bottom: 0.2em; border-bottom: 1px solid #e5e7eb; }
        .dark .prose h1, .dark .prose h2 { border-bottom-color: #374151; }
        .prose h3 { font-size: 1.2em; margin-bottom: 0.4em; }
        .prose p { margin-bottom: 1em; line-height: 1.65; }
        .prose ul, .prose ol { margin-left: 1.8em; margin-bottom: 1em; }
        .prose li { margin-bottom: 0.4em; }
        .prose li > p { margin-bottom: 0.4em; } /* Reduce paragraph margin inside lists */
        .prose strong { font-weight: 600; }
        .prose em { font-style: italic; }
        .prose blockquote { border-left: 4px solid #d1d5db; padding-left: 1em; margin-left: 0; margin-bottom: 1em; color: #4b5563; font-style: italic; }
        .dark .prose blockquote { border-left-color: #4b5563; color: #9ca3af; }
        .prose hr { border-top: 1px solid #e5e7eb; margin: 2em 0; }
        .dark .prose hr { border-top-color: #374151; }
        .prose a { color: #2563eb; text-decoration: none; }
        .prose a:hover { text-decoration: underline; }
        .dark .prose a { color: #60a5fa; }
        .prose code:not(pre>code) { background-color: rgba(229, 231, 235, 0.7); dark:bg-gray-700 px-1.5 py-0.5 rounded text-sm; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace; }
        .prose pre { background-color: #1f2937; color: #d1d5db; padding: 1em; border-radius: 8px; overflow-x: auto; margin-bottom: 1.2em; font-size: 0.9em;}
        .prose pre code { background-color: transparent; padding: 0; border-radius: 0; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace; }
        .dark .prose code:not(pre>code) { background-color: rgba(55, 65, 81, 0.9); color: #e5e7eb; }
        .dark .prose pre { background-color: #374155; color: #d1d5db; }
        .prose table { width: auto; border-collapse: collapse; margin-bottom: 1em; }
        .prose th, .prose td { border: 1px solid #d1d5db; padding: 0.5em 0.8em; }
        .dark .prose th, .dark .prose td { border-color: #4b5563; }
        .prose thead th { background-color: #f3f4f6; font-weight: 600; }
        .dark .prose thead th { background-color: #374151; }
        
        /* Enhanced markdown editor */
        .markdown-editor {
          font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
          font-size: 14px;
          line-height: 1.5;
          tab-size: 2;
          resize: none;
          outline: none;
          padding: 1rem;
          height: 100%;
          width: 100%;
          box-sizing: border-box;
        }
        
        .editor-container {
          display: flex;
          flex-direction: column;
          height: 100%;
          overflow: hidden;
        }
        
        .editor-panes {
          display: flex;
          flex: 1;
          overflow: hidden;
        }
        
        .editor-pane {
          flex: 1;
          overflow-y: auto;
          border: 1px solid #e5e7eb;
          border-radius: 0.375rem;
        }
        
        .editor-pane.preview {
          border-left: none;
          border-top-left-radius: 0;
          border-bottom-left-radius: 0;
        }
        
        .dark .editor-pane {
          border-color: #374151;
        }
        
        .line-numbers {
          padding: 1rem 0.5rem;
          text-align: right;
          color: #9ca3af;
          user-select: none;
          font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
          font-size: 14px;
          line-height: 1.5;
          border-right: 1px solid #e5e7eb;
          background-color: #f9fafb;
        }
        
        .dark .line-numbers {
          border-color: #374151;
          background-color: #1f2937;
          color: #6b7280;
        }
        `;
        document.head.append(style);
    }
    // Optional cleanup function if needed
    // return () => { document.getElementById(styleId)?.remove(); };
  }, []); // Run once on mount

  // --- Event Handlers ---
  const handleDocSelect = (doc: DocMetadata) => {
    if (isSaving) {
        alert("Please wait for the current save operation to complete.");
        return;
    }
    if (editMode && selectedDoc && markdownContent !== selectedDoc.content) {
        if (!window.confirm("You have unsaved changes. Discard them and switch document?")) {
            return;
        }
    }
    setSelectedDocPath(doc.path); // This will trigger fetchDocContent effect
  };

  const handleProjectChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    // Check for unsaved changes before switching project
    if (editMode && selectedDoc && markdownContent !== selectedDoc.content) {
        if (!window.confirm("You have unsaved changes. Discard them and switch project?")) {
            e.target.value = selectedProject || ''; // Reset dropdown if user cancels
            return;
        }
    }
    setSelectedProject(e.target.value || null);
  };

  const handleEditToggle = () => {
    if (!selectedDoc) return;
    if (editMode && markdownContent !== selectedDoc.content) {
        if (!window.confirm("Discard unsaved changes?")) {
            return;
        }
    }
    setEditMode(!editMode);
    // Reset edit buffer to original content when switching back to preview
    if (!editMode) {
        setMarkdownContent(selectedDoc?.content || '');
        setError(null); // Clear potential conflict errors when switching back
    }
  };

  const handleSave = async () => {
    if (!selectedDoc || !selectedDocPath || isSaving) return;
    setIsSaving(true);
    setError(null); // Clear previous errors
    try {
      // Since there's no direct API endpoint for saving documents, we'll use localStorage
      console.log(`Saving document: ${selectedDocPath}`);
      console.log('New content:', markdownContent);
      
      // Save to localStorage
      const localStorageKey = `document:${selectedDocPath}`;
      localStorage.setItem(localStorageKey, markdownContent);
      
      // Simulate API delay to represent network latency if this was a real API
      await new Promise(resolve => setTimeout(resolve, 600));
      
      // Update local state immediately
      setSelectedDoc({ ...selectedDoc, content: markdownContent });
      setEditMode(false); // Switch back to preview after successful save
      
      // Show a success message
      setError('Document saved successfully!'); // Using error state for success message too
      setTimeout(() => setError(null), 3000); // Clear the message after 3 seconds
    } catch (err) {
      console.error('Error saving document:', err);
      setError(`Failed to save document: ${selectedDoc.title}. Please try again.`);
      // Keep edit mode open and content as is on error
    } finally {
      setIsSaving(false);
    }
  };

  const handleCreateDocument = () => {
     // TODO: Implement document creation modal/form
    console.log('Create document clicked - Placeholder');
  };
  
  const handleTogglePin = async () => {
    if (!selectedDocPath || loadingPinnedStatus) return;
    
    try {
      if (isPinned) {
        // Unpin the document
        console.log('Unpinning document:', selectedDocPath);
        setIsPinned(false); // Optimistic update
        
        try {
          const response = await axios.delete(`http://localhost:8000/meta/pinned_docs/${encodeURIComponent(selectedDocPath)}`);
          console.log('Document unpinned successfully:', response.data);
        } catch (apiError) {
          console.error('API error when unpinning document:', apiError);
          // Even if the API fails, continue with the local update
          console.log('Proceeding with local unpinning only');
        }
        
        // Update local state and localStorage regardless of API success
        const updatedPaths = pinnedDocs.filter(path => path !== selectedDocPath);
        setPinnedDocs(updatedPaths);
        
        // Update localStorage for resilience
        try {
          const storedDocs = localStorage.getItem('pinnedDocs');
          if (storedDocs) {
            const parsedDocs = JSON.parse(storedDocs);
            const updatedDocs = parsedDocs.filter((doc: any) => doc.path !== selectedDocPath && doc.id !== selectedDocPath);
            localStorage.setItem('pinnedDocs', JSON.stringify(updatedDocs));
          }
        } catch (storageErr) {
          console.error('Error updating localStorage:', storageErr);
        }
        
        // Show success message
        setError('Document unpinned successfully!');
        setTimeout(() => setError(null), 3000);
      } else {
        // Pin the document
        console.log('Pinning document:', selectedDocPath);
        setIsPinned(true); // Optimistic update
        
        let apiSuccess = false;
        try {
          const response = await axios.post(`http://localhost:8000/meta/pinned_docs/${encodeURIComponent(selectedDocPath)}`);
          console.log('Document pinned successfully via API:', response.data);
          apiSuccess = true;
        } catch (apiError) {
          console.error('API error when pinning document:', apiError);
          // Continue with local pinning if API fails
          console.log('Proceeding with local pinning only');
        }
        
        // Update local state
        const updatedPaths = [...pinnedDocs, selectedDocPath];
        setPinnedDocs(updatedPaths);
        
        // Update localStorage for resilience
        try {
          const storedDocs = localStorage.getItem('pinnedDocs');
          let updatedDocs = [];
          
          if (storedDocs) {
            const parsedDocs = JSON.parse(storedDocs);
            // Check if already pinned in localStorage
            if (!parsedDocs.some((doc: any) => doc.path === selectedDocPath || doc.id === selectedDocPath)) {
              // Add to localStorage
              const newDoc = {
                id: selectedDocPath,
                title: selectedDoc?.title || selectedDocPath.split('/').pop()?.replace('.md', '') || 'Document',
                path: selectedDocPath,
                lastModified: new Date().toISOString()
              };
              updatedDocs = [...parsedDocs, newDoc];
            } else {
              updatedDocs = parsedDocs; // Already exists
            }
          } else {
            // No existing pinned docs, create new entry
            const newDoc = {
              id: selectedDocPath,
              title: selectedDoc?.title || selectedDocPath.split('/').pop()?.replace('.md', '') || 'Document',
              path: selectedDocPath,
              lastModified: new Date().toISOString()
            };
            updatedDocs = [newDoc];
          }
          
          localStorage.setItem('pinnedDocs', JSON.stringify(updatedDocs));
        } catch (storageErr) {
          console.error('Error updating localStorage:', storageErr);
        }
        
        // Show success message
        setError(`Document ${apiSuccess ? 'pinned to dashboard' : 'pinned locally (API unavailable)'}!`);
        setTimeout(() => setError(null), 3000);
      }
    } catch (err) {
      console.error('Error toggling pin status:', err);
      setIsPinned(!isPinned); // Revert optimistic update
      setPinnedDocs([]); // Reset so we re-fetch next time
      setError(`Failed to ${isPinned ? 'unpin' : 'pin'} document. Please try again.`);
    }
  };

  const handleMarkdownChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setMarkdownContent(e.target.value);
  };

  const handleToolbarAction = (action: string, value?: string) => {
    if (!editorRef.current) return;

    const editor = editorRef.current;
    const { selectionStart, selectionEnd } = editor;
    const selectedText = markdownContent.substring(selectionStart, selectionEnd);
    let result = markdownContent;
    
    switch (action) {
      case 'heading':
        if (selectionStart === selectionEnd) {
          // Insert at cursor position
          result = markdownContent.substring(0, selectionStart) + value + 'Heading' + 
            markdownContent.substring(selectionEnd);
          editor.focus();
          setTimeout(() => {
            editor.selectionStart = selectionStart + (value?.length || 0);
            editor.selectionEnd = selectionStart + (value?.length || 0) + 7; // "Heading" length
          }, 0);
        } else {
          // Apply to selection
          result = markdownContent.substring(0, selectionStart) + value + selectedText + 
            markdownContent.substring(selectionEnd);
          editor.focus();
          setTimeout(() => {
            editor.selectionStart = selectionStart + (value?.length || 0);
            editor.selectionEnd = selectionStart + (value?.length || 0) + selectedText.length;
          }, 0);
        }
        break;
      
      case 'bold':
        result = markdownContent.substring(0, selectionStart) + `**${selectedText || 'bold text'}**` + 
          markdownContent.substring(selectionEnd);
        editor.focus();
        setTimeout(() => {
          if (selectedText) {
            editor.selectionStart = selectionStart + 2;
            editor.selectionEnd = selectionStart + 2 + selectedText.length;
          } else {
            editor.selectionStart = selectionStart + 2;
            editor.selectionEnd = selectionStart + 11; // "bold text" length + 2
          }
        }, 0);
        break;
      
      case 'italic':
        result = markdownContent.substring(0, selectionStart) + `*${selectedText || 'italic text'}*` + 
          markdownContent.substring(selectionEnd);
        editor.focus();
        setTimeout(() => {
          if (selectedText) {
            editor.selectionStart = selectionStart + 1;
            editor.selectionEnd = selectionStart + 1 + selectedText.length;
          } else {
            editor.selectionStart = selectionStart + 1;
            editor.selectionEnd = selectionStart + 12; // "italic text" length + 1
          }
        }, 0);
        break;
      
      case 'bulletList':
        if (selectedText) {
          // Convert each line to a bullet item
          const lines = selectedText.split('\n');
          const bulletList = lines.map(line => `- ${line}`).join('\n');
          result = markdownContent.substring(0, selectionStart) + bulletList + 
            markdownContent.substring(selectionEnd);
        } else {
          result = markdownContent.substring(0, selectionStart) + '- List item\n- Another item' + 
            markdownContent.substring(selectionEnd);
        }
        editor.focus();
        break;
      
      case 'orderedList':
        if (selectedText) {
          // Convert each line to a numbered item
          const lines = selectedText.split('\n');
          const orderedList = lines.map((line, index) => `${index + 1}. ${line}`).join('\n');
          result = markdownContent.substring(0, selectionStart) + orderedList + 
            markdownContent.substring(selectionEnd);
        } else {
          result = markdownContent.substring(0, selectionStart) + '1. List item\n2. Another item' + 
            markdownContent.substring(selectionEnd);
        }
        editor.focus();
        break;
      
      case 'inlineCode':
        result = markdownContent.substring(0, selectionStart) + '`' + (selectedText || 'code') + '`' + 
          markdownContent.substring(selectionEnd);
        editor.focus();
        setTimeout(() => {
          if (selectedText) {
            editor.selectionStart = selectionStart + 1;
            editor.selectionEnd = selectionStart + 1 + selectedText.length;
          } else {
            editor.selectionStart = selectionStart + 1;
            editor.selectionEnd = selectionStart + 5; // "code" length + 1
          }
        }, 0);
        break;
      
      case 'codeBlock':
        const codeBlockText = selectedText || 'function example() {\n  console.log("Hello world");\n}';
        result = markdownContent.substring(0, selectionStart) + '```\n' + codeBlockText + '\n```' + 
          markdownContent.substring(selectionEnd);
        editor.focus();
        setTimeout(() => {
          if (selectedText) {
            editor.selectionStart = selectionStart + 4;
            editor.selectionEnd = selectionStart + 4 + selectedText.length;
          } else {
            editor.selectionStart = selectionStart + 4;
            editor.selectionEnd = selectionStart + 4 + codeBlockText.length;
          }
        }, 0);
        break;
      
      case 'link':
      case 'image':
        if (value) {
          result = markdownContent.substring(0, selectionStart) + value + 
            markdownContent.substring(selectionEnd);
          editor.focus();
        }
        break;
      
      default:
        return;
    }
    
    setMarkdownContent(result);
  };

  // Count lines for the line numbers display
  const lineCount = useMemo(() => {
    return markdownContent.split('\n').length;
  }, [markdownContent]);
  
  // Generate line numbers array
  const lineNumbers = useMemo(() => {
    return Array.from({ length: lineCount }, (_, i) => i + 1);
  }, [lineCount]);

  // Memoize Markdown components for syntax highlighting performance
  const markdownComponents = useMemo(() => ({
      code({ node, inline, className, children, ...props }: any) {
          const match = /language-(\w+)/.exec(className || '');
          return !inline && match ? (
            <SyntaxHighlighter
                style={vs2015}
                language={match[1]}
                PreTag="div"
                {...props}
            >
                {String(children).replace(/\n$/, '')}
            </SyntaxHighlighter>
          ) : (
            // Inline code style
            <code className={`inline-code bg-gray-100 dark:bg-gray-700 px-1.5 py-0.5 rounded text-sm font-mono ${className || ''}`} {...props}>
                {children}
            </code>
          );
      },
      // Add other custom renderers here if needed (e.g., custom links, images)
  }), []); // Empty dependency array - components don't change based on state

  // --- Render Logic ---
  return (
    <div className="documents-container flex flex-col h-full p-4 md:p-6 lg:p-8 w-full overflow-hidden">
      {/* Header */}
      <div className="header flex flex-col sm:flex-row justify-between items-start sm:items-center mb-6 gap-4 flex-shrink-0">
         <div className="flex items-center gap-4 flex-wrap">
            <h1 className="text-2xl font-bold text-gray-800 dark:text-gray-100">Documents</h1>
            <select
                className="project-select p-2 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
                value={selectedProject || ''}
                onChange={handleProjectChange}
                disabled={loadingProjects || projects.length === 0}
                aria-label="Select Project"
            >
               {loadingProjects ? ( <option value="">Loading projects...</option> )
               : projects.length > 0 ? (
                <>
                    <option value="">Select project...</option>
                    {projects.map((project) => ( <option key={project.id} value={project.id}> {project.title} </option> ))}
                </>
               ) : ( <option value="">No projects available</option> )}
            </select>
        </div>

        <button
          className="quick-action-button bg-blue-500 hover:bg-blue-600 text-white px-4 py-2 rounded shadow flex items-center gap-2 transition duration-150 ease-in-out text-sm disabled:opacity-50 disabled:cursor-not-allowed"
          onClick={handleCreateDocument}
          disabled={!selectedProject}
          title={!selectedProject ? "Select a project first" : "Create a new document"}
        >
           <svg xmlns="http://www.w3.org/2000/svg" className="h-12 w-12" viewBox="0 0 20 20" fill="currentColor" style={{width: '56px', height: '56px'}}>
            <path fillRule="evenodd" d="M6 2a2 2 0 00-2 2v12a2 2 0 002 2h8a2 2 0 002-2V7.414A2 2 0 0015.414 6L12 2.586A2 2 0 0010.586 2H6zm5 6a1 1 0 10-2 0v2H7a1 1 0 100 2h2v2a1 1 0 102 0v-2h2a1 1 0 100-2h-2V8z" clipRule="evenodd" />
           </svg>
          <span>New Document</span>
        </button>
      </div>

      {/* Error Display Area */}
      {error && (
          <div className={`error-state text-center p-3 rounded border mb-4 text-sm flex-shrink-0 ${
            error.toLowerCase().includes('success') 
              ? 'text-green-600 dark:text-green-400 bg-green-100 dark:bg-green-900/50 border-green-300 dark:border-green-700'
              : 'text-red-600 dark:text-red-400 bg-red-100 dark:bg-red-900/50 border-red-300 dark:border-red-700'
          }`}>
            {error}
          </div>
      )}

      {/* Main Content Layout */}
      <div className="documents-layout flex flex-1 gap-6 overflow-hidden">
          {/* Sidebar (Doc List) */}
          <div className="documents-sidebar w-1/4 lg:w-1/5 flex-shrink-0 border-r border-gray-200 dark:border-gray-700 pr-4 flex flex-col">
              <div className="flex items-center gap-2 mb-3 flex-shrink-0 sticky top-0 bg-gray-50 dark:bg-gray-900 py-2 z-10 border-b border-gray-200 dark:border-gray-700">
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-12 w-12 text-blue-500 dark:text-blue-400" viewBox="0 0 20 20" fill="currentColor" style={{width: '56px', height: '56px'}}>
                      <path d="M2 6a2 2 0 012-2h5l2 2h5a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" />
                  </svg>
                  <h2 className="text-base font-semibold text-gray-700 dark:text-gray-200">
                      Project Docs {selectedProject ? `(${projects.find(p=>p.id === selectedProject)?.title || selectedProject})` : ''}
                  </h2>
              </div>

              <div className="flex-1 overflow-y-auto">
                  {loadingList ? ( <div className="text-gray-500 dark:text-gray-400 text-sm p-4 text-center">Loading...</div> )
                  : !selectedProject ? ( <div className="text-gray-500 dark:text-gray-400 text-sm p-4 text-center">Select a project</div> )
                  : docList.length > 0 ? (
                      <div className="documents-list space-y-1">
                          {docList.map((doc) => (
                              <div
                                  key={doc.id}
                                  className={`document-item p-2 rounded cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors duration-100 ${selectedDocPath === doc.path ? 'bg-blue-100 dark:bg-blue-900/50' : ''}`}
                                  onClick={() => handleDocSelect(doc)}
                                  role="button" tabIndex={0}
                                  onKeyDown={(e) => e.key === 'Enter' && handleDocSelect(doc)}
                                  title={doc.path}
                              >
                                  <div className="flex items-center gap-2">
                                      <svg xmlns="http://www.w3.org/2000/svg" className="h-10 w-10 text-blue-500 dark:text-blue-400" viewBox="0 0 20 20" fill="currentColor" style={{width: '48px', height: '48px'}}>
                                          <path fillRule="evenodd" d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4zm2 6a1 1 0 011-1h6a1 1 0 110 2H7a1 1 0 01-1-1zm1 3a1 1 0 100 2h6a1 1 0 100-2H7z" clipRule="evenodd" />
                                      </svg>
                                      <h3 className={`document-title text-sm truncate ${selectedDocPath === doc.path ? 'font-semibold text-blue-800 dark:text-blue-200' : 'text-gray-800 dark:text-gray-100'}`}>
                                          {doc.title}
                                      </h3>
                                  </div>
                                  <div className="text-xs text-gray-500 dark:text-gray-400 mt-2 pl-12">Markdown</div>
                              </div>
                          ))}
                      </div>
                  ) : (
                      <div className="empty-state text-sm text-gray-500 dark:text-gray-400 p-4 border border-dashed border-gray-300 dark:border-gray-600 rounded mt-2 text-center">
                          No documents found in this project.
                      </div>
                  )}
              </div>
          </div>

          {/* Content Area (Editor/Viewer) */}
          <div className="document-content flex-1 flex flex-col overflow-hidden">
              {!selectedProject ? ( <div className="flex-1 flex items-center justify-center text-gray-500 dark:text-gray-400">Select a project to see documents</div> )
              : !selectedDocPath ? (
                  <div className="empty-state flex-1 flex items-center justify-center text-center text-gray-500 dark:text-gray-400 p-8 border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-lg">
                      <p>Select a document from the list to view or edit</p>
                  </div>
              ) : loadingContent ? (
                  <div className="flex-1 flex items-center justify-center text-gray-500 dark:text-gray-400">Loading document...</div>
              ) : selectedDoc ? (
                  <>
                      {/* Document Header */}
                      <div className="document-header flex flex-col sm:flex-row justify-between items-start sm:items-center mb-4 pb-2 border-b border-gray-200 dark:border-gray-700 flex-shrink-0">
                          <div className="flex items-center gap-3">
                              <div className="document-icon bg-blue-100 dark:bg-blue-900/50 p-2 rounded-lg">
                                  <svg xmlns="http://www.w3.org/2000/svg" className="h-12 w-12 text-blue-600 dark:text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} style={{width: '60px', height: '60px'}}>
                                      <path strokeLinecap="round" strokeLinejoin="round" d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                                  </svg>
                              </div>
                              <div>
                                  <h2 className="text-xl font-semibold text-gray-800 dark:text-gray-100 truncate mb-1" title={selectedDoc.path}>
                                      {selectedDoc.title}
                                  </h2>
                                  <p className="text-xs text-gray-500 dark:text-gray-400">
                                      Markdown (.md) • {selectedDoc.path.split('/').pop()}
                                  </p>
                              </div>
                          </div>

                          <div className="document-actions flex gap-2">
                              <button
                                  className="action-button text-sm px-3 py-1 border border-gray-300 dark:border-gray-600 rounded hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-50"
                                  onClick={handleEditToggle}
                                  disabled={isSaving}
                                  title={editMode ? "Switch to Preview Mode" : "Switch to Edit Mode"}
                              >
                                  {editMode ? 'Preview' : 'Edit'}
                              </button>
                              {editMode && (
                                  <button
                                      className="action-button save-button text-sm px-3 py-1 bg-blue-500 hover:bg-blue-600 text-white rounded disabled:opacity-50 disabled:cursor-not-allowed"
                                      onClick={handleSave}
                                      disabled={isSaving || markdownContent === selectedDoc.content}
                                      title={isSaving ? "Saving..." : (markdownContent === selectedDoc.content ? "No changes to save" : "Save changes")}
                                  >
                                      {isSaving ? 'Saving...' : 'Save'}
                                  </button>
                              )}
                              <button
                                  className="action-button pin-button text-sm px-3 py-1 border border-gray-300 dark:border-gray-600 rounded hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center gap-1"
                                  onClick={handleTogglePin}
                                  disabled={isSaving || !selectedDocPath}
                                  title="Pin/Unpin document to Dashboard"
                              >
                                  <span className="text-yellow-500">{isPinned ? '★' : '☆'}</span>
                                  <span>{isPinned ? 'Unpin' : 'Pin'}</span>
                              </button>
                          </div>
                      </div>

                      {/* Editor Area */}
                      {editMode ? (
                        <div className="editor-container flex-1 overflow-hidden">
                          {/* Markdown Toolbar */}
                          <MarkdownToolbar onAction={handleToolbarAction} />
                          
                          {/* Split View: Editor + Preview */}
                          <div className="editor-panes">
                            {/* Editor Pane */}
                            <div className="editor-pane flex">
                              {/* Line Numbers (Optional) */}
                              <div className="line-numbers">
                                {lineNumbers.map(num => (
                                  <div key={num}>{num}</div>
                                ))}
                              </div>
                              
                              {/* Actual Editor */}
                              <textarea
                                ref={editorRef}
                                value={markdownContent}
                                onChange={handleMarkdownChange}
                                className="markdown-editor flex-1 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
                                disabled={isSaving}
                                placeholder="Start writing markdown..."
                                spellCheck="true"
                              />
                            </div>
                            
                            {/* Preview Pane */}
                            <div className="editor-pane preview">
                              <div className="markdown-view prose dark:prose-invert prose-sm max-w-none p-4 overflow-y-auto">
                                <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                                  {markdownContent || '*Document is empty*'}
                                </ReactMarkdown>
                              </div>
                            </div>
                          </div>
                        </div>
                      ) : (
                        // Preview-only mode
                        <div className="markdown-view flex-1 overflow-y-auto p-3 prose dark:prose-invert prose-sm max-w-none">
                          <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                            {selectedDoc.content || '*Document is empty*'}
                          </ReactMarkdown>
                        </div>
                      )}
                  </>
              ) : ( // selectedDoc is null after loading attempt (error case)
                   <div className="flex-1 flex items-center justify-center text-red-500 dark:text-red-400">
                     Document not found or failed to load.
                  </div>
              )}
          </div>
      </div>
    </div>
  );
};

export default Documents;