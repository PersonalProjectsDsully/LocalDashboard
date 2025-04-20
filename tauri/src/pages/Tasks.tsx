import React, { useState, useEffect, useMemo, useCallback } from 'react';
import axios from 'axios';
// Import react-beautiful-dnd components and types
// Ensure @types/react-beautiful-dnd is installed (`npm i --save-dev @types/react-beautiful-dnd`)
import {
    DragDropContext,
    Droppable,
    Draggable,
    DropResult,
    DroppableProvided,
    DroppableStateSnapshot,
    DraggableProvided,
    DraggableStateSnapshot
} from 'react-beautiful-dnd';
import { useLocation } from 'react-router-dom'; // To potentially get passed projectId
import { eventBus } from '../App'; // Import shared event bus

// --- Interfaces ---
interface Task {
  id: string;
  title: string;
  description?: string;
  status: string; // 'todo', 'in-progress', 'done' (or potentially others)
  priority?: string; // 'high', 'medium', 'low'
  due?: string;
  assigned_to?: string; // Added from YAML example
}

interface Project {
  id: string;
  title: string;
}

// --- Constants ---
const COLUMN_IDS = {
    TODO: 'todo',
    IN_PROGRESS: 'in-progress',
    DONE: 'done',
};

// Map internal IDs to display titles
const columnTitles = {
    [COLUMN_IDS.TODO]: 'To Do',
    [COLUMN_IDS.IN_PROGRESS]: 'In Progress',
    [COLUMN_IDS.DONE]: 'Done',
};

