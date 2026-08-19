import { render, screen, act } from '@testing-library/react';
import { describe, test, expect, vi } from 'vitest';
import { RoomProvider, useRoom } from './RoomProvider.jsx';

function Probe() {
  const { state } = useRoom();
  return <div>{state.room ? state.room.status : 'no-room'}</div>;
}

function ErrorProbe() {
  const { state } = useRoom();
  return <div>{state.error || 'no-error'}</div>;
}

function makeMockSocket() {
  const handlers = {};
  return {
    handlers,
    on: vi.fn((event, cb) => { handlers[event] = cb; }),
    off: vi.fn(),
    emit: vi.fn(),
  };
}

describe('RoomProvider', () => {
  test('dispatches ROOM_STATE when the socket emits room:state', () => {
    const socket = makeMockSocket();
    render(
      <RoomProvider socket={socket}>
        <Probe />
      </RoomProvider>
    );
    expect(screen.getByText('no-room')).toBeInTheDocument();

    act(() => socket.handlers['room:state']({ status: 'waiting' }));
    expect(screen.getByText('waiting')).toBeInTheDocument();
  });

  test('dispatches ERROR when the socket emits auth:error', () => {
    const socket = makeMockSocket();
    render(
      <RoomProvider socket={socket}>
        <ErrorProbe />
      </RoomProvider>
    );
    expect(screen.getByText('no-error')).toBeInTheDocument();

    act(() => socket.handlers['auth:error']({ message: 'Invalid or expired token' }));
    expect(screen.getByText('Invalid or expired token')).toBeInTheDocument();
  });

  test('re-emits room:join with the last known roomId on a post-initial connect', () => {
    const socket = makeMockSocket();
    render(
      <RoomProvider socket={socket}>
        <Probe />
      </RoomProvider>
    );

    // Initial connect (e.g. from SocketProvider) should not trigger a re-join.
    act(() => socket.handlers['connect']());
    expect(socket.emit).not.toHaveBeenCalledWith('room:join', expect.anything());

    // Once a room is established via room:state, remember its roomId.
    act(() => socket.handlers['room:state']({ status: 'waiting', roomId: 'room42' }));

    // A subsequent connect (i.e. a reconnect) should re-emit room:join.
    act(() => socket.handlers['connect']());
    expect(socket.emit).toHaveBeenCalledWith('room:join', { roomId: 'room42' });
  });
});
