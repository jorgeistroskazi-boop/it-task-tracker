// ==================== STATE ====================
let currentProjectId = null;

// ==================== UTILITIES ====================
function $(id) { return document.getElementById(id); }

function formatDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  return d.toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' });
}

function statusLabel(status) {
  const labels = {
    pending: 'Pendiente',
    in_progress: 'En progreso',
    blocked: 'Bloqueada',
    completed: 'Completada'
  };
  return labels[status] || status;
}

function priorityLabel(priority) {
  const labels = {
    low: 'Baja',
    medium: 'Media',
    high: 'Alta',
    critical: 'Crítica'
  };
  return labels[priority] || priority;
}

function showToast(message, type = 'success') {
  const existing = document.querySelector('.toast');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(() => toast.classList.add('show'), 10);
  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

// ==================== NAVIGATION ====================
function showDashboard() {
  $('dashboard-view').classList.remove('hidden');
  $('project-view').classList.add('hidden');
  currentProjectId = null;
  loadProjects();
}

function showProjectView(projectId) {
  currentProjectId = projectId;
  $('dashboard-view').classList.add('hidden');
  $('project-view').classList.remove('hidden');
  loadProjectDetail();
  loadTasks();
}

// ==================== PROJECTS ====================
async function loadProjects() {
  try {
    const res = await fetch('/api/projects');
    const projects = await res.json();

    if (projects.length === 0) {
      $('projects-list').innerHTML = '';
      $('no-projects').classList.remove('hidden');
      return;
    }

    $('no-projects').classList.add('hidden');
    $('projects-list').innerHTML = projects.map(p => {
      const progress = p.total_tasks > 0 ? Math.round((p.completed_tasks / p.total_tasks) * 100) : 0;
      return `
        <div class="project-card card" onclick="showProjectView('${p.id}')">
          <div class="project-card-header">
            <h3>${escapeHtml(p.name)}</h3>
            <button class="btn-icon" onclick="event.stopPropagation(); deleteProject('${p.id}', '${escapeHtml(p.name)}')" title="Eliminar proyecto">&#128465;</button>
          </div>
          <p class="text-muted">${escapeHtml(p.description) || 'Sin descripción'}</p>
          <div class="project-stats">
            <div class="stat">
              <span class="stat-number">${p.total_tasks || 0}</span>
              <span class="stat-label">Tareas</span>
            </div>
            <div class="stat">
              <span class="stat-number">${p.completed_tasks || 0}</span>
              <span class="stat-label">Listas</span>
            </div>
            <div class="stat">
              <span class="stat-number ${p.blocked_tasks > 0 ? 'text-danger' : ''}">${p.blocked_tasks || 0}</span>
              <span class="stat-label">Bloqueadas</span>
            </div>
          </div>
          <div class="progress-bar">
            <div class="progress-fill" style="width: ${progress}%"></div>
          </div>
          <small class="text-muted">${progress}% completado</small>
        </div>
      `;
    }).join('');
  } catch (err) {
    showToast('Error al cargar proyectos', 'error');
  }
}

function showCreateProject() {
  $('create-project-form').classList.remove('hidden');
  $('project-name').focus();
}

function hideCreateProject() {
  $('create-project-form').classList.add('hidden');
  $('project-name').value = '';
  $('project-desc').value = '';
}

async function createProject(e) {
  e.preventDefault();
  const name = $('project-name').value.trim();
  const description = $('project-desc').value.trim();

  try {
    const res = await fetch('/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, description })
    });

    if (!res.ok) throw new Error('Error al crear proyecto');

    hideCreateProject();
    showToast('Proyecto creado');
    loadProjects();
  } catch (err) {
    showToast('Error al crear proyecto', 'error');
  }
}

async function deleteProject(id, name) {
  if (!confirm(`¿Eliminar el proyecto "${name}" y todas sus tareas?`)) return;

  try {
    await fetch(`/api/projects/${id}`, { method: 'DELETE' });
    showToast('Proyecto eliminado');
    loadProjects();
  } catch (err) {
    showToast('Error al eliminar proyecto', 'error');
  }
}

// ==================== PROJECT DETAIL ====================
async function loadProjectDetail() {
  try {
    const res = await fetch(`/api/projects/${currentProjectId}`);
    const project = await res.json();

    const shareUrl = `${window.location.origin}/shared/${project.share_token}`;
    $('share-link').value = shareUrl;

    $('project-header').innerHTML = `
      <h2>${escapeHtml(project.name)}</h2>
      <p class="text-muted">${escapeHtml(project.description) || ''}</p>
      <div class="project-stats-inline">
        <span class="badge badge-total">${project.total_tasks || 0} tareas</span>
        <span class="badge badge-done">${project.completed_tasks || 0} completadas</span>
        ${project.blocked_tasks > 0 ? `<span class="badge badge-blocked">${project.blocked_tasks} bloqueadas</span>` : ''}
      </div>
    `;
  } catch (err) {
    showToast('Error al cargar proyecto', 'error');
  }
}

