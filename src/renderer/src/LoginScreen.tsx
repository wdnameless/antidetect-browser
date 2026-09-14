import React, { useState, useEffect } from 'react';
import { getApiBase } from './api';

interface LoginScreenProps {
  onSuccess: (token: string) => void;
}

export const LoginScreen: React.FC<LoginScreenProps> = ({ onSuccess }) => {
  const [loading, setLoading] = useState(true);
  const [isSetup, setIsSetup] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    checkAuthState();
  }, []);

  const checkAuthState = async () => {
    try {
      setLoading(true);
      setError('');
      const base = getApiBase();
      const res = await fetch(`${base}/ui/auth-state`);
      const data = (await res.json()) as { code: number; data?: { hasPassword?: boolean } };
      if (data && data.code === 0 && data.data) {
        // Server contract (panelAuth.ts): `hasPassword` — absent means first run,
        // so the operator must set a credential rather than be offered a login.
        setIsSetup(!data.data.hasPassword);
      } else {
        setIsSetup(false);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to connect to authentication service';
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!username.trim() || !password.trim()) {
      setError('Please enter both username and password');
      return;
    }

    if (isSetup && password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    try {
      setSubmitting(true);
      const base = getApiBase();
      const endpoint = isSetup ? '/ui/setup' : '/ui/login';
      const res = await fetch(`${base}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: username.trim(), password: password.trim() }),
      });

      const data = (await res.json()) as { code: number; msg?: string; data?: { token?: string } };
      if (!res.ok || data.code !== 0) {
        setError(data.msg || (isSetup ? 'Setup failed' : 'Invalid credentials'));
        return;
      }

      const token = data.data?.token;
      if (!token) {
        setError('No authentication token received');
        return;
      }

      localStorage.setItem('apiKey', token);
      onSuccess(token);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Authentication request failed';
      setError(msg);
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="login-screen-wrap" style={{ display: 'flex', minHeight: '100vh', alignItems: 'center', justifyContent: 'center' }}>
        <div className="loading" style={{ padding: '2rem' }}>Checking authorization state...</div>
      </div>
    );
  }

  return (
    <div
      className="login-screen-wrap"
      style={{
        display: 'flex',
        minHeight: '100vh',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'var(--bg-app)',
        color: 'var(--text)',
      }}
    >
      <div
        className="card"
        style={{
          width: '100%',
          maxWidth: '400px',
          margin: '1.5rem',
          padding: '2rem',
          // No box border: the surface step separates it from the app ground, the
          // same rule the rest of the chrome follows.
          borderRadius: 'var(--radius-lg)',
          backgroundColor: 'var(--surface-1)',
        }}
      >
        <h2 style={{ marginTop: 0, marginBottom: '0.5rem', fontSize: '1.25rem', fontWeight: 600 }}>
          {isSetup ? 'Initial Setup' : 'Sign In'}
        </h2>
        <p style={{ marginTop: 0, marginBottom: '1.5rem', fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
          {isSetup
            ? 'Set the administrator credentials for this instance.'
            : 'Enter credentials to access the browser workspace.'}
        </p>

        {error && (
          <div
            className="error-banner"
            style={{
              marginBottom: '1rem',
              padding: '0.75rem',
              // A failed sign-in must still read as a failure without hue, so the
              // distinction is a stronger background step plus a left rule rather
              // than a red tint.
              backgroundColor: 'var(--control-bg-selected)',
              borderLeft: '3px solid var(--text)',
              borderRadius: 'var(--radius-sm)',
              color: 'var(--text)',
              fontSize: '0.875rem',
            }}
          >
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <div>
            <label style={{ display: 'block', marginBottom: '0.25rem', fontSize: '0.8125rem' }}>
              Username
            </label>
            <input
              type="text"
              className="input"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="admin"
              disabled={submitting}
              autoFocus
              style={{ width: '100%' }}
            />
          </div>

          <div>
            <label style={{ display: 'block', marginBottom: '0.25rem', fontSize: '0.8125rem' }}>
              Password
            </label>
            <input
              type="password"
              className="input"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              disabled={submitting}
              style={{ width: '100%' }}
            />
          </div>

          {isSetup && (
            <div>
              <label style={{ display: 'block', marginBottom: '0.25rem', fontSize: '0.8125rem' }}>
                Confirm Password
              </label>
              <input
                type="password"
                className="input"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="••••••••"
                disabled={submitting}
                style={{ width: '100%' }}
              />
            </div>
          )}

          <button
            type="submit"
            className="btn btn-primary"
            disabled={submitting}
            style={{ marginTop: '0.5rem', width: '100%' }}
          >
            {submitting ? 'Submitting...' : isSetup ? 'Complete Setup' : 'Sign In'}
          </button>
        </form>
      </div>
    </div>
  );
};
