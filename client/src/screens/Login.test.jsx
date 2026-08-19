import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, test, expect, vi } from 'vitest';
import Login from './Login.jsx';
import * as authClient from '../api/authClient.js';

describe('Login screen', () => {
  test('calls onAuthenticated with the login result on submit', async () => {
    vi.spyOn(authClient, 'login').mockResolvedValue({ token: 't', userId: 'u1', username: 'alice' });
    const onAuthenticated = vi.fn();
    render(<Login onAuthenticated={onAuthenticated} />);

    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'alice' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'hunter2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Log in' }));

    await waitFor(() => expect(onAuthenticated).toHaveBeenCalledWith({ token: 't', userId: 'u1', username: 'alice' }));
  });

  test('shows the error message when login fails', async () => {
    vi.spyOn(authClient, 'login').mockRejectedValue(new Error('Invalid username or password'));
    render(<Login onAuthenticated={vi.fn()} />);

    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'alice' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'wrong' } });
    fireEvent.click(screen.getByRole('button', { name: 'Log in' }));

    expect(await screen.findByText('Invalid username or password')).toBeInTheDocument();
  });

  test('register button calls authClient.register instead', async () => {
    vi.spyOn(authClient, 'register').mockResolvedValue({ token: 't2', userId: 'u2', username: 'bob' });
    const onAuthenticated = vi.fn();
    render(<Login onAuthenticated={onAuthenticated} />);

    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'bob' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'hunter2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Register' }));

    await waitFor(() => expect(onAuthenticated).toHaveBeenCalledWith({ token: 't2', userId: 'u2', username: 'bob' }));
  });
});
