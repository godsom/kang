import { render, screen, act } from '@testing-library/react';
import { describe, test, expect, vi } from 'vitest';
import { RoomProvider, useRoom } from './RoomProvider.jsx';

function Probe() {
  const { state } = useRoom();
  return <div>{state.room ? state.room.status : 'no-room'}</div>;
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
});