// --- Component ---
const Tasks: React.FC = () => {
  const location = useLocation(); // Get location object to check for passed state
  const passedProjectId = location.state?.projectId; // Get projectId if passed via navigate

  // --- State ---
  const [tasks, setTasks] = useState<Task[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProject, setSelectedProject] = useState<string | null>(passedProjectId || null);
  const [loadingProjects, setLoadingProjects] = useState(true);
  const [loadingTasks, setLoadingTasks] = useState(false); // Start false, true when fetching tasks
  const [error, setError] = useState<string | null>(null);

  // --- Data Fetching Callbacks ---
  const fetchProjects = useCallback(async () => {
    setLoadingProjects(true);
    setError(null);
    try {
      const response = await axios.get('http://localhost:8000/projects');
      const fetchedProjects = response.data.projects || [];
      setProjects(fetchedProjects);
      // Set default selected project only if none is selected/passed AND projects exist
      if (fetchedProjects.length > 0 && !selectedProject) {
        setSelectedProject(fetchedProjects[0].id);
      } else if (fetchedProjects.length === 0) {
        setSelectedProject(null); // No projects available
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
  }, []); // Run once on mount generally

  const fetchTasks = useCallback(async (projectId: string | null) => {
      if (!projectId) {
          setTasks([]); // Clear tasks if no project is selected
          setLoadingTasks(false);
          return;
      }
      setLoadingTasks(true);
      setError(null); // Clear previous task errors
      try {
        const response = await axios.get(`http://localhost:8000/tasks?project_id=${projectId}`);
        const fetchedTasks = response.data.tasks || [];

        // Ensure status matches column IDs and default if invalid/missing
        const correctedTasks = fetchedTasks.map((task: Task) => {
            // Normalize status: lowercase, replace space/underscore with hyphen
            const normalizedStatus = task.status?.toLowerCase().replace(/[\s_]/g, '-') || COLUMN_IDS.TODO;
            // Ensure it's a valid column ID, otherwise default to TODO
            const validStatus = COLUMN_IDS[normalizedStatus.toUpperCase() as keyof typeof COLUMN_IDS] || COLUMN_IDS.TODO;
            return { ...task, status: validStatus };
        });
        setTasks(correctedTasks);
      } catch (err) {
        console.error(`Error fetching tasks for project ${projectId}:`, err);
        // Don't show error if it's just 404 (tasks file doesn't exist yet)
        if (axios.isAxiosError(err) && err.response?.status === 404) {
            setTasks([]); // Set empty tasks, it's not an error state
            setError(null);
        } else {
            setError(`Failed to load tasks for the selected project.`);
            setTasks([]); // Clear tasks on other errors
        }
      } finally {
        setLoadingTasks(false);
      }
    }, []); // fetchTasks itself doesn't depend on external state


  // --- Effects ---
  useEffect(() => {
    fetchProjects(); // Fetch projects on initial mount
  }, [fetchProjects]);

  useEffect(() => {
    fetchTasks(selectedProject); // Fetch tasks whenever selected project changes
  }, [selectedProject, fetchTasks]);

  useEffect(() => {
     // Listen for WebSocket messages indicating task updates for the *currently selected* project
     const handleTasksUpdate = (message: any) => {
         if (message?.project_id && message.project_id === selectedProject) {
             console.log(`Tasks updated via WebSocket for current project ${selectedProject}, refetching...`);
             fetchTasks(selectedProject); // Refetch tasks for the current project
         }
     };
     const unsubscribe = eventBus.on('tasks_updated', handleTasksUpdate);
     return () => unsubscribe(); // Cleanup listener on unmount or when selectedProject changes
  }, [selectedProject, fetchTasks]); // Re-subscribe if selectedProject changes


  // --- Event Handlers ---
  const handleProjectChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setSelectedProject(e.target.value || null); // Set to null if the "Select project" option is chosen
  };

  const handleDragEnd = async (result: DropResult) => {
    const { source, destination, draggableId } = result;

    // 1. Check if drop is valid
    if (!destination) return; // Dropped outside a droppable area
    if (source.droppableId === destination.droppableId && source.index === destination.index) return; // Dropped in the same place

    const taskToMove = tasks.find(task => task.id === draggableId);
    if (!taskToMove || !selectedProject) return; // Task or project not found/selected

    // 2. Optimistic UI Update
    // Create a new array with the task moved to the new status
    // Note: This simple update only changes the status property.
    // For visual reordering within the list *before* backend confirmation,
    // you'd need a more complex state update (e.g., managing tasks per column).
    const updatedTasksOptimistic = tasks.map(task =>
        task.id === draggableId
            ? { ...task, status: destination.droppableId }
            : task
    );
    setTasks(updatedTasksOptimistic); // Update UI immediately

    // 3. Call Backend API to persist the change
    try {
      setError(null); // Clear previous errors
      await axios.put(`http://localhost:8000/tasks/${selectedProject}`, {
        id: draggableId,
        status: destination.droppableId, // The ID of the column it was dropped into
      });
      // Success! The optimistic update is likely correct.
      // The WebSocket listener should ideally handle the final state confirmation by refetching,
      // preventing the need for a second refetch here unless WS fails.
      console.log(`Task ${draggableId} status updated to ${destination.droppableId} on backend.`);
    } catch (error) {
      console.error('Failed to update task status on backend:', error);
      setError('Failed to save task change. Reverting UI.');
      // Revert UI change on failure by refetching the last known good state
      // (Could also revert using the state before the optimistic update, but refetch is safer)
      fetchTasks(selectedProject);
    }
  };

  const handleCreateTask = () => {
    // TODO: Implement task creation modal/form
    // Should likely POST to a new endpoint like /tasks/{project_id}
    console.log('Create task clicked - Placeholder');
  };

  // --- Memoized Derived State ---
  // Group tasks by their status column ID for rendering
  const tasksByColumn = useMemo(() => {
      const columns: { [key: string]: Task[] } = {
          [COLUMN_IDS.TODO]: [],
          [COLUMN_IDS.IN_PROGRESS]: [],
          [COLUMN_IDS.DONE]: [],
      };
      tasks.forEach(task => {
          // Ensure task status is valid, default to TODO if not
          const columnId = task.status && COLUMN_IDS[task.status.toUpperCase() as keyof typeof COLUMN_IDS]
                             ? task.status
                             : COLUMN_IDS.TODO;
          columns[columnId].push(task);
      });
      // Optional: Sort tasks within each column (e.g., by priority, due date, title)
      // Object.values(columns).forEach(columnTasks => {
      //     columnTasks.sort((a, b) => a.title.localeCompare(b.title));
      // });
      return columns;
  }, [tasks]); // Recalculate only when the tasks array changes

  // --- Helper Functions ---
  const getPriorityClass = (priority?: string): string => {
    if (!priority) return 'border-l-gray-400 dark:border-l-gray-500'; // Neutral border
    switch (priority.toLowerCase()) {
      case 'high': return 'border-l-red-500';
      case 'medium': return 'border-l-yellow-400'; // Adjusted yellow
      case 'low': return 'border-l-blue-500';
      default: return 'border-l-gray-400 dark:border-l-gray-500';
    }
  };

  // --- Render ---
  return (
    <div className="tasks-container flex flex-col h-full p-4 md:p-6 lg:p-8 w-full overflow-hidden">
      {/* Header */}
      <div className="header flex flex-col sm:flex-row justify-between items-start sm:items-center mb-6 gap-4 flex-shrink-0">
        <div className="flex items-center gap-4 flex-wrap">
          <h1 className="text-2xl font-bold text-gray-800 dark:text-gray-100">Tasks</h1>
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
                {projects.map((project) => (
                  <option key={project.id} value={project.id}> {project.title} </option>
                ))}
              </>
            ) : ( <option value="">No projects available</option> )}
          </select>
        </div>
        <button
          className="quick-action-button bg-blue-500 hover:bg-blue-600 text-white px-4 py-2 rounded shadow flex items-center gap-2 transition duration-150 ease-in-out text-sm disabled:opacity-50 disabled:cursor-not-allowed"
          onClick={handleCreateTask}
          disabled={!selectedProject || loadingTasks} // Disable if no project selected or tasks are loading
          title={!selectedProject ? "Select a project first" : "Create a new task"}
        >
           <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z" clipRule="evenodd" /></svg>
          <span>New Task</span>
        </button>
      </div>

      {/* Error Display */}
      {error && (
         <div className="error-state text-center text-red-600 dark:text-red-400 bg-red-100 dark:bg-red-900/50 p-3 rounded border border-red-300 dark:border-red-700 mb-4 text-sm flex-shrink-0">{error}</div>
      )}

      {/* Kanban Board Area */}
      <div className="flex-1 overflow-hidden"> {/* Container for scrolling */}
        {!selectedProject && !loadingProjects ? (
          <div className="empty-state h-full flex items-center justify-center text-center text-gray-500 dark:text-gray-400 p-8 border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-lg">
            <p>Please select a project to view tasks.</p>
          </div>
        ) : loadingTasks ? (
           <div className="loading-state h-full flex items-center justify-center text-gray-500 dark:text-gray-400">Loading tasks...</div>
        ) : (
          <DragDropContext onDragEnd={handleDragEnd}>
            <div className="kanban-board h-full grid grid-cols-1 md:grid-cols-3 gap-4"> {/* Grid layout */}
              {Object.entries(columnTitles).map(([columnId, title]) => (
                <div key={columnId} className="kanban-column bg-gray-100 dark:bg-gray-800 rounded-lg p-3 flex flex-col h-full overflow-hidden"> {/* Column styling */}
                  {/* Column Header */}
                  <div className="kanban-column-header flex justify-between items-center mb-3 px-1 flex-shrink-0">
                    <h2 className="font-semibold text-gray-700 dark:text-gray-200">{title}</h2>
                    <span className="task-count text-xs bg-gray-300 dark:bg-gray-600 text-gray-600 dark:text-gray-300 rounded-full px-2 py-0.5">
                      {tasksByColumn[columnId]?.length || 0}
                    </span>
                  </div>
                  {/* Droppable Area */}
                  <Droppable droppableId={columnId}>
                    {(provided: DroppableProvided, snapshot: DroppableStateSnapshot) => (
                      <div
                        ref={provided.innerRef}
                        {...provided.droppableProps}
                        // Styling for the droppable area, changes when dragging over
                        className={`kanban-tasks flex-1 space-y-3 overflow-y-auto p-1 rounded-md transition-colors duration-200 ${snapshot.isDraggingOver ? 'bg-blue-50 dark:bg-blue-900/20' : 'bg-transparent'}`}
                      >
                        {/* Display tasks or empty message */}
                        {tasksByColumn[columnId]?.length === 0 && !snapshot.isDraggingOver && (
                           <div className="text-center text-xs text-gray-400 dark:text-gray-500 pt-4 italic">Drop tasks here</div>
                        )}
                        {/* Map and render draggable tasks */}
                        {tasksByColumn[columnId]?.map((task, index) => (
                          <Draggable key={task.id} draggableId={task.id} index={index}>
                            {(provided: DraggableProvided, snapshot: DraggableStateSnapshot) => (
                              <div
                                ref={provided.innerRef}
                                {...provided.draggableProps}
                                {...provided.dragHandleProps}
                                // Styling for the draggable card, changes when dragging
                                className={`kanban-card bg-white dark:bg-gray-700 rounded shadow p-3 border-l-4 cursor-grab active:cursor-grabbing ${getPriorityClass(task.priority)} ${snapshot.isDragging ? 'shadow-lg scale-105 ring-2 ring-blue-400' : 'shadow-sm'}`}
                                style={{...provided.draggableProps.style}} // Required style overrides from library
                                title={task.description || task.title} // Tooltip for description
                              >
                                {/* Task Content */}
                                <h3 className="task-title font-medium text-sm text-gray-900 dark:text-white mb-1">{task.title}</h3>
                                {task.description && (
                                  <p className="task-description text-xs text-gray-600 dark:text-gray-400 mb-2 line-clamp-2">{task.description}</p>
                                )}
                                <div className="task-meta flex justify-between items-center text-xs text-gray-500 dark:text-gray-400">
                                   {task.due && (
                                      <span className="task-due flex items-center gap-1" title={`Due: ${task.due}`}>
                                           <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
                                           {task.due}
                                       </span>
                                   )}
                                   {task.assigned_to && (
                                       <span className="task-assignee flex items-center gap-1 ml-auto pl-2" title={`Assigned to ${task.assigned_to}`}> {/* Push assignee to right */}
                                            <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3 flex-shrink-0" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M10 9a3 3 0 100-6 3 3 0 000 6zm-7 9a7 7 0 1114 0H3z" clipRule="evenodd" /></svg>
                                            {task.assigned_to.split(' ')[0]} {/* Show first name only */}
                                        </span>
                                   )}
                                </div>
                              </div>
                            )}
                          </Draggable>
                        ))}
                        {provided.placeholder} {/* Placeholder for space while dragging */}
                      </div>
                    )}
                  </Droppable>
                </div>
              ))}
            </div>
          </DragDropContext>
        )}
      </div>
    </div>
  );
};

export default Tasks;