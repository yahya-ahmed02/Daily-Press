const express = require('express');
const cors    = require('cors');
const bcrypt  = require('bcryptjs');
const jwt     = require('jsonwebtoken');
const pool    = require('./db/pool');
require('dotenv').config();

const app = express();
app.use(express.json());
app.use(cors());

const JWT_SECRET     = process.env.JWT_SECRET     || 'change-me';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '2h';

// ─── RBAC Permissions ────────────────────────────────────────────────────────
const PERMISSIONS = {
  admin:  ['read', 'write', 'delete_own', 'delete_any', 'publish', 'manage_users', 'view_logs'],
  editor: ['read', 'write', 'delete_own'],
  viewer: ['read'],
};

// ─── Helpers ─────────────────────────────────────────────────────────────────
function getPermissions(role) {
  return PERMISSIONS[role] || [];
}

async function logAudit(userId, action, details = {}) {
  try {
    await pool.query(
      'INSERT INTO audit_logs (user_id, action, details) VALUES (?, ?, ?)',
      [userId || null, action, JSON.stringify(details)]
    );
  } catch (e) {
    console.error('Audit log error:', e.message);
  }
}

// ─── Middleware ───────────────────────────────────────────────────────────────
function authenticate(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth?.startsWith('Bearer ')) return res.status(401).json({ error: 'No token provided' });
  try {
    req.user = jwt.verify(auth.split(' ')[1], JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}

function authorize(...perms) {
  return (req, res, next) => {
    const userPerms = getPermissions(req.user.role);
    const ok = perms.every((p) => userPerms.includes(p));
    if (!ok) {
      logAudit(req.user.id, 'PERMISSION_DENIED', { required: perms, role: req.user.role });
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    next();
  };
}

// ─── AUTH ─────────────────────────────────────────────────────────────────────

// POST /api/auth/register
app.post('/api/auth/register', async (req, res) => {
  const { username, email, password, role = 'viewer' } = req.body;
  if (!username || !email || !password)
    return res.status(400).json({ error: 'All fields are required' });
  if (password.length < 8)
    return res.status(400).json({ error: 'Password must be at least 8 characters' });
  if (!['viewer', 'editor'].includes(role))
    return res.status(400).json({ error: 'Invalid role' });

  try {
    const hash = await bcrypt.hash(password, 12);
    const [result] = await pool.query(
      'INSERT INTO users (username, email, password, role) VALUES (?, ?, ?, ?)',
      [username, email, hash, role]
    );
    await logAudit(result.insertId, 'USER_REGISTERED', { username, role });
    res.status(201).json({ message: 'Registered successfully' });
  } catch (e) {
    if (e.code === 'ER_DUP_ENTRY')
      return res.status(409).json({ error: 'Username or email already exists' });
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/auth/login
app.post('/api/auth/login', async (req, res) => {
  const { username, password } = req.body;
  try {
    const [[user]] = await pool.query('SELECT * FROM users WHERE username = ?', [username]);
    if (!user || !(await bcrypt.compare(password, user.password))) {
      await logAudit(null, 'LOGIN_FAILED', { username });
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    if (!user.is_active)
      return res.status(403).json({ error: 'Account is deactivated' });

    const token = jwt.sign(
      { id: user.id, username: user.username, role: user.role, email: user.email },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES_IN }
    );

    await logAudit(user.id, 'LOGIN_SUCCESS', {});
    res.json({
      token,
      user: {
        id:          user.id,
        username:    user.username,
        email:       user.email,
        role:        user.role,
        permissions: getPermissions(user.role),
      },
    });
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/auth/me
app.get('/api/auth/me', authenticate, async (req, res) => {
  try {
    const [[user]] = await pool.query(
      'SELECT id, username, email, role, created_at FROM users WHERE id = ?',
      [req.user.id]
    );
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json({ ...user, permissions: getPermissions(user.role) });
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ─── ARTICLES ─────────────────────────────────────────────────────────────────

// GET /api/articles
app.get('/api/articles', authenticate, authorize('read'), async (req, res) => {
  try {
    let query, params;
    if (req.user.role === 'viewer') {
      query  = `SELECT a.*, u.username AS author_name FROM articles a JOIN users u ON a.author_id = u.id WHERE a.status = 'published' ORDER BY a.created_at DESC`;
      params = [];
    } else if (req.user.role === 'editor') {
      // Editors see published articles + their own drafts
      query  = `SELECT a.*, u.username AS author_name FROM articles a JOIN users u ON a.author_id = u.id WHERE a.status = 'published' OR a.author_id = ? ORDER BY a.created_at DESC`;
      params = [req.user.id];
    } else {
      // Admin sees everything
      query  = `SELECT a.*, u.username AS author_name FROM articles a JOIN users u ON a.author_id = u.id ORDER BY a.created_at DESC`;
      params = [];
    }
    const [articles] = await pool.query(query, params);
    res.json(articles);
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/articles/:id
app.get('/api/articles/:id', authenticate, authorize('read'), async (req, res) => {
  try {
    const [[article]] = await pool.query(
      `SELECT a.*, u.username AS author_name FROM articles a JOIN users u ON a.author_id = u.id WHERE a.id = ?`,
      [req.params.id]
    );
    if (!article) return res.status(404).json({ error: 'Article not found' });
    if (article.status === 'draft') {
      if (req.user.role === 'viewer') return res.status(403).json({ error: 'Access denied' });
      if (req.user.role === 'editor' && article.author_id !== req.user.id)
        return res.status(403).json({ error: 'Access denied' });
    }
    res.json(article);
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/articles — editor/admin creates draft
app.post('/api/articles', authenticate, authorize('write'), async (req, res) => {
  const { title, content } = req.body;
  if (!title?.trim() || !content?.trim())
    return res.status(400).json({ error: 'Title and content are required' });
  try {
    const [result] = await pool.query(
      `INSERT INTO articles (title, content, author_id, status) VALUES (?, ?, ?, 'draft')`,
      [title.trim(), content.trim(), req.user.id]
    );
    const [[article]] = await pool.query(
      `SELECT a.*, u.username AS author_name FROM articles a JOIN users u ON a.author_id = u.id WHERE a.id = ?`,
      [result.insertId]
    );
    await logAudit(req.user.id, 'ARTICLE_CREATED', { articleId: result.insertId, title });
    res.status(201).json(article);
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

// PATCH /api/articles/:id — edit title/content
app.patch('/api/articles/:id', authenticate, authorize('write'), async (req, res) => {
  const { title, content } = req.body;
  try {
    const [[article]] = await pool.query('SELECT * FROM articles WHERE id = ?', [req.params.id]);
    if (!article) return res.status(404).json({ error: 'Article not found' });

    // Editor can only edit their own; admin can edit any
    if (req.user.role === 'editor' && article.author_id !== req.user.id)
      return res.status(403).json({ error: 'You can only edit your own articles' });

    await pool.query(
      'UPDATE articles SET title = ?, content = ? WHERE id = ?',
      [title?.trim() || article.title, content?.trim() || article.content, article.id]
    );
    const [[updated]] = await pool.query(
      `SELECT a.*, u.username AS author_name FROM articles a JOIN users u ON a.author_id = u.id WHERE a.id = ?`,
      [article.id]
    );
    await logAudit(req.user.id, 'ARTICLE_UPDATED', { articleId: article.id });
    res.json(updated);
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

// PATCH /api/articles/:id/publish — ADMIN ONLY
app.patch('/api/articles/:id/publish', authenticate, authorize('publish'), async (req, res) => {
  try {
    const [[article]] = await pool.query('SELECT * FROM articles WHERE id = ?', [req.params.id]);
    if (!article) return res.status(404).json({ error: 'Article not found' });

    const newStatus = article.status === 'published' ? 'draft' : 'published';
    await pool.query('UPDATE articles SET status = ? WHERE id = ?', [newStatus, article.id]);
    await logAudit(req.user.id, 'ARTICLE_PUBLISH_CHANGED', { articleId: article.id, status: newStatus });
    res.json({ message: `Article ${newStatus}`, status: newStatus });
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

// DELETE /api/articles/:id
app.delete('/api/articles/:id', authenticate, async (req, res) => {
  try {
    const [[article]] = await pool.query('SELECT * FROM articles WHERE id = ?', [req.params.id]);
    if (!article) return res.status(404).json({ error: 'Article not found' });

    const perms = getPermissions(req.user.role);

    // Admin can delete any; editor can delete only their own
    if (req.user.role === 'editor') {
      if (!perms.includes('delete_own') || article.author_id !== req.user.id)
        return res.status(403).json({ error: 'You can only delete your own articles' });
    } else if (!perms.includes('delete_any')) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }

    await pool.query('DELETE FROM articles WHERE id = ?', [article.id]);
    await logAudit(req.user.id, 'ARTICLE_DELETED', { articleId: article.id, title: article.title });
    res.json({ message: 'Article deleted' });
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ─── USER MANAGEMENT (admin only) ────────────────────────────────────────────

// GET /api/users
app.get('/api/users', authenticate, authorize('manage_users'), async (req, res) => {
  try {
    const [users] = await pool.query(
      'SELECT id, username, email, role, is_active, created_at FROM users ORDER BY created_at ASC'
    );
    res.json(users.map((u) => ({ ...u, permissions: getPermissions(u.role) })));
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

// PATCH /api/users/:id/role
app.patch('/api/users/:id/role', authenticate, authorize('manage_users'), async (req, res) => {
  const { role } = req.body;
  if (!['admin', 'editor', 'viewer'].includes(role))
    return res.status(400).json({ error: 'Invalid role' });
  try {
    const [[user]] = await pool.query('SELECT * FROM users WHERE id = ?', [req.params.id]);
    if (!user) return res.status(404).json({ error: 'User not found' });
    await pool.query('UPDATE users SET role = ? WHERE id = ?', [role, user.id]);
    await logAudit(req.user.id, 'ROLE_CHANGED', { targetUserId: user.id, oldRole: user.role, newRole: role });
    res.json({ message: 'Role updated' });
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

// PATCH /api/users/:id/status
app.patch('/api/users/:id/status', authenticate, authorize('manage_users'), async (req, res) => {
  try {
    const [[user]] = await pool.query('SELECT * FROM users WHERE id = ?', [req.params.id]);
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (user.id === req.user.id) return res.status(400).json({ error: 'Cannot deactivate yourself' });
    const newStatus = user.is_active ? 0 : 1;
    await pool.query('UPDATE users SET is_active = ? WHERE id = ?', [newStatus, user.id]);
    await logAudit(req.user.id, 'USER_STATUS_CHANGED', { targetUserId: user.id, isActive: newStatus });
    res.json({ isActive: newStatus });
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ─── AUDIT LOGS (admin only) ──────────────────────────────────────────────────
app.get('/api/logs', authenticate, authorize('view_logs'), async (req, res) => {
  try {
    const [logs] = await pool.query(
      `SELECT l.*, u.username FROM audit_logs l LEFT JOIN users u ON l.user_id = u.id ORDER BY l.created_at DESC LIMIT 100`
    );
    res.json(logs);
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ─── Start ────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`📰 Daily Press server running on http://localhost:${PORT}`);
  console.log(`🗄️  Connected to MySQL database: ${process.env.DB_NAME}`);
});
