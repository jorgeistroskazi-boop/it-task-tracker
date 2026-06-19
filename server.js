const express = require('express');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { initDb, getDb, persist } = require('./database');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json({ limit: '15mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Helper: run query and return all rows as objects
function all(sql, params = []) {
  const db = getDb();
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const rows = [];
  while (stmt.step()) rows.push(stmt.getAsObject());
  stmt.free();
  return rows;
}

// Helper: run query and return first row
function get(sql, params = []) {
  const rows = all(sql, params);
  return rows[0] || null;
}

// Helper: run statement (INSERT/UPDATE/DELETE)
function run(sql, params = []) {
  const db = getDb();
  db.run(sql, params);
  persist();
}

// ==================== PROJECTS API ====================

app.get('/api/projects', (req, res) => {
  const projects = all(`
    SELECT p.*,
      COUNT(t.id) as total_tasks,
      SUM(CASE WHEN t.status = 'completed' THEN 1 ELSE 0 END) as completed_tasks,
      SUM(CASE WHEN t.status = 'blocked' THEN 1 ELSE 0 END) as blocked_tasks
    FROM projects p
    LEFT JOIN tasks t ON t.project_id = p.id
    GROUP BY p.id
    ORDER BY p.updated_at DESC
  `);
  res.json(projects);
});

app.post('/api/projects', (req, res) => {
  const { name, description } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: 'El nombre del proyecto es requerido' });

  const id = uuidv4();
  const share_token = uuidv4().replace(/-/g, '').substring(0, 12);

  run(`INSERT INTO projects (id, name, description, share_token) VALUES (?, ?, ?, ?)`,
    [id, name.trim(), description || '', share_token]);

  const project = get('SELECT * FROM projects WHERE id = ?', [id]);
  res.status(201).json(project);
});

app.get('/api/projects/:id', (req, res) => {
  const project = get(`
    SELECT p.*,
      COUNT(t.id) as total_tasks,
      SUM(CASE WHEN t.status = 'completed' THEN 1 ELSE 0 END) as completed_tasks,
      SUM(CASE WHEN t.status = 'blocked' THEN 1 ELSE 0 END) as blocked_tasks
    FROM projects p
    LEFT JOIN tasks t ON t.project_id = p.id
    WHERE p.id = ?
    GROUP BY p.id
  `, [req.params.id]);

  if (!project) return res.status(404).json({ error: 'Proyecto no encontrado' });
  res.json(project);
});

app.put('/api/projects/:id', (req, res) => {
  const { name, description } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: 'El nombre del proyecto es requerido' });

  run(`UPDATE projects SET name = ?, description = ?, updated_at = datetime('now') WHERE id = ?`,
    [name.trim(), description || '', req.params.id]);

  const project = get('SELECT * FROM projects WHERE id = ?', [req.params.id]);
  if (!project) return res.status(404).json({ error: 'Proyecto no encontrado' });
  res.json(project);
});

app.delete('/api/projects/:id', (req, res) => {
  const project = get('SELECT id FROM projects WHERE id = ?', [req.params.id]);
  if (!project) return res.status(404).json({ error: 'Proyecto no encontrado' });
  run('DELETE FROM tasks WHERE project_id = ?', [req.params.id]);
  run('DELETE FROM projects WHERE id = ?', [req.params.id]);
  res.json({ message: 'Proyecto eliminado' });
});

// ==================== TASKS API ====================

app.get('/api/projects/:projectId/tasks', (req, res) => {
  const { status, priority } = req.query;
  let sql = 'SELECT * FROM tasks WHERE project_id = ?';
  const params = [req.params.projectId];

  if (status) { sql += ' AND status = ?'; params.push(status); }
  if (priority) { sql += ' AND priority = ?'; params.push(priority); }

  sql += ` ORDER BY CASE priority WHEN 'critical' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 WHEN 'low' THEN 4 END, created_at DESC`;

  res.json(all(sql, params));
});

