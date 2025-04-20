import React, { useState, useEffect, useMemo, useCallback } from 'react';
import axios from 'axios';
import ReactMarkdown from 'react-markdown';
// Import syntax highlighter
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
// Import the specific style using the correct path and named export
import { vs2015 } from 'react-syntax-highlighter/dist/styles'; // Corrected path
import remarkGfm from 'remark-gfm';
import { useLocation } from 'react-router-dom';
import { eventBus } from '../App'; // Import shared event bus

// Markdown Editor comment - you'll need to install this package:
// npm install --save @uiw/react-md-editor
// Uncomment the following line after installation:
// import MDEditor from '@uiw/react-md-editor';

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

// --- Component ---
const Documents: React.FC = () => {
  // --- State ---
  const location = useLocation();
  const passedProjectId = location.state?.projectId;

  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProject, setSelectedProject] = useState<string | null>(passedProjectId || null);
  const [docList, setDocList] = useState<DocMetadata[]>([]);
  const [selectedDocPath, setSelectedDocPath] = useState<string | null>(null);
  const [selectedDoc, setSelectedDoc] = useState<Document | null>(null);
  const [editMode, setEditMode] = useState(false);
  const [editContent, setEditContent] = useState('');
  const [loadingProjects, setLoadingProjects] = useState(true);
  const [loadingList, setLoadingList] = useState(false);
  const [loadingContent, setLoadingContent] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);


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
           // Since there's no direct API endpoint for document content, let's mock it
           console.log(`Fetching content for document: ${docPath}`);
           
           // Find matching metadata from the list (mostly for title)
           const docMetadata = docList.find(d => d.path === docPath);
           const title = docMetadata?.title || docPath.split('/').pop()?.replace('.md', '') || 'Document';
           
           // Mock document content based on path
           let mockContent = '';
           if (docPath.endsWith('readme.md')) {
               mockContent = `# ${title}\n\nThis is a README file for the project. Edit me to add project information.\n\n## Getting Started\n\n1. Create new tasks in the Tasks section\n2. Add project documentation here\n3. Track your progress\n`;
           } else if (docPath.endsWith('notes.md')) {
               mockContent = `# Project Notes\n\nUse this document to keep track of important project notes and decisions.\n\n## Meeting Notes\n\n- Initial project discussion (YYYY-MM-DD)\n- Follow-up meeting (YYYY-MM-DD)\n\n## Decisions\n\n- Decision 1: Description of the decision\n- Decision 2: Description of the decision\n`;
           } else {
               mockContent = `# ${title}\n\nThis is a new document. Edit me to add content.`;
           }
           
           // Simulate API delay
           await new Promise(resolve => setTimeout(resolve, 400));
           
           setSelectedDoc({
               id: docPath, // path is the ID
               title: title,
               path: docPath,
               project_id: selectedProject || 'unknown', // Should have selectedProject
               content: mockContent,
           });
           setEditContent(mockContent); // Sync edit buffer
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
  }, [selectedDocPath, fetchDocContent]);

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
                   } else if (editMode && selectedDoc && editContent !== selectedDoc.content) {
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
      const unsubscribe = eventBus.on('document_updated', handleDocUpdate);
      return () => unsubscribe(); // Cleanup listener
  }, [selectedProject, selectedDocPath, editMode, editContent, selectedDoc, fetchDocList, fetchDocContent]); // Dependencies needed for conflict check


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
    if (editMode && selectedDoc && editContent !== selectedDoc.content) {
        if (!window.confirm("You have unsaved changes. Discard them and switch document?")) {
            return;
        }
    }
    setSelectedDocPath(doc.path); // This will trigger fetchDocContent effect
  };

  const handleProjectChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    // Check for unsaved changes before switching project
    if (editMode && selectedDoc && editContent !== selectedDoc.content) {
        if (!window.confirm("You have unsaved changes. Discard them and switch project?")) {
            e.target.value = selectedProject || ''; // Reset dropdown if user cancels
            return;
        }
    }
    setSelectedProject(e.target.value || null);
  };

  const handleEditToggle = () => {
    if (!selectedDoc) return;
    if (editMode && editContent !== selectedDoc.content) {
        if (!window.confirm("Discard unsaved changes?")) {
            return;
        }
    }
    setEditMode(!editMode);
    // Reset edit buffer to original content when switching back to preview
    if (!editMode) {
        setEditContent(selectedDoc?.content || '');
        setError(null); // Clear potential conflict errors when switching back
    }
  };

  const handleContentChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setEditContent(e.target.value);
  };

  const handleSave = async () => {
    if (!selectedDoc || !selectedDocPath || isSaving) return;
    setIsSaving(true);
    setError(null); // Clear previous errors
    try {
      // Since there's no direct API endpoint for saving documents, we'll mock it
      console.log(`Saving document: ${selectedDocPath}`);
      console.log('New content:', editContent);
      
      // Simulate API delay
      await new Promise(resolve => setTimeout(resolve, 600));
      
      // Update local state immediately
      setSelectedDoc({ ...selectedDoc, content: editContent });
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

  // Memoize Markdown components for syntax highlighting performance
  const markdownComponents = useMemo(() => ({
      code({ node, inline, className, children, ...props }: any) {
          const match = /language-(\w+)/.exec(className || '');
          return !inline && match ? (
          <SyntaxHighlighter
              style={vs2015} // *** Use the imported style here ***
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
           <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z" clipRule="evenodd" /></svg>
          <span>New Document</span>
        </button>
      </div>

      {/* Error Display Area */}
      {error && (
          <div className="error-state text-center text-red-600 dark:text-red-400 bg-red-100 dark:bg-red-900/50 p-3 rounded border border-red-300 dark:border-red-700 mb-4 text-sm flex-shrink-0">{error}</div>
      )}

      {/* Main Content Layout */}
      <div className="documents-layout flex flex-1 gap-6 overflow-hidden">
          {/* Sidebar (Doc List) */}
          <div className="documents-sidebar w-1/4 lg:w-1/5 flex-shrink-0 border-r border-gray-200 dark:border-gray-700 pr-4 flex flex-col">
              <h2 className="text-base font-semibold mb-3 text-gray-700 dark:text-gray-200 flex-shrink-0 sticky top-0 bg-gray-50 dark:bg-gray-900 py-1 z-10">
                  Project Docs {selectedProject ? `(${projects.find(p=>p.id === selectedProject)?.title || selectedProject})` : ''}
              </h2>
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
                                  <h3 className={`document-title text-sm truncate ${selectedDocPath === doc.path ? 'font-semibold text-blue-800 dark:text-blue-200' : 'text-gray-800 dark:text-gray-100'}`}>{doc.title}</h3>
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
                          <h2 className="text-xl font-semibold text-gray-800 dark:text-gray-100 truncate mb-2 sm:mb-0" title={selectedDoc.path}>{selectedDoc.title}</h2>
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
                                      disabled={isSaving || editContent === selectedDoc.content}
                                      title={isSaving ? "Saving..." : (editContent === selectedDoc.content ? "No changes to save" : "Save changes")}
                                  >
                                      {isSaving ? 'Saving...' : 'Save'}
                                  </button>
                              )}
                          </div>
                      </div>

                      {/* Editor/Preview Area */}
                      <div className="editor-area flex-1 overflow-hidden">
                          {editMode ? (
                              <div className="markdown-full-editor-container flex-1 flex flex-col">
                                  {/* Note: After installing @uiw/react-md-editor, replace this with: */}
                                  {/* <MDEditor height="100%" value={editContent} onChange={setEditContent} /> */}
                                  
                                  {/* Temporary editor until you install the library */}
                                  <div className="markdown-editor-toolbar bg-gray-100 dark:bg-gray-800 p-2 border-b border-gray-300 dark:border-gray-600 flex gap-2 flex-wrap">
                                      <button className="toolbar-btn px-2 py-1 text-xs bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded" 
                                          onClick={() => setEditContent(prev => `# ${prev.length > 0 ? prev : 'Heading'}`)}>
                                          H1
                                      </button>
                                      <button className="toolbar-btn px-2 py-1 text-xs bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded"
                                          onClick={() => setEditContent(prev => `## ${prev.length > 0 ? prev : 'Heading'}`)}>
                                          H2
                                      </button>
                                      <button className="toolbar-btn px-2 py-1 text-xs bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded"
                                          onClick={() => setEditContent(prev => `### ${prev.length > 0 ? prev : 'Heading'}`)}>
                                          H3
                                      </button>
                                      <button className="toolbar-btn px-2 py-1 text-xs bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded"
                                          onClick={() => setEditContent(prev => `**${prev.length > 0 ? prev : 'Bold text'}**`)}>
                                          Bold
                                      </button>
                                      <button className="toolbar-btn px-2 py-1 text-xs bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded"
                                          onClick={() => setEditContent(prev => `*${prev.length > 0 ? prev : 'Italic text'}*`)}>
                                          Italic
                                      </button>
                                      <button className="toolbar-btn px-2 py-1 text-xs bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded"
                                          onClick={() => setEditContent(prev => `[${prev.length > 0 ? prev : 'Link text'}](url)`)}>
                                          Link
                                      </button>
                                      <button className="toolbar-btn px-2 py-1 text-xs bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded"
                                          onClick={() => {
                                              const currentText = editContent.trim();
                                              if (currentText) {
                                                  // Add a bullet list
                                                  const lines = currentText.split('\n');
                                                  setEditContent(lines.map(line => `- ${line}`).join('\n'));
                                              } else {
                                                  // Sample bullet list
                                                  setEditContent('- Item 1\n- Item 2\n- Item 3');
                                              }
                                          }}>
                                          Bullet List
                                      </button>
                                      <button className="toolbar-btn px-2 py-1 text-xs bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded"
                                          onClick={() => {
                                              const currentText = editContent.trim();
                                              if (currentText) {
                                                  // Add a numbered list
                                                  const lines = currentText.split('\n');
                                                  setEditContent(lines.map((line, i) => `${i+1}. ${line}`).join('\n'));
                                              } else {
                                                  // Sample numbered list
                                                  setEditContent('1. Item 1\n2. Item 2\n3. Item 3');
                                              }
                                          }}>
                                          Numbered List
                                      </button>
                                      <button className="toolbar-btn px-2 py-1 text-xs bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded"
                                          onClick={() => setEditContent(prev => `\`${prev.length > 0 ? prev : 'Code'}\``)}>
                                          Inline Code
                                      </button>
                                      <button className="toolbar-btn px-2 py-1 text-xs bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded"
                                          onClick={() => setEditContent(prev => `\`\`\`\n${prev.length > 0 ? prev : 'Code block'}\n\`\`\``)}>
                                          Code Block
                                      </button>
                                  </div>
                                  
                                  <textarea
                                      className="markdown-editor flex-1 w-full p-4 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 font-mono text-sm border-0 focus:outline-none resize-none overflow-y-auto"
                                      value={editContent}
                                      onChange={handleContentChange}
                                      disabled={isSaving}
                                      aria-label="Markdown Editor"
                                      placeholder="Start writing Markdown..."
                                      spellCheck="true"
                                  />
                              </div>
                          ) : (
                             <div className="markdown-view flex-1 overflow-y-auto p-3 prose dark:prose-invert prose-sm max-w-none">
                                  <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                                      {selectedDoc.content || '*Document is empty*'}
                                  </ReactMarkdown>
                             </div>
                          )}
                      </div>
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