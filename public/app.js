// ==================== STATE ====================
let currentProjectId = null;
let currentUser = null;

// ==================== AUTH ====================
async function checkAuth() {
  try {
    const res = await fetch('/api/me');
    if (!res.ok) { window.location.href = '/login.html'; return false; }
    currentUser = await res.json();
    $('user-display').textContent = currentUser.full_name;
    return true;
  } catch { window.location.href = '/login.html'; return false; }
}

async function doLogout() {
  await fetch('/api/logout', { method: 'POST' });
  window.location.href = '/login.html';
}

// ==================== USERS ====================
async function showUsersPanel() {
  $('users-modal').classList.remove('hidden');
  loadUsers();
}

function closeUsersPanel() {
  $('users-modal').classList.add('hidden');
}

async function loadUsers() {
  try {
    const res = await fetch('/api/users');
    const users = await res.json();
    $('users-list').innerHTML = users.map(u => `
      <div class="user-item">
        <div class="user-item-info">
          <span class="user-item-name">${escapeHtml(u.full_name)}</span>
          <span class="user-item-username">@${escapeHtml(u.username)} &bull; ${u.role}</span>
        </div>
        ${u.id !== currentUser.id ? `<button class="btn-icon" onclick="deleteUser('${u.id}', '${escapeHtml(u.full_name)}')" title="Eliminar">&#128465;</button>` : '<span class="badge badge-total">Tú</span>'}
      </div>
    `).join('');
  } catch (err) {
    showToast('Error al cargar usuarios', 'error');
  }
}

async function createUser(e) {
  e.preventDefault();
  const full_name = $('new-fullname').value.trim();
  const username = $('new-username').value.trim();
  const password = $('new-password').value;

  if (!full_name || !username || !password) { showToast('Todos los campos son requeridos', 'error'); return; }

  try {
    const res = await fetch('/api/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ full_name, username, password })
    });
    const data = await res.json();
    if (!res.ok) { showToast(data.error || 'Error', 'error'); return; }
    showToast('Usuario creado');
    $('new-fullname').value = '';
    $('new-username').value = '';
    $('new-password').value = '';
    loadUsers();
  } catch (err) {
    showToast('Error al crear usuario', 'error');
  }
}

async function deleteUser(id, name) {
  if (!confirm(`¿Eliminar al usuario "${name}"?`)) return;
  try {
    const res = await fetch(`/api/users/${id}`, { method: 'DELETE' });
    if (!res.ok) { const d = await res.json(); showToast(d.error || 'Error', 'error'); return; }
    showToast('Usuario eliminado');
    loadUsers();
  } catch (err) {
    showToast('Error al eliminar usuario', 'error');
  }
}

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
  loadFiles();
  renderCharts();
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
    renderCharts();
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
    renderCharts();
  } catch (err) {
    showToast('Error al eliminar tarea', 'error');
  }
}

// ==================== CHARTS ====================
let statusChart = null;
let priorityChart = null;

async function renderCharts() {
  if (typeof Chart === 'undefined') return;

  const res = await fetch(`/api/projects/${currentProjectId}/tasks`);
  const tasks = await res.json();

  if (tasks.length === 0) {
    $('charts-section').classList.add('hidden');
    return;
  }

  $('charts-section').classList.remove('hidden');

  // Count by status
  const statusCounts = { pending: 0, in_progress: 0, blocked: 0, completed: 0 };
  tasks.forEach(t => { if (statusCounts[t.status] !== undefined) statusCounts[t.status]++; });

  // Count by priority
  const priorityCounts = { low: 0, medium: 0, high: 0, critical: 0 };
  tasks.forEach(t => { if (priorityCounts[t.priority] !== undefined) priorityCounts[t.priority]++; });

  // Destroy old charts
  if (statusChart) { statusChart.destroy(); statusChart = null; }
  if (priorityChart) { priorityChart.destroy(); priorityChart = null; }

  // Status donut chart
  const statusCtx = $('status-chart').getContext('2d');
  statusChart = new Chart(statusCtx, {
    type: 'doughnut',
    data: {
      labels: ['Pendientes', 'En progreso', 'Bloqueadas', 'Completadas'],
      datasets: [{
        data: [statusCounts.pending, statusCounts.in_progress, statusCounts.blocked, statusCounts.completed],
        backgroundColor: ['#999999', '#0066cc', '#c92a2a', '#1a8c4e'],
        borderWidth: 0,
        hoverOffset: 4
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: '65%',
      plugins: {
        legend: {
          position: 'bottom',
          labels: { font: { size: 11, family: '-apple-system, sans-serif' }, padding: 12, usePointStyle: true, pointStyle: 'circle' }
        }
      }
    }
  });

  // Priority bar chart
  const priorityCtx = $('priority-chart').getContext('2d');
  priorityChart = new Chart(priorityCtx, {
    type: 'bar',
    data: {
      labels: ['Baja', 'Media', 'Alta', 'Critica'],
      datasets: [{
        label: 'Tareas',
        data: [priorityCounts.low, priorityCounts.medium, priorityCounts.high, priorityCounts.critical],
        backgroundColor: ['#bbbbbb', '#d4850a', '#e85d04', '#c92a2a'],
        borderWidth: 0,
        borderRadius: 4
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false }
      },
      scales: {
        y: {
          beginAtZero: true,
          ticks: { stepSize: 1, font: { size: 11 } },
          grid: { color: '#f0f0f0' }
        },
        x: {
          grid: { display: false },
          ticks: { font: { size: 11 } }
        }
      }
    }
  });
}

// ==================== HELPERS ====================
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// ==================== FILES ====================
async function loadFiles() {
  try {
    const res = await fetch(`/api/projects/${currentProjectId}/files`);
    const files = await res.json();

    if (files.length === 0) {
      $('files-list').innerHTML = '';
      $('no-files').classList.remove('hidden');
      return;
    }

    $('no-files').classList.add('hidden');
    $('files-list').innerHTML = files.map(f => `
      <div class="file-item">
        <div class="file-info">
          <span class="file-icon">${getFileIcon(f.mimetype)}</span>
          <div>
            <a href="/api/files/${f.id}/download" class="file-name" download="${escapeHtml(f.filename)}">${escapeHtml(f.filename)}</a>
            <small class="text-muted">${formatFileSize(f.size)} &bull; ${formatDate(f.uploaded_at)}</small>
          </div>
        </div>
        <button class="btn-icon" onclick="deleteFile('${f.id}')" title="Eliminar">&#128465;</button>
      </div>
    `).join('');
  } catch (err) {
    showToast('Error al cargar archivos', 'error');
  }
}

async function uploadFile(event) {
  const files = event.target.files;
  if (!files.length) return;

  for (const file of files) {
    if (file.size > 10 * 1024 * 1024) {
      showToast(`${file.name} es muy grande (max 10MB)`, 'error');
      continue;
    }

    const reader = new FileReader();
    reader.onload = async function(e) {
      const base64 = e.target.result.split(',')[1];
      try {
        const res = await fetch(`/api/projects/${currentProjectId}/files`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            filename: file.name,
            mimetype: file.type,
            data: base64
          })
        });
        if (!res.ok) throw new Error('Error al subir');
        showToast(`${file.name} subido`);
        loadFiles();
      } catch (err) {
        showToast(`Error al subir ${file.name}`, 'error');
      }
    };
    reader.readAsDataURL(file);
  }
  event.target.value = '';
}

async function deleteFile(fileId) {
  if (!confirm('¿Eliminar este archivo?')) return;
  try {
    await fetch(`/api/files/${fileId}`, { method: 'DELETE' });
    showToast('Archivo eliminado');
    loadFiles();
  } catch (err) {
    showToast('Error al eliminar archivo', 'error');
  }
}

function getFileIcon(mimetype) {
  if (!mimetype) return '&#128196;';
  if (mimetype.includes('pdf')) return '&#128213;';
  if (mimetype.includes('image')) return '&#128247;';
  if (mimetype.includes('word') || mimetype.includes('document')) return '&#128196;';
  if (mimetype.includes('sheet') || mimetype.includes('excel')) return '&#128202;';
  if (mimetype.includes('presentation') || mimetype.includes('powerpoint')) return '&#128218;';
  if (mimetype.includes('zip') || mimetype.includes('rar') || mimetype.includes('compress')) return '&#128230;';
  if (mimetype.includes('text')) return '&#128221;';
  return '&#128196;';
}

function formatFileSize(bytes) {
  if (!bytes) return '0 B';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

// ==================== INIT ====================
document.addEventListener('DOMContentLoaded', async () => {
  const authenticated = await checkAuth();
  if (authenticated) loadProjects();
});
