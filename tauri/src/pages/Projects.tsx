import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { useNavigate } from 'react-router-dom';
import { eventBus } from '../App'; // Import eventBus

interface Project {
  id: string;
  title: string;
  status: string;
  tags: string[];
  due?: string;
  description?: string;
  team?: { name: string; role: string }[];
}

const Projects: React.FC = () => {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  const fetchProjects = async () => {
    // Avoid setting loading if already loading
    if (!loading) setLoading(true);
    setError(null);
    try {
      const response = await axios.get('http://localhost:8000/projects');
      console.log('Projects API response:', response.data);
      // Handle both formats: direct array or {projects: array}
      const projectsData = Array.isArray(response.data) ? response.data : (response.data.projects || []);
      setProjects(projectsData);
    } catch (err) {
      console.error('Error fetching projects:', err);
      setError('Failed to load projects. Please check if the backend is running.');
      setProjects([]); // Clear projects on error
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchProjects(); // Initial fetch

    // Listen for WebSocket messages indicating project updates
    const handleProjectUpdate = (message: any) => {
       console.log('Project data potentially changed via WebSocket, refetching...', message);
       fetchProjects(); // Refetch the entire list on any project change
    };

    const unsubscribe = eventBus.on('project_updated', handleProjectUpdate);

    // Cleanup listener on component unmount
    return () => unsubscribe();

  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Empty dependency array ensures setup runs once

  const getStatusColor = (status: string = 'unknown') => {
    switch (status.toLowerCase()) {
      case 'active':
        return 'bg-green-100 text-green-800 dark:bg-green-900/50 dark:text-green-200';
      case 'planning':
        return 'bg-blue-100 text-blue-800 dark:bg-blue-900/50 dark:text-blue-200';
      case 'on hold':
        return 'bg-yellow-100 text-yellow-800 dark:bg-yellow-700/40 dark:text-yellow-100';
      case 'completed':
      case 'done':
        return 'bg-gray-200 text-gray-800 dark:bg-gray-700 dark:text-gray-300'; // Use distinct gray
      default:
        return 'bg-gray-100 text-gray-700 dark:bg-gray-600 dark:text-gray-300'; // Lighter gray for unknown
    }
  };

  const handleCreateProject = async () => {
    try {
      // Create a basic project with default values
      const newProject = {
        title: `New Project ${new Date().toLocaleTimeString()}`,
        status: "planning",
        tags: ["new"],
        description: "Add your project description here"
      };
      
      console.log('Creating new project:', newProject);
      const response = await axios.post('http://localhost:8000/projects', newProject);
      
      if (response.data) {
        console.log('Project created successfully:', response.data);
        // Fetch updated project list
        fetchProjects();
      }
    } catch (err) {
      console.error('Error creating project:', err);
      setError('Failed to create project. Please check if the backend is running.');
    }
  };

  const navigateToTasks = (projectId: string) => {
     navigate('/tasks', { state: { projectId: projectId } });
  };

  const navigateToDocs = (projectId: string) => {
     navigate('/documents', { state: { projectId: projectId } });
  };

  return (
    <div className="projects-container p-4 md:p-6 lg:p-8 w-full h-full flex flex-col">
      <div className="header flex flex-col sm:flex-row justify-between items-start sm:items-center mb-6 gap-4">
        <h1 className="text-2xl font-bold text-gray-800 dark:text-gray-100">Projects</h1>
        <button
          className="quick-action-button bg-blue-500 hover:bg-blue-600 text-white px-4 py-2 rounded shadow flex items-center gap-2 transition duration-150 ease-in-out text-sm"
          onClick={handleCreateProject}
          title="Create a new project"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z" clipRule="evenodd" />
          </svg>
          <span>New Project</span>
        </button>
      </div>

      {error && (
         <div className="error-state text-center text-red-600 dark:text-red-400 bg-red-100 dark:bg-red-900/50 p-4 rounded border border-red-300 dark:border-red-700 mb-4">{error}</div>
      )}

      {loading ? (
        <div className="loading-state flex-1 flex items-center justify-center text-gray-500 dark:text-gray-400">Loading projects...</div>
      ) : (
        <div className="projects-grid flex-1 overflow-y-auto pb-4 pr-1"> {/* Allow vertical scroll */}
             {projects.length > 0 ? (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 md:gap-6">
                    {projects.map((project) => (
                    <div key={project.id} className="card project-card bg-white dark:bg-gray-800 shadow-md rounded-lg p-4 flex flex-col justify-between border border-gray-200 dark:border-gray-700 hover:shadow-lg transition-shadow duration-200">
                        <div>
                            <div className="flex justify-between items-start mb-2">
                                <h2 className="text-lg font-semibold text-gray-900 dark:text-white truncate" title={project.title}>{project.title}</h2>
                                <span className={`status-badge text-xs font-medium px-2.5 py-0.5 rounded-full whitespace-nowrap ${getStatusColor(project.status)}`}>
                                    {project.status || 'Unknown'}
                                </span>
                            </div>
                            {project.description && (
                                <p className="text-sm text-gray-600 dark:text-gray-400 mb-3 line-clamp-3" title={project.description}> {/* Increased line clamp */}
                                    {project.description}
                                </p>
                            )}
                            <div className="project-meta text-xs text-gray-500 dark:text-gray-400 mb-3">
                                {project.due && (
                                <span className="due-date block">Due: {project.due}</span>
                                )}
                            </div>
                            <div className="tags-container flex flex-wrap gap-1 mb-4">
                                {project.tags?.map((tag, index) => (
                                <span key={index} className="tag text-xs bg-gray-200 dark:bg-gray-600 text-gray-700 dark:text-gray-200 px-2 py-0.5 rounded">{tag}</span>
                                ))}
                            </div>
                        </div>
                        <div className="project-actions mt-auto flex justify-end gap-3 pt-3 border-t border-gray-200 dark:border-gray-700">
                        <button className="action-button text-sm text-blue-600 dark:text-blue-400 hover:underline" onClick={() => navigateToTasks(project.id)} title="View Tasks">Tasks</button>
                        <button className="action-button text-sm text-blue-600 dark:text-blue-400 hover:underline" onClick={() => navigateToDocs(project.id)} title="View Documents">Docs</button>
                        {/* Add Edit button functionality later */}
                        {/* <button className="action-button text-sm text-gray-600 dark:text-gray-400 hover:underline">Edit</button> */}
                        </div>
                    </div>
                    ))}
                </div>
             ) : (
                <div className="empty-state col-span-full text-center text-gray-500 dark:text-gray-400 p-8 border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-lg mt-4">
                <p className="mb-4">No projects found. Create your first project to get started.</p>
                <button
                    className="quick-action-button bg-blue-500 hover:bg-blue-600 text-white px-4 py-2 rounded shadow flex items-center gap-2 transition duration-150 ease-in-out mx-auto text-sm"
                    onClick={handleCreateProject}
                >
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                        <path fillRule="evenodd" d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z" clipRule="evenodd" />
                    </svg>
                    <span>Create Project</span>
                </button>
                </div>
            )}
        </div>
      )}
    </div>
  );
};

export default Projects;