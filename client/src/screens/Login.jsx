import { useState } from 'react';
import { login, register } from '../api/authClient.js';

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
    <div>
      <h1>Kaeng</h1>
      <label>
        Username
        <input value={username} onChange={(e) => setUsername(e.target.value)} />
      </label>
      <label>
        Password
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
      </label>
      <button onClick={() => handleSubmit(login)}>Log in</button>
      <button onClick={() => handleSubmit(register)}>Register</button>
      {error && <p role="alert">{error}</p>}
    </div>
  );
}

export default Login;