function copyShareLink() {
  const input = $('share-link');
  input.select();
  navigator.clipboard.writeText(input.value).then(() => {
    showToast('Link copiado al portapapeles');
  }).catch(() => {
    document.execCommand('copy');
    showToast('Link copiado');
  });
}

// ==================== TASKS ====================
async function loadTasks() {
  const status = $('filter-status').value;
  const priority = $('filter-priority').value;

  let url = `/api/projects/${currentProjectId}/tasks?`;
  if (status) url += `status=${status}&`;
  if (priority) url += `priority=${priority}&`;

  try {
    const res = await fetch(url);
    const tasks = await res.json();

    if (tasks.length === 0) {
      $('tasks-list').innerHTML = '';
      $('no-tasks').classList.remove('hidden');
      return;
    }

    $('no-tasks').classList.add('hidden');
    $('tasks-list').innerHTML = tasks.map(t => `
      <div class="task-card card status-${t.status}">
        <div class="task-header">
          <div class="task-title-row">
            <span class="priority-dot priority-${t.priority}" title="${priorityLabel(t.priority)}"></span>
            <h4>${escapeHtml(t.title)}</h4>
          </div>
          <div class="task-actions">
            <button class="btn-icon" onclick="editTask('${t.id}')" title="Editar">&#9998;</button>
            <button class="btn-icon" onclick="deleteTask('${t.id}')" title="Eliminar">&#128465;</button>
          </div>
        </div>
        ${t.description ? `<p class="task-desc">${escapeHtml(t.description)}</p>` : ''}
        <div class="task-meta">
          <span class="badge status-badge-${t.status}">${statusLabel(t.status)}</span>
          <span class="badge priority-badge-${t.priority}">${priorityLabel(t.priority)}</span>
          ${t.assigned_to ? `<span class="task-assigned">&#128100; ${escapeHtml(t.assigned_to)}</span>` : ''}
          ${t.due_date ? `<span class="task-due">&#128197; ${formatDate(t.due_date)}</span>` : ''}
        </div>
        ${t.notes ? `<p class="task-notes">&#128221; ${escapeHtml(t.notes)}</p>` : ''}
      </div>
    `).join('');
  } catch (err) {
    showToast('Error al cargar tareas', 'error');
  }
}

function showCreateTask() {
  $('task-form-title').textContent = 'Nueva Tarea';
  $('task-id').value = '';
  $('task-title').value = '';
  $('task-description').value = '';
  $('task-status').value = 'pending';
  $('task-priority').value = 'medium';
  $('task-assigned').value = '';
  $('task-notes').value = '';
  $('task-due-date').value = '';
  $('task-form-container').classList.remove('hidden');
  $('task-title').focus();
}

function hideTaskForm() {
  $('task-form-container').classList.add('hidden');
}

async function editTask(taskId) {
  try {
    const res = await fetch(`/api/projects/${currentProjectId}/tasks`);
    const tasks = await res.json();
    const task = tasks.find(t => t.id === taskId);
    if (!task) return;

    $('task-form-title').textContent = 'Editar Tarea';
    $('task-id').value = task.id;
    $('task-title').value = task.title;
    $('task-description').value = task.description || '';
    $('task-status').value = task.status;
    $('task-priority').value = task.priority;
    $('task-assigned').value = task.assigned_to || '';
    $('task-notes').value = task.notes || '';
    $('task-due-date').value = task.due_date || '';
    $('task-form-container').classList.remove('hidden');
    $('task-title').focus();
  } catch (err) {
    showToast('Error al cargar tarea', 'error');
  }
}

async function saveTask(e) {
  e.preventDefault();
  const taskId = $('task-id').value;
  const data = {
    title: $('task-title').value.trim(),
    description: $('task-description').value.trim(),
    status: $('task-status').value,
    priority: $('task-priority').value,
    assigned_to: $('task-assigned').value.trim(),
    notes: $('task-notes').value.trim(),
    due_date: $('task-due-date').value || null
  };

  try {
    let res;
    if (taskId) {
      res = await fetch(`/api/tasks/${taskId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });
    } else {
      res = await fetch(`/api/projects/${currentProjectId}/tasks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });
    }

    if (!res.ok) throw new Error('Error al guardar');

    hideTaskForm();
    showToast(taskId ? 'Tarea actualizada' : 'Tarea creada');
    loadTasks();
    loadProjectDetail();
  } catch (err) {
    showToast('Error al guardar tarea', 'error');
  }
}

async function deleteTask(taskId) {
  if (!confirm('¿Eliminar esta tarea?')) return;

  try {
    await fetch(`/api/tasks/${taskId}`, { method: 'DELETE' });
    showToast('Tarea eliminada');
    loadTasks();
    loadProjectDetail();
  } catch (err) {
    showToast('Error al eliminar tarea', 'error');
  }
}

// ==================== HELPERS ====================
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// ==================== INIT ====================
document.addEventListener('DOMContentLoaded', () => {
  loadProjects();
});
