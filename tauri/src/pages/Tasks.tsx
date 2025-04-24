import React, { useState, useEffect, useMemo, useCallback } from 'react';
import axios from 'axios';
import { useLocation } from 'react-router-dom';
import { eventBus } from '../App';
import '../styles/Tasks.css';
import '../styles/force-dark.css';

// --- Interfaces ---
interface Task {
  id: string;
  title: string;
  description?: string;
  status: string;
  priority?: string;
  due?: string;
  assigned_to?: string;
}

interface Project {
  id: string;
  title: string;
}

// --- Constants ---
// IMPORTANT: These must match exactly what the server expects
const COLUMN_IDS = {
  TODO: 'todo',
  IN_PROGRESS: 'in-progress', // Make sure this matches exactly what the server expects
  DONE: 'done',
};

const columnTitles = {
  [COLUMN_IDS.TODO]: 'To Do',
  [COLUMN_IDS.IN_PROGRESS]: 'In Progress',
  [COLUMN_IDS.DONE]: 'Done',
};

// --- Component ---
const Tasks: React.FC = () => {
  const location = useLocation();
  const passedProjectId = location.state?.projectId;

  // --- State ---
  const [tasks, setTasks] = useState<Task[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProject, setSelectedProject] = useState<string | null>(passedProjectId || null);
  const [loadingProjects, setLoadingProjects] = useState(true);
  const [loadingTasks, setLoadingTasks] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draggedTask, setDraggedTask] = useState<Task | null>(null);
  const [debugInfo, setDebugInfo] = useState('');

  // --- Data Fetching Callbacks ---
  const fetchProjects = useCallback(async () => {
    setLoadingProjects(true);
    setError(null);
    try {
      const response = await axios.get('http://localhost:8000/projects');
      console.log('Projects API response:', response.data);
      const fetchedProjects = Array.isArray(response.data) ? response.data : (response.data.projects || []);
      setProjects(fetchedProjects);
      console.log('Fetched projects:', fetchedProjects);
      
      if (fetchedProjects.length > 0 && !selectedProject) {
        setSelectedProject(fetchedProjects[0].id);
        console.log('Selected project:', fetchedProjects[0].id);
      } else if (fetchedProjects.length === 0) {
        setSelectedProject(null);
      }
    } catch (err) {
      console.error('Error fetching projects:', err);
      setError('Failed to load projects.');
      setProjects([]);
      setSelectedProject(null);
    } finally {
      setLoadingProjects(false);
    }
  }, [selectedProject]);

  const fetchTasks = useCallback(async (projectId: string | null) => {
    if (!projectId) {
      setTasks([]);
      setLoadingTasks(false);
      return;
    }
    
    setLoadingTasks(true);
    setError(null);
    
    try {
      const response = await axios.get(`http://localhost:8000/tasks/${projectId}`);
      console.log('Tasks API response:', response.data);
      const fetchedTasks = response.data.tasks || [];
      console.log('Fetched tasks:', fetchedTasks);

      // Enhanced debugging
      const taskStatuses = fetchedTasks.map((t: any) => `${t.id}: ${t.status}`);
      setDebugInfo(`Task statuses: ${taskStatuses.join(', ')}`);

      // Normalize all task statuses - IMPORTANT for consistency
      const processedTasks = fetchedTasks.map((task: any) => ({
        ...task,
        id: String(task.id),
        // Ensure status is normalized to match our column IDs
        status: task.status?.toLowerCase().replace(/[\s_]/g, '-') || COLUMN_IDS.TODO
      }));
      
      console.log('Processed tasks with normalized status:', processedTasks);
      setTasks(processedTasks);
    } catch (err) {
      console.error(`Error fetching tasks for project ${projectId}:`, err);
      if (axios.isAxiosError(err) && err.response?.status === 404) {
        setTasks([]);
        setError(null);
      } else {
        setError(`Failed to load tasks for the selected project.`);
        setTasks([]);
      }
    } finally {
      setLoadingTasks(false);
    }
  }, []);

  // --- Effects ---
  useEffect(() => {
    fetchProjects();
  }, [fetchProjects]);

  useEffect(() => {
    fetchTasks(selectedProject);
  }, [selectedProject, fetchTasks]);

  useEffect(() => {
    const handleTasksUpdate = (message: any) => {
      if (message?.project_id && message.project_id === selectedProject) {
        console.log(`Tasks updated via WebSocket for current project ${selectedProject}, refetching...`);
        fetchTasks(selectedProject);
      }
    };
    const unsubscribe = eventBus.on('tasks_updated', handleTasksUpdate);
    return () => unsubscribe();
  }, [selectedProject, fetchTasks]);

  // --- Event Handlers ---
  const handleProjectChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setSelectedProject(e.target.value || null);
  };

  const handleEditTask = async (taskId: string, updatedFields: Partial<Task>) => {
    if (!selectedProject) return;
    
    const taskToUpdate = tasks.find(t => String(t.id) === String(taskId));
    if (!taskToUpdate) {
      console.error('Task not found for editing:', taskId);
      return;
    }
    
    try {
      const updatedTask = { ...taskToUpdate, ...updatedFields };
      console.log(`Updating task ${taskId} with:`, updatedFields);
      
      // Optimistic UI update
      setTasks(tasks.map(t => String(t.id) === String(taskId) ? updatedTask : t));
      
      // Send to server
      await axios.put(`http://localhost:8000/tasks/${selectedProject}/${taskId}`, updatedTask);
      console.log(`Task ${taskId} updated successfully`);
    } catch (error) {
      console.error('Failed to update task:', error);
      setError('Failed to update task. Please try again.');
      fetchTasks(selectedProject);
    }
  };

  const handleUpdateTaskStatus = async (taskId: string, newStatus: string) => {
    if (!selectedProject) return;
    
    const taskToUpdate = tasks.find(t => String(t.id) === String(taskId));
    if (!taskToUpdate) {
      console.error('Task not found for status update:', taskId);
      return;
    }
    
    try {
      // If already in this status, no need to update
      if (taskToUpdate.status === newStatus) {
        console.log(`Task ${taskId} already has status ${newStatus}, no update needed`);
        return;
      }
      
      console.log(`Updating task ${taskId} status from ${taskToUpdate.status} to ${newStatus}`);
      
      // Create updated task
      const updatedTask = { ...taskToUpdate, status: newStatus };
      
      // Optimistic UI update
      setTasks(prev => prev.map(t => String(t.id) === String(taskId) ? updatedTask : t));
      
      // Send to server
      await axios.put(`http://localhost:8000/tasks/${selectedProject}/${taskId}`, updatedTask);
      console.log(`Task status updated successfully to ${newStatus}`);
      
      // Force a refresh to ensure server state is reflected
      setTimeout(() => fetchTasks(selectedProject), 500);
    } catch (error) {
      console.error('Failed to update task status:', error);
      setError('Failed to update task status. Please try again.');
      fetchTasks(selectedProject);
    }
  };

  const handleCreateTask = async () => {
    if (!selectedProject) {
      setError('Please select a project first.');
      return;
    }
    
    try {
      const newTaskId = `task-${Date.now()}`;
      const newTask: Task = {
        id: newTaskId,
        title: `New Task ${new Date().toLocaleTimeString()}`,
        description: "Click to edit this task",
        status: COLUMN_IDS.TODO,
        priority: "medium",
        due: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
      };
      
      console.log('Creating new task:', newTask);
      
      // Optimistic UI update
      setTasks(prev => [...prev, newTask]);
      
      // Call backend API
      const response = await axios.post(`http://localhost:8000/tasks/${selectedProject}`, newTask);
      
      if (response.data) {
        console.log('Task created successfully:', response.data);
        fetchTasks(selectedProject);
      }
    } catch (error) {
      console.error('Failed to create task:', error);
      setError('Failed to create task. Please try again.');
      fetchTasks(selectedProject);
    }
  };

  // --- Native Drag & Drop Handlers ---
  const handleDragStart = (e: React.DragEvent<HTMLDivElement>, task: Task) => {
    e.dataTransfer.setData('taskId', String(task.id));
    setDraggedTask(task);
    console.log(`Started dragging task ${task.id} (current status: ${task.status})`);
    
    // Add dragging class and set opacity
    if (e.currentTarget) {
      e.currentTarget.classList.add('dragging');
      e.currentTarget.style.opacity = '0.5';
    }
  };

  const handleDragEnd = (e: React.DragEvent<HTMLDivElement>) => {
    setDraggedTask(null);
    // Remove dragging class and reset opacity
    if (e.currentTarget) {
      e.currentTarget.classList.remove('dragging');
      e.currentTarget.style.opacity = '1';
    }
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault(); // Allow drop
    e.currentTarget.classList.add('drag-over');
  };

  const handleDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    e.currentTarget.classList.remove('drag-over');
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>, columnStatus: string) => {
    e.preventDefault();
    e.currentTarget.classList.remove('drag-over');
    
    const taskId = e.dataTransfer.getData('taskId');
    console.log(`Dropped task ${taskId} into column with status: ${columnStatus}`);
    
    if (taskId) {
      // Debug task status
      const task = tasks.find(t => String(t.id) === taskId);
      console.log(`Task being dropped: ${task?.title}, Current status: ${task?.status}, New status: ${columnStatus}`);
      
      handleUpdateTaskStatus(taskId, columnStatus);
    }
  };

  // --- Memoized Derived State ---
  const tasksByColumn = useMemo(() => {
    const columns: { [key: string]: Task[] } = {
      [COLUMN_IDS.TODO]: [],
      [COLUMN_IDS.IN_PROGRESS]: [],
      [COLUMN_IDS.DONE]: [],
    };
    
    console.log("Organizing tasks by column with these column IDs:", Object.values(COLUMN_IDS));
    
    tasks.forEach(task => {
      // Debug each task's assignment
      console.log(`Task ${task.id} (${task.title}) has status: ${task.status}`);
      
      // Get valid column ID or default to TODO
      let columnId = task.status;
      
      // Validate that the column exists, otherwise default to TODO
      if (!Object.values(COLUMN_IDS).includes(columnId)) {
        console.log(`Task ${task.id} has invalid status ${task.status}, defaulting to TODO`);
        columnId = COLUMN_IDS.TODO;
      }
      
      // Push to appropriate column
      if (columns[columnId]) {
        columns[columnId].push(task);
      } else {
        console.error(`Column ${columnId} not found in columns object. Available columns:`, Object.keys(columns));
        // Default to TODO if column not found
        columns[COLUMN_IDS.TODO].push(task);
      }
    });
    
    // Sort tasks by due date
    Object.values(columns).forEach(columnTasks => {
      columnTasks.sort((a, b) => {
        if (a.due && b.due) return a.due.localeCompare(b.due);
        if (a.due) return -1;
        if (b.due) return 1;
        return 0;
      });
    });
    
    console.log("Tasks organized by column:", {
      todo: columns[COLUMN_IDS.TODO].length,
      inProgress: columns[COLUMN_IDS.IN_PROGRESS].length,
      done: columns[COLUMN_IDS.DONE].length
    });
    
    return columns;
  }, [tasks]);

  // --- Helper Functions ---
  const getPriorityClass = (priority?: string): string => {
    if (!priority) return 'border-l-gray-400 dark:border-l-gray-500';
    switch (priority.toLowerCase()) {
      case 'high': return 'border-l-red-500 dark:border-l-red-400';
      case 'medium': return 'border-l-yellow-400 dark:border-l-yellow-300';
      case 'low': return 'border-l-blue-500 dark:border-l-blue-400';
      default: return 'border-l-gray-400 dark:border-l-gray-500';
    }
  };

  return (
    <div className="tasks-container flex flex-col h-full p-4 md:p-6 lg:p-8 w-full overflow-hidden">
      {/* Header */}
      <div className="header flex flex-col sm:flex-row justify-between items-start sm:items-center mb-6 gap-4 flex-shrink-0 dark:text-gray-100">
        <div className="flex items-center gap-4 flex-wrap">
          <h1 className="text-2xl font-bold text-gray-800 dark:text-gray-100">Tasks</h1>
          <select
            className="project-select p-2 border border-gray-300 dark:border-gray-700 rounded bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
            value={selectedProject || ''}
            onChange={handleProjectChange}
            disabled={loadingProjects || projects.length === 0}
            aria-label="Select Project"
          >
            {loadingProjects ? (
              <option value="">Loading projects...</option>
            ) : projects.length > 0 ? (
              <>
                <option value="">Select project...</option>
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>{project.title}</option>
                ))}
              </>
            ) : (
              <option value="">No projects available</option>
            )}
          </select>
        </div>
        <button
          className="quick-action-button bg-blue-500 hover:bg-blue-600 dark:bg-blue-600 dark:hover:bg-blue-700 text-white px-4 py-2 rounded shadow flex items-center gap-2 transition duration-150 ease-in-out text-sm disabled:opacity-50 disabled:cursor-not-allowed"
          onClick={handleCreateTask}
          disabled={!selectedProject || loadingTasks}
          title={!selectedProject ? "Select a project first" : "Create a new task"}
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z" clipRule="evenodd" />
          </svg>
          <span>New Task</span>
        </button>
      </div>

      {/* Error Display */}
      {error && (
        <div className="error-state text-center text-red-600 dark:text-red-300 bg-red-100 dark:bg-red-900/30 p-3 rounded border border-red-300 dark:border-red-700 mb-4 text-sm flex-shrink-0">
          {error}
        </div>
      )}

      {/* Debug Info (only in development) */}
      {process.env.NODE_ENV !== 'production' && debugInfo && (
        <div className="debug-info text-xs text-gray-500 dark:text-gray-400 mb-2 p-1 border-t border-b border-gray-200 dark:border-gray-700">
          <details>
            <summary>Debug Info (click to expand)</summary>
            <pre className="mt-1 whitespace-pre-wrap">{debugInfo}</pre>
          </details>
        </div>
      )}

      {/* Kanban Board Area */}
      <div className="flex-1 overflow-hidden">
        {!selectedProject && !loadingProjects ? (
          <div className="empty-state h-full flex items-center justify-center text-center text-gray-500 dark:text-gray-300 p-8 border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-lg">
            <p>Please select a project to view tasks.</p>
          </div>
        ) : loadingTasks ? (
          <div className="loading-state h-full flex items-center justify-center text-gray-500 dark:text-gray-300">
            Loading tasks...
          </div>
        ) : (
          <div className="kanban-board h-full grid grid-cols-1 md:grid-cols-3 gap-4">
            {Object.entries(columnTitles).map(([columnId, title]) => (
              <div 
                key={columnId} 
                className="kanban-column bg-gray-100 dark:bg-gray-900 rounded-lg p-3 flex flex-col h-full overflow-hidden border border-transparent dark:border-gray-700"
              >
                {/* Column Header */}
                <div className="kanban-column-header flex justify-between items-center mb-3 px-1 flex-shrink-0">
                  <h2 className="font-semibold text-gray-700 dark:text-gray-100">{title}</h2>
                  <span className="task-count text-xs bg-gray-300 dark:bg-gray-600 text-gray-600 dark:text-gray-300 rounded-full px-2 py-0.5">
                    {tasksByColumn[columnId]?.length || 0}
                  </span>
                </div>
                
                {/* Droppable Area */}
                <div
                  className="kanban-tasks flex-1 space-y-3 overflow-y-auto p-1 rounded-md transition-colors duration-200"
                  onDragOver={handleDragOver}
                  onDragLeave={handleDragLeave}
                  onDrop={(e) => handleDrop(e, columnId)}
                  data-column-id={columnId} // For debugging
                >
                  {/* Empty state */}
                  {tasksByColumn[columnId]?.length === 0 && (
                    <div className="text-center text-xs text-gray-400 dark:text-gray-500 pt-4 italic">
                      Drop tasks here ({columnId})
                    </div>
                  )}
                  
                  {/* Tasks */}
                  {tasksByColumn[columnId]?.map((task) => (
                    <div
                      key={task.id}
                      className={`kanban-card rounded-lg border-l-4 p-3 cursor-move ${getPriorityClass(task.priority)} shadow-sm hover:shadow-md hover:bg-white dark:hover:bg-gray-700 transition-all duration-200 priority-${task.priority?.toLowerCase() || 'normal'}`}
                      draggable
                      onDragStart={(e) => handleDragStart(e, task)}
                      onDragEnd={handleDragEnd}
                      data-task-id={task.id}
                      data-task-status={task.status}
                    >
                      {/* Task Content */}
                      <div
                        className="task-content-wrapper"
                        onClick={() => {
                          const newTitle = prompt('Edit task title:', task.title);
                          if (newTitle && newTitle !== task.title) {
                            const newDesc = prompt('Edit task description:', task.description || '');
                            handleEditTask(task.id, {
                              title: newTitle,
                              description: newDesc || task.description
                            });
                          }
                        }}
                      >
                        <h3 className="task-title font-medium text-sm text-gray-900 dark:text-white mb-1">
                          {task.title}
                        </h3>
                        {task.description && (
                          <p className="task-description text-xs text-gray-600 dark:text-gray-300 mb-2 line-clamp-2">
                            {task.description}
                          </p>
                        )}
                      </div>
                      
                      {/* Task Metadata */}
                      <div className="task-meta flex justify-between items-center text-xs text-gray-500 dark:text-gray-400">
                        {task.due && (
                          <span className="task-due dark:text-gray-300" title={`Due: ${task.due}`}>
                            {task.due}
                          </span>
                        )}
                        {task.assigned_to && (
                          <span className="task-assignee ml-auto pl-2 dark:text-gray-300" title={`Assigned to ${task.assigned_to}`}>
                            {task.assigned_to.split(' ')[0]}
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default Tasks;
