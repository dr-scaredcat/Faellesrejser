import { FormEvent, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function LoginPage() {
  const { session, signIn, signUp } = useAuth();
  const navigate = useNavigate();
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (session) return <Navigate to="/" replace />;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setInfo(null);
    setBusy(true);
    try {
      if (mode === 'login') {
        const { error } = await signIn(email, password);
        if (error) setError(error);
        else navigate('/');
      } else {
        const { error } = await signUp(email, password, name);
        if (error) setError(error);
        else setInfo('Tjek din email for at bekræfte din konto, og log derefter ind.');
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-river-50 px-4">
      <div className="card w-full max-w-sm p-6">
        <h1 className="mb-1 text-2xl font-semibold text-river-800">Fællesrejser</h1>
        <p className="mb-6 text-sm text-river-500">
          {mode === 'login' ? 'Log ind for at se jeres rejser.' : 'Opret en konto.'}
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          {mode === 'signup' && (
            <div>
              <label className="label">Navn</label>
              <input className="input" value={name} onChange={(e) => setName(e.target.value)} required />
            </div>
          )}
          <div>
            <label className="label">Email</label>
            <input
              type="email"
              className="input"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>
          <div>
            <label className="label">Adgangskode</label>
            <input
              type="password"
              className="input"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              minLength={6}
              required
            />
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}
          {info && <p className="text-sm text-river-600">{info}</p>}

          <button type="submit" className="btn-primary w-full" disabled={busy}>
            {mode === 'login' ? 'Log ind' : 'Opret konto'}
          </button>
        </form>

        <button
          className="mt-4 text-sm text-river-500 hover:underline"
          onClick={() => {
            setMode(mode === 'login' ? 'signup' : 'login');
            setError(null);
            setInfo(null);
          }}
        >
          {mode === 'login' ? 'Har du ikke en konto? Opret en her.' : 'Har du allerede en konto? Log ind.'}
        </button>
      </div>
    </div>
  );
}
