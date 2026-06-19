const express = require('express');
const session = require('express-session');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { initDb, getDb, persist } = require('./database');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json({ limit: '15mb' }));
app.use(session({
  secret: 'adama-it-tracker-2026-secret-key',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 24 * 60 * 60 * 1000 } // 24 hours
}));

// Static files (login page accessible without auth)
app.use('/login.html', express.static(path.join(__dirname, 'public', 'login.html')));
app.use('/styles.css', express.static(path.join(__dirname, 'public', 'styles.css')));
app.use('/adama-logo.svg', express.static(path.join(__dirname, 'public', 'adama-logo.svg')));

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

// ==================== AUTH API ====================

// Login
app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Usuario y contraseña requeridos' });

  const user = get('SELECT id, username, full_name, role FROM users WHERE username = ? AND password = ?', [username, password]);
  if (!user) return res.status(401).json({ error: 'Usuario o contraseña incorrectos' });

  req.session.userId = user.id;
  req.session.username = user.username;
  req.session.fullName = user.full_name;
  req.session.role = user.role;
  res.json({ user: { id: user.id, username: user.username, full_name: user.full_name, role: user.role } });
});

// Logout
app.post('/api/logout', (req, res) => {
  req.session.destroy();
  res.json({ message: 'Sesión cerrada' });
});

// Get current user
app.get('/api/me', (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: 'No autenticado' });
  res.json({ id: req.session.userId, username: req.session.username, full_name: req.session.fullName, role: req.session.role });
});

// Auth middleware - protect all API routes below (except shared)
function requireAuth(req, res, next) {
  if (req.session.userId) return next();
  res.status(401).json({ error: 'No autenticado' });
}

// Protect static files (except login page and shared views)
app.use((req, res, next) => {
  // Allow shared views without auth
  if (req.path.startsWith('/shared/') || req.path.startsWith('/api/shared/')) return next();
  // Allow login-related paths
  if (req.path === '/login.html' || req.path === '/styles.css' || req.path === '/adama-logo.svg') return next();
  if (req.path.startsWith('/api/login') || req.path.startsWith('/api/logout')) return next();
  // Check auth for everything else
  if (!req.session.userId) {
    if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'No autenticado' });
    return res.redirect('/login.html');
  }
  next();
});

// Serve static files for authenticated users
app.use(express.static(path.join(__dirname, 'public')));

// ==================== USERS API (admin only) ====================

app.get('/api/users', requireAuth, (req, res) => {
  if (req.session.role !== 'admin') return res.status(403).json({ error: 'Sin permisos' });
  const users = all('SELECT id, username, full_name, role, created_at FROM users ORDER BY created_at');
  res.json(users);
});

app.post('/api/users', requireAuth, (req, res) => {
  if (req.session.role !== 'admin') return res.status(403).json({ error: 'Sin permisos' });
  const { username, password, full_name } = req.body;
  if (!username || !password || !full_name) return res.status(400).json({ error: 'Todos los campos son requeridos' });

  const existing = get('SELECT id FROM users WHERE username = ?', [username]);
  if (existing) return res.status(400).json({ error: 'El usuario ya existe' });

  const id = uuidv4();
  run('INSERT INTO users (id, username, password, full_name, role) VALUES (?, ?, ?, ?, ?)',
    [id, username, password, full_name, 'admin']);

  res.status(201).json({ id, username, full_name, role: 'admin' });
});

app.delete('/api/users/:id', requireAuth, (req, res) => {
  if (req.session.role !== 'admin') return res.status(403).json({ error: 'Sin permisos' });
  if (req.params.id === req.session.userId) return res.status(400).json({ error: 'No puedes eliminarte a ti mismo' });

  const user = get('SELECT id FROM users WHERE id = ?', [req.params.id]);
  if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });

  run('DELETE FROM users WHERE id = ?', [req.params.id]);
  res.json({ message: 'Usuario eliminado' });
});

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
