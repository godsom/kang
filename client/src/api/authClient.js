const AUTH_URL = import.meta.env.VITE_AUTH_URL || 'http://localhost:4000';

async function postCredentials(path, username, password) {
  const res = await fetch(`${AUTH_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  const body = await res.json();
  if (!res.ok) {
    throw new Error(body.message || 'Request failed');
  }
  return { token: body.token, userId: body.user.id, username: body.user.username };
}

function login(username, password) {
  return postCredentials('/login', username, password);
}

function register(username, password) {
  return postCredentials('/register', username, password);
}

export { login, register };
