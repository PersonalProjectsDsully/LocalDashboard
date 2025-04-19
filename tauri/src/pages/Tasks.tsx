import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { DragDropContext, Droppable, Draggable } from 'react-beautiful-dnd';

interface Task {
  id: string;
  title: string;
  description?: string;
  status: string;
  priority?: string;
  due?: string;
}

interface Project {
  id: string;
  title: string;
}

const Tasks: React.FC = () => {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProject, setSelectedProject] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  useEffect(() => {
    // Fetch projects
    const fetchProjects = async () => {
      try {
        const response = await axios.get('http://localhost:8000/projects');
        setProjects(response.data.projects || []);
        
        // Select the first project by default if available
        if (response.data.projects && response.data.projects.length > 0) {
          setSelectedProject(response.data.projects[0].id);
        }
      } catch (err) {
        console.error('Error fetching projects:', err);
        setError('Failed to load projects. Please try again later.');
      }
    };
    
    fetchProjects();
  }, []);
  
  useEffect(() => {
    // Fetch tasks for the selected project
    const fetchTasks = async () => {
      if (!selectedProject) return;
      
      try {
        setLoading(true);
        const response = await axios.get(`http://localhost:8000/tasks?project_id=${selectedProject}`);
        setTasks(response.data.tasks || []);
        setError(null);
      } catch (err) {
        console.error('Error fetching tasks:', err);
        setError('Failed to load tasks. Please try again later.');
      } finally {
        setLoading(false);
      }
    };
    
    fetchTasks();
  }, [selectedProject]);
  
  const handleProjectChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setSelectedProject(e.target.value);
  };
  
  const handleDragEnd = (result: any) => {
    if (!result.destination) return;
    
    const { source, destination } = result;
    
    // If dropped in a different column
    if (source.droppableId !== destination.droppableId) {
      const updatedTasks = [...tasks];
      const taskIndex = updatedTasks.findIndex(task => task.id === result.draggableId);
      
      if (taskIndex !== -1) {
        updatedTasks[taskIndex] = {
          ...updatedTasks[taskIndex],
          status: destination.droppableId
        };
        
        setTasks(updatedTasks);
        
        // This would be an actual API call in the real implementation
        console.log('Updating task status:', result.draggableId, destination.droppableId);
      }
    }
  };
  
  const getTasksByStatus = (status: string) => {
    return tasks.filter(task => task.status === status);
  };
  
  const getPriorityClass = (priority?: string) => {
    if (!priority) return '';
    
    switch (priority.toLowerCase()) {
      case 'high':
        return 'priority-high';
      case 'medium':
        return 'priority-medium';
      case 'low':
        return 'priority-low';
      default:
        return '';
    }
  };
  
  const handleCreateTask = () => {
    // This would open a modal or navigate to create task page
    console.log('Create task clicked');
  };
  
  return (
    <div className="tasks-container">
      <div className="header">
        <div className="flex items-center">
          <h1 className="text-2xl font-bold mr-4">Tasks</h1>
          <select 
            className="project-select"
            value={selectedProject || ''}
            onChange={handleProjectChange}
            disabled={projects.length === 0}
          >
            {projects.length > 0 ? (
              projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.title}
                </option>
              ))
            ) : (
              <option value="">No projects available</option>
            )}
          </select>
        </div>
        <button 
          className="quick-action-button"
          onClick={handleCreateTask}
          disabled={!selectedProject}
        >
          <span>+</span> New Task
        </button>
      </div>
      
      {loading ? (
        <div className="loading-state">Loading tasks...</div>
      ) : error ? (
        <div className="error-state">{error}</div>
      ) : !selectedProject ? (
        <div className="empty-state">
          <p>No project selected. Please select a project to view tasks.</p>
        </div>
      ) : (
        <DragDropContext onDragEnd={handleDragEnd}>
          <div className="kanban-board">
            <div className="kanban-column">
              <div className="kanban-column-header">
                <h2>To Do</h2>
                <span className="task-count">{getTasksByStatus('todo').length}</span>
              </div>
              <Droppable droppableId="todo">
                {(provided) => (
                  <div
                    ref={provided.innerRef}
                    {...provided.droppableProps}
                    className="kanban-tasks"
                  >
                    {getTasksByStatus('todo').map((task, index) => (
                      <Draggable key={task.id} draggableId={task.id} index={index}>
                        {(provided) => (
                          <div
                            ref={provided.innerRef}
                            {...provided.draggableProps}
                            {...provided.dragHandleProps}
                            className={`kanban-card ${getPriorityClass(task.priority)}`}
                          >
                            <h3 className="task-title">{task.title}</h3>
                            {task.description && (
                              <p className="task-description">{task.description}</p>
                            )}
                            {task.due && (
                              <p className="task-due">Due: {task.due}</p>
                            )}
                          </div>
                        )}
                      </Draggable>
                    ))}
                    {provided.placeholder}
                  </div>
                )}
              </Droppable>
            </div>
            
            <div className="kanban-column">
              <div className="kanban-column-header">
                <h2>In Progress</h2>
                <span className="task-count">{getTasksByStatus('in-progress').length}</span>
              </div>
              <Droppable droppableId="in-progress">
                {(provided) => (
                  <div
                    ref={provided.innerRef}
                    {...provided.droppableProps}
                    className="kanban-tasks"
                  >
                    {getTasksByStatus('in-progress').map((task, index) => (
                      <Draggable key={task.id} draggableId={task.id} index={index}>
                        {(provided) => (
                          <div
                            ref={provided.innerRef}
                            {...provided.draggableProps}
                            {...provided.dragHandleProps}
                            className={`kanban-card ${getPriorityClass(task.priority)}`}
                          >
                            <h3 className="task-title">{task.title}</h3>
                            {task.description && (
                              <p className="task-description">{task.description}</p>
                            )}
                            {task.due && (
                              <p className="task-due">Due: {task.due}</p>
                            )}
                          </div>
                        )}
                      </Draggable>
                    ))}
                    {provided.placeholder}
                  </div>
                )}
              </Droppable>
            </div>
            
            <div className="kanban-column">
              <div className="kanban-column-header">
                <h2>Done</h2>
                <span className="task-count">{getTasksByStatus('done').length}</span>
              </div>
              <Droppable droppableId="done">
                {(provided) => (
                  <div
                    ref={provided.innerRef}
                    {...provided.droppableProps}
                    className="kanban-tasks"
                  >
                    {getTasksByStatus('done').map((task, index) => (
                      <Draggable key={task.id} draggableId={task.id} index={index}>
                        {(provided) => (
                          <div
                            ref={provided.innerRef}
                            {...provided.draggableProps}
                            {...provided.dragHandleProps}
                            className={`kanban-card ${getPriorityClass(task.priority)}`}
                          >
                            <h3 className="task-title">{task.title}</h3>
                            {task.description && (
                              <p className="task-description">{task.description}</p>
                            )}
                            {task.due && (
                              <p className="task-due">Due: {task.due}</p>
                            )}
                          </div>
                        )}
                      </Draggable>
                    ))}
                    {provided.placeholder}
                  </div>
                )}
              </Droppable>
            </div>
          </div>
        </DragDropContext>
      )}
    </div>
  );
};

export default Tasks;
