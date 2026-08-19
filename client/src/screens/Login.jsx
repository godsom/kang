import { useState } from 'react';
import { login, register } from '../api/authClient.js';
import Button from '../components/Button.jsx';

function Login({ onAuthenticated }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);

  async function handleSubmit(action) {
    setError(null);
    try {
      const result = await action(username, password);
      onAuthenticated(result);
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="w-full max-w-sm rounded-2xl bg-felt-900/80 border border-gold-500/30 shadow-card backdrop-blur-sm p-8">
        <h1 className="font-display text-5xl font-bold text-gold-400 text-center mb-8 tracking-wide">Kaeng</h1>

        <label className="block mb-4">
          <span className="block text-cream-50/70 text-sm mb-1">Username</span>
          <input
            className="w-full rounded-lg bg-white/5 border border-white/15 px-4 py-2.5 text-cream-50 focus:outline-none focus:border-gold-400 focus:ring-1 focus:ring-gold-400"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
          />
        </label>

        <label className="block mb-6">
          <span className="block text-cream-50/70 text-sm mb-1">Password</span>
          <input
            className="w-full rounded-lg bg-white/5 border border-white/15 px-4 py-2.5 text-cream-50 focus:outline-none focus:border-gold-400 focus:ring-1 focus:ring-gold-400"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>

        <div className="flex gap-3">
          <Button className="flex-1" onClick={() => handleSubmit(login)}>
            Log in
          </Button>
          <Button variant="ghost" className="flex-1" onClick={() => handleSubmit(register)}>
            Register
          </Button>
        </div>

        {error && (
          <p role="alert" className="mt-4 text-center text-red-400 text-sm">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}

export default Login;
