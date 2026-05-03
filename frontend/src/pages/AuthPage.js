import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';

export default function AuthPage() {
  const [mode, setMode]   = useState('login');
  const [form, setForm]   = useState({ username: '', email: '', password: '', role: 'viewer' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { login, register } = useAuth();

  const handle = (e) => setForm((f) => ({ ...f, [e.target.name]: e.target.value }));
  const fill   = (username, password) => setForm((f) => ({ ...f, username, password }));

  async function submit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      if (mode === 'login') {
        await login(form.username, form.password);
      } else {
        await register(form);
        setMode('login');
        alert('Account created! Please sign in.');
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="auth-page">
      <div className="auth-masthead">
        <div className="masthead-line thick" />
        <h1 className="masthead-title">The Daily Press</h1>
        <div className="masthead-line" />
        <p className="masthead-sub">Secure · Verified · Trusted</p>
      </div>

      <div className="auth-card">
        <div className="tab-group">
          <button className={mode === 'login' ? 'active' : ''} onClick={() => setMode('login')}>
            Sign In
          </button>
          <button className={mode === 'register' ? 'active' : ''} onClick={() => setMode('register')}>
            Register
          </button>
        </div>

        <form onSubmit={submit}>
          <div className="field">
            <label>Username</label>
            <input name="username" placeholder="Your username" value={form.username} onChange={handle} required />
          </div>
          {mode === 'register' && (
            <div className="field">
              <label>Email</label>
              <input name="email" type="email" placeholder="your@email.com" value={form.email} onChange={handle} required />
            </div>
          )}
          <div className="field">
            <label>Password</label>
            <input name="password" type="password" placeholder="••••••••" value={form.password} onChange={handle} required />
          </div>
          {mode === 'register' && (
            <div className="field">
              <label>Role</label>
              <select name="role" value={form.role} onChange={handle}>
                <option value="viewer">Reader — browse articles</option>
                <option value="editor">Editor — write and manage drafts</option>
              </select>
            </div>
          )}

          {error && <div className="error-msg">⚠ {error}</div>}

          <button type="submit" className="submit-btn" disabled={loading}>
            {loading ? <span className="spinner" /> : mode === 'login' ? 'Enter The Press' : 'Create Account'}
          </button>
        </form>

        {mode === 'login' && (
          <div className="demo-creds">
            <p className="demo-title">Demo Credentials</p>
            <div className="cred-list">
              <div onClick={() => fill('admin', 'Admin@123')} className="cred-item">
                <span className="cred-role admin">Admin</span>
                <span className="cred-info">Publish, manage users, view logs</span>
              </div>
              <div onClick={() => fill('editor', 'Editor@123')} className="cred-item">
                <span className="cred-role editor">Editor</span>
                <span className="cred-info">Write, edit and delete own articles</span>
              </div>
              <div onClick={() => fill('viewer', 'Viewer@123')} className="cred-item">
                <span className="cred-role viewer">Viewer</span>
                <span className="cred-info">Read published articles only</span>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
