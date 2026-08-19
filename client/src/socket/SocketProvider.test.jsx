import { render, screen, waitFor } from '@testing-library/react';
import { describe, test, expect, vi, beforeEach } from 'vitest';
import { SocketProvider, useSocket } from './SocketProvider.jsx';

const mockSocket = { on: vi.fn(), off: vi.fn(), emit: vi.fn(), close: vi.fn() };
vi.mock('socket.io-client', () => ({
  default: vi.fn(() => mockSocket),
}));

function Probe() {
  const { connected } = useSocket();
  return <div>{connected ? 'connected' : 'not-connected'}</div>;
}

describe('SocketProvider', () => {
  beforeEach(() => {
    mockSocket.on.mockReset();
    mockSocket.emit.mockReset();
  });

  test('emits auth with the token once the socket connects', async () => {
    render(
      <SocketProvider auth={{ token: 'jwt-abc', userId: 'u1', username: 'alice' }}>
        <Probe />
      </SocketProvider>
    );

    const connectHandler = mockSocket.on.mock.calls.find(([event]) => event === 'connect')[1];
    connectHandler();

    await waitFor(() => expect(mockSocket.emit).toHaveBeenCalledWith('auth', { token: 'jwt-abc' }));
    expect(screen.getByText('connected')).toBeInTheDocument();
  });
});
