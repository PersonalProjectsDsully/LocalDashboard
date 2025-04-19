import React, { useState, useEffect } from 'react';
import axios from 'axios';

interface Project {
  id: string;
  title: string;
  status: string;
  tags: string[];
  due?: string;
}

const Projects: React.FC = () => {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  useEffect(() => {
    const fetchProjects = async () => {
      try {
        setLoading(true);
        const response = await axios.get('http://localhost:8000/projects');
        setProjects(response.data.projects || []);
        setError(null);
      } catch (err) {
        console.error('Error fetching projects:', err);
        setError('Failed to load projects. Please try again later.');
      } finally {
        setLoading(false);
      }
    };
    
    fetchProjects();
  }, []);
  
  const getStatusColor = (status: string) => {
    switch (status.toLowerCase()) {
      case 'active':
        return 'bg-green-100 text-green-800';
      case 'planning':
        return 'bg-blue-100 text-blue-800';
      case 'on hold':
        return 'bg-yellow-100 text-yellow-800';
      case 'completed':
        return 'bg-gray-100 text-gray-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };
  
  const handleCreateProject = () => {
    // This would open a modal or navigate to create project page
    console.log('Create project clicked');
  };
  
  return (
    <div className="projects-container">
      <div className="header">
        <h1 className="text-2xl font-bold">Projects</h1>
        <button 
          className="quick-action-button"
          onClick={handleCreateProject}
        >
          <span>+</span> New Project
        </button>
      </div>
      
      {loading ? (
        <div className="loading-state">Loading projects...</div>
      ) : error ? (
        <div className="error-state">{error}</div>
      ) : (
        <div className="projects-grid">
          {projects.length > 0 ? (
            projects.map((project) => (
              <div key={project.id} className="card project-card">
                <h2 className="text-xl font-semibold">{project.title}</h2>
                <div className="project-meta">
                  <span className={`status-badge ${getStatusColor(project.status)}`}>
                    {project.status}
                  </span>
                  {project.due && (
                    <span className="due-date">Due: {project.due}</span>
                  )}
                </div>
                <div className="tags-container">
                  {project.tags.map((tag, index) => (
                    <span key={index} className="tag">{tag}</span>
                  ))}
                </div>
                <div className="project-actions">
                  <button className="action-button">Tasks</button>
                  <button className="action-button">Docs</button>
                  <button className="action-button">Edit</button>
                </div>
              </div>
            ))
          ) : (
            <div className="empty-state">
              <p>No projects found. Create your first project to get started.</p>
              <button 
                className="quick-action-button mt-4"
                onClick={handleCreateProject}
              >
                <span>+</span> Create Project
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default Projects;
