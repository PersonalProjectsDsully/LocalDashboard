import React, { useState, useEffect } from 'react';
import axios from 'axios';
import ReactMarkdown from 'react-markdown';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';
import remarkGfm from 'remark-gfm';

interface Document {
  id: string;
  title: string;
  path: string;
  content: string;
  lastModified: string;
}

const Documents: React.FC = () => {
  const [documents, setDocuments] = useState<Document[]>([]);
  const [selectedDoc, setSelectedDoc] = useState<Document | null>(null);
  const [editMode, setEditMode] = useState(false);
  const [editContent, setEditContent] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  useEffect(() => {
    // This would be replaced with actual API call when implemented
    const fetchDocuments = async () => {
      try {
        setLoading(true);
        // Mock data for now
        const mockDocs = [
          {
            id: '1',
            title: 'Project Overview',
            path: 'Project-A/docs/overview.md',
            content: '# Project Overview\n\nThis is a sample project overview document.\n\n## Goals\n\n- Goal 1\n- Goal 2\n- Goal 3\n\n```javascript\nconst hello = "world";\nconsole.log(hello);\n```',
            lastModified: '2025-04-18T14:30:00Z'
          },
          {
            id: '2',
            title: 'Meeting Notes',
            path: 'Project-B/docs/meeting-notes.md',
            content: '# Meeting Notes\n\n## April 15, 2025\n\n- Discussed project timeline\n- Assigned tasks to team members\n- Set next meeting for April 22\n\n## Action Items\n\n- [ ] Task 1\n- [x] Task 2\n- [ ] Task 3',
            lastModified: '2025-04-15T10:00:00Z'
          },
          {
            id: '3',
            title: 'Development Roadmap',
            path: 'Project-A/docs/roadmap.md',
            content: '# Development Roadmap\n\n## Phase 1 (Q2 2025)\n\n- Feature A\n- Feature B\n\n## Phase 2 (Q3 2025)\n\n- Feature C\n- Feature D\n\n## Phase 3 (Q4 2025)\n\n- Feature E\n- Feature F',
            lastModified: '2025-04-10T09:15:00Z'
          }
        ];
        
        setDocuments(mockDocs);
        setError(null);
      } catch (err) {
        console.error('Error fetching documents:', err);
        setError('Failed to load documents. Please try again later.');
      } finally {
        setLoading(false);
      }
    };
    
    fetchDocuments();
  }, []);
  
  const handleDocSelect = (doc: Document) => {
    setSelectedDoc(doc);
    setEditContent(doc.content);
    setEditMode(false);
  };
  
  const handleEditToggle = () => {
    setEditMode(!editMode);
  };
  
  const handleContentChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setEditContent(e.target.value);
  };
  
  const handleSave = async () => {
    if (!selectedDoc) return;
    
    try {
      // This would be an actual API call in the real implementation
      console.log('Saving document:', selectedDoc.id, editContent);
      
      // Update the local state
      const updatedDocs = documents.map(doc => 
        doc.id === selectedDoc.id 
          ? { ...doc, content: editContent, lastModified: new Date().toISOString() } 
          : doc
      );
      
      setDocuments(updatedDocs);
      setSelectedDoc({ ...selectedDoc, content: editContent, lastModified: new Date().toISOString() });
      setEditMode(false);
    } catch (err) {
      console.error('Error saving document:', err);
      // Show error notification
    }
  };
  
  const handleCreateDocument = () => {
    // This would open a modal or navigate to create document page
    console.log('Create document clicked');
  };
  
  return (
    <div className="documents-container">
      <div className="header">
        <h1 className="text-2xl font-bold">Documents</h1>
        <button 
          className="quick-action-button"
          onClick={handleCreateDocument}
        >
          <span>+</span> New Document
        </button>
      </div>
      
      {loading ? (
        <div className="loading-state">Loading documents...</div>
      ) : error ? (
        <div className="error-state">{error}</div>
      ) : (
        <div className="documents-layout">
          <div className="documents-sidebar">
            <div className="documents-list">
              {documents.length > 0 ? (
                documents.map((doc) => (
                  <div 
                    key={doc.id} 
                    className={`document-item ${selectedDoc?.id === doc.id ? 'active' : ''}`}
                    onClick={() => handleDocSelect(doc)}
                  >
                    <h3 className="document-title">{doc.title}</h3>
                    <p className="document-path">{doc.path}</p>
                  </div>
                ))
              ) : (
                <div className="empty-state">
                  <p>No documents found.</p>
                </div>
              )}
            </div>
          </div>
          
          <div className="document-content">
            {selectedDoc ? (
              <>
                <div className="document-header">
                  <h2 className="text-xl font-semibold">{selectedDoc.title}</h2>
                  <div className="document-actions">
                    <button 
                      className="action-button"
                      onClick={handleEditToggle}
                    >
                      {editMode ? 'Preview' : 'Edit'}
                    </button>
                    {editMode && (
                      <button 
                        className="action-button save-button"
                        onClick={handleSave}
                      >
                        Save
                      </button>
                    )}
                  </div>
                </div>
                
                {editMode ? (
                  <div className="markdown-editor">
                    <textarea
                      className="markdown-input"
                      value={editContent}
                      onChange={handleContentChange}
                    />
                    <div className="markdown-preview">
                      <ReactMarkdown
                        remarkPlugins={[remarkGfm]}
                        components={{
                          code({node, inline, className, children, ...props}) {
                            const match = /language-(\w+)/.exec(className || '');
                            return !inline && match ? (
                              <SyntaxHighlighter
                                style={vscDarkPlus}
                                language={match[1]}
                                PreTag="div"
                                {...props}
                              >
                                {String(children).replace(/\n$/, '')}
                              </SyntaxHighlighter>
                            ) : (
                              <code className={className} {...props}>
                                {children}
                              </code>
                            );
                          }
                        }}
                      >
                        {editContent}
                      </ReactMarkdown>
                    </div>
                  </div>
                ) : (
                  <div className="markdown-view">
                    <ReactMarkdown
                      remarkPlugins={[remarkGfm]}
                      components={{
                        code({node, inline, className, children, ...props}) {
                          const match = /language-(\w+)/.exec(className || '');
                          return !inline && match ? (
                            <SyntaxHighlighter
                              style={vscDarkPlus}
                              language={match[1]}
                              PreTag="div"
                              {...props}
                            >
                              {String(children).replace(/\n$/, '')}
                            </SyntaxHighlighter>
                          ) : (
                            <code className={className} {...props}>
                              {children}
                            </code>
                          );
                        }
                      }}
                    >
                      {selectedDoc.content}
                    </ReactMarkdown>
                  </div>
                )}
              </>
            ) : (
              <div className="empty-state centered">
                <p>Select a document to view or edit</p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default Documents;