app.post('/api/projects/:projectId/tasks', (req, res) => {
  const { title, description, status, priority, assigned_to, notes, due_date } = req.body;
  if (!title || !title.trim()) return res.status(400).json({ error: 'El titulo de la tarea es requerido' });

  const project = get('SELECT id FROM projects WHERE id = ?', [req.params.projectId]);
  if (!project) return res.status(404).json({ error: 'Proyecto no encontrado' });

  const id = uuidv4();
  run(`INSERT INTO tasks (id, project_id, title, description, status, priority, assigned_to, notes, due_date)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, req.params.projectId, title.trim(), description || '', status || 'pending', priority || 'medium', assigned_to || '', notes || '', due_date || null]);

  run(`UPDATE projects SET updated_at = datetime('now') WHERE id = ?`, [req.params.projectId]);

  const task = get('SELECT * FROM tasks WHERE id = ?', [id]);
  res.status(201).json(task);
});

app.put('/api/tasks/:id', (req, res) => {
  const { title, description, status, priority, assigned_to, notes, due_date } = req.body;
  if (!title || !title.trim()) return res.status(400).json({ error: 'El titulo de la tarea es requerido' });

  const existing = get('SELECT * FROM tasks WHERE id = ?', [req.params.id]);
  if (!existing) return res.status(404).json({ error: 'Tarea no encontrada' });

  run(`UPDATE tasks SET title=?, description=?, status=?, priority=?, assigned_to=?, notes=?, due_date=?, updated_at=datetime('now') WHERE id=?`,
    [title.trim(), description || '', status || existing.status, priority || existing.priority, assigned_to || '', notes || '', due_date || null, req.params.id]);

  run(`UPDATE projects SET updated_at = datetime('now') WHERE id = ?`, [existing.project_id]);

  const task = get('SELECT * FROM tasks WHERE id = ?', [req.params.id]);
  res.json(task);
});

app.delete('/api/tasks/:id', (req, res) => {
  const task = get('SELECT project_id FROM tasks WHERE id = ?', [req.params.id]);
  if (!task) return res.status(404).json({ error: 'Tarea no encontrada' });

  run('DELETE FROM tasks WHERE id = ?', [req.params.id]);
  run(`UPDATE projects SET updated_at = datetime('now') WHERE id = ?`, [task.project_id]);
  res.json({ message: 'Tarea eliminada' });
});

// ==================== FILES API ====================

// Get files for a project (metadata only)
app.get('/api/projects/:projectId/files', (req, res) => {
  const files = all('SELECT id, project_id, filename, mimetype, size, uploaded_at FROM files WHERE project_id = ? ORDER BY uploaded_at DESC', [req.params.projectId]);
  res.json(files);
});

// Upload file (base64 encoded)
app.post('/api/projects/:projectId/files', (req, res) => {
  const { filename, mimetype, data } = req.body;
  if (!filename || !data) return res.status(400).json({ error: 'Archivo requerido' });

  const project = get('SELECT id FROM projects WHERE id = ?', [req.params.projectId]);
  if (!project) return res.status(404).json({ error: 'Proyecto no encontrado' });

  const id = uuidv4();
  const size = Math.round((data.length * 3) / 4); // approx size from base64

  run(`INSERT INTO files (id, project_id, filename, mimetype, size, data) VALUES (?, ?, ?, ?, ?, ?)`,
    [id, req.params.projectId, filename, mimetype || 'application/octet-stream', size, data]);

  res.status(201).json({ id, project_id: req.params.projectId, filename, mimetype, size, uploaded_at: new Date().toISOString() });
});

// Download file
app.get('/api/files/:id/download', (req, res) => {
  const file = get('SELECT * FROM files WHERE id = ?', [req.params.id]);
  if (!file) return res.status(404).json({ error: 'Archivo no encontrado' });

  const buffer = Buffer.from(file.data, 'base64');
  res.setHeader('Content-Type', file.mimetype || 'application/octet-stream');
  res.setHeader('Content-Disposition', `attachment; filename="${file.filename}"`);
  res.send(buffer);
});

// Delete file
app.delete('/api/files/:id', (req, res) => {
  const file = get('SELECT id FROM files WHERE id = ?', [req.params.id]);
  if (!file) return res.status(404).json({ error: 'Archivo no encontrado' });
  run('DELETE FROM files WHERE id = ?', [req.params.id]);
  res.json({ message: 'Archivo eliminado' });
});

// ==================== SHARED VIEW ====================

app.get('/api/shared/:token', (req, res) => {
  const project = get(`
    SELECT p.*,
      COUNT(t.id) as total_tasks,
      SUM(CASE WHEN t.status = 'completed' THEN 1 ELSE 0 END) as completed_tasks,
      SUM(CASE WHEN t.status = 'blocked' THEN 1 ELSE 0 END) as blocked_tasks
    FROM projects p
    LEFT JOIN tasks t ON t.project_id = p.id
    WHERE p.share_token = ?
    GROUP BY p.id
  `, [req.params.token]);

  if (!project) return res.status(404).json({ error: 'Proyecto no encontrado' });

  const tasks = all(`SELECT * FROM tasks WHERE project_id = ?
    ORDER BY CASE priority WHEN 'critical' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 WHEN 'low' THEN 4 END, created_at DESC`,
    [project.id]);

  const files = all('SELECT id, filename, mimetype, size, uploaded_at FROM files WHERE project_id = ? ORDER BY uploaded_at DESC', [project.id]);

  res.json({ project, tasks, files });
});

// ==================== HTML ROUTES ====================

app.get('/shared/:token', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'shared.html'));
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ==================== START ====================

async function start() {
  await initDb();
  app.listen(PORT, () => {
    console.log(`\n  IT Task Tracker corriendo en: http://localhost:${PORT}`);
    console.log(`  Listo para gestionar tus proyectos IT\n`);
  });
}

start().catch(err => {
  console.error('Error al iniciar:', err);
  process.exit(1);
});
