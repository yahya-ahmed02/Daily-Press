const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');
require('dotenv').config();

async function setup() {
  // Connect without database first to create it
  const conn = await mysql.createConnection({
    host:     process.env.DB_HOST     || 'localhost',
    port:     process.env.DB_PORT     || 3306,
    user:     process.env.DB_USER     || 'root',
    password: process.env.DB_PASSWORD || '',
  });

  const db = process.env.DB_NAME || 'daily_press';
  console.log(`Creating database "${db}" if not exists…`);
  await conn.query(`CREATE DATABASE IF NOT EXISTS \`${db}\``);
  await conn.query(`USE \`${db}\``);

  // ── Tables ──────────────────────────────────────────────────────────────────

  await conn.query(`
    CREATE TABLE IF NOT EXISTS users (
      id         INT AUTO_INCREMENT PRIMARY KEY,
      username   VARCHAR(50)  NOT NULL UNIQUE,
      email      VARCHAR(100) NOT NULL UNIQUE,
      password   VARCHAR(255) NOT NULL,
      role       ENUM('admin','editor','viewer') NOT NULL DEFAULT 'viewer',
      is_active  TINYINT(1) NOT NULL DEFAULT 1,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await conn.query(`
    CREATE TABLE IF NOT EXISTS articles (
      id          INT AUTO_INCREMENT PRIMARY KEY,
      title       VARCHAR(255) NOT NULL,
      content     TEXT NOT NULL,
      author_id   INT NOT NULL,
      status      ENUM('draft','published') NOT NULL DEFAULT 'draft',
      created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      FOREIGN KEY (author_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);

  await conn.query(`
    CREATE TABLE IF NOT EXISTS audit_logs (
      id         INT AUTO_INCREMENT PRIMARY KEY,
      action     VARCHAR(100) NOT NULL,
      user_id    INT,
      details    JSON,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
    )
  `);

  // ── Seed Default Users ───────────────────────────────────────────────────────
  const [existing] = await conn.query('SELECT COUNT(*) as count FROM users');
  if (existing[0].count === 0) {
    console.log('Seeding default users…');

    const adminHash  = await bcrypt.hash('Admin@123',  12);
    const editorHash = await bcrypt.hash('Editor@123', 12);
    const viewerHash = await bcrypt.hash('Viewer@123', 12);

    await conn.query(`
      INSERT INTO users (username, email, password, role) VALUES
        ('admin',  'admin@press.com',  ?, 'admin'),
        ('editor', 'editor@press.com', ?, 'editor'),
        ('viewer', 'viewer@press.com', ?, 'viewer')
    `, [adminHash, editorHash, viewerHash]);

    // Get editor id for sample articles
    const [[editor]] = await conn.query(`SELECT id FROM users WHERE username = 'editor'`);

    await conn.query(`
      INSERT INTO articles (title, content, author_id, status) VALUES
        (
          'Welcome to The Daily Press',
          'This is your secure newspaper platform. Editors can write articles and submit drafts. The admin reviews and publishes them. Viewers can read all published content.\n\nThe platform uses role-based access control to ensure every user only sees and does what they are supposed to.',
          ?, 'published'
        ),
        (
          'Understanding Role-Based Access Control',
          'Role-Based Access Control (RBAC) is a method of restricting system access to authorized users.\n\nIn this system:\n- Admin users can manage users, publish articles, view audit logs, and delete any content.\n- Editor users can write articles, edit their own drafts, and delete their own articles.\n- Viewer users can only read published articles.\n\nThis separation of duties is a fundamental security principle.',
          ?, 'published'
        ),
        (
          'Draft: Upcoming Security Features',
          'This article is still in draft mode. Only the admin can publish it.\n\nWe plan to add two-factor authentication, password expiry policies, and session management in the next update.',
          ?, 'draft'
        )
    `, [editor.id, editor.id, editor.id]);

    console.log('✅ Default users and sample articles created.');
    console.log('   admin  / Admin@123');
    console.log('   editor / Editor@123');
    console.log('   viewer / Viewer@123');
  } else {
    console.log('ℹ️  Users already exist — skipping seed.');
  }

  await conn.end();
  console.log('✅ Database setup complete!');
}

setup().catch((err) => {
  console.error('❌ Setup failed:', err.message);
  process.exit(1);
});
