import { render, screen, fireEvent } from '@testing-library/react';
import { describe, test, expect, vi, beforeEach } from 'vitest';
import Nav from './Nav.jsx';

vi.mock('../state/RoomProvider.jsx', () => ({
  useRoom: () => ({ state: globalThis.__mockRoomState, dispatch: globalThis.__mockDispatch }),
}));
vi.mock('../state/AuthContext.js', () => ({
  useAuthActions: () => globalThis.__mockAuth,
}));

describe('Nav', () => {
  beforeEach(() => {
    globalThis.__mockAuth = null;
  });

  test('renders nothing when there is no room and no auth', () => {
    globalThis.__mockRoomState = { room: null };
    globalThis.__mockDispatch = vi.fn();
    const { container } = render(<Nav />);
    expect(container).toBeEmptyDOMElement();
  });

  test('shows only logout when authenticated but not in a room', () => {
    globalThis.__mockRoomState = { room: null };
    globalThis.__mockDispatch = vi.fn();
    globalThis.__mockAuth = { logout: vi.fn() };
    render(<Nav />);
    expect(screen.getByRole('button', { name: 'ออกจากระบบ' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'หน้าหลัก' })).not.toBeInTheDocument();
  });

  test('logout button calls auth.logout', () => {
    globalThis.__mockRoomState = { room: { roomId: 1 } };
    globalThis.__mockDispatch = vi.fn();
    const logout = vi.fn();
    globalThis.__mockAuth = { logout };
    render(<Nav />);
    fireEvent.click(screen.getByRole('button', { name: 'ออกจากระบบ' }));
    expect(logout).toHaveBeenCalled();
  });

  test('shows both links by default, dispatching SHOW_HOME / SHOW_PAYOUT', () => {
    globalThis.__mockRoomState = { room: { roomId: 1 } };
    globalThis.__mockDispatch = vi.fn();
    render(<Nav />);
    fireEvent.click(screen.getByRole('button', { name: 'หน้าหลัก' }));
    expect(globalThis.__mockDispatch).toHaveBeenCalledWith({ type: 'SHOW_HOME' });
    fireEvent.click(screen.getByRole('button', { name: 'ยอดจ่าย' }));
    expect(globalThis.__mockDispatch).toHaveBeenCalledWith({ type: 'SHOW_PAYOUT' });
  });

  test('hides the ยอดจ่าย link when active="payout"', () => {
    globalThis.__mockRoomState = { room: { roomId: 1 } };
    globalThis.__mockDispatch = vi.fn();
    render(<Nav active="payout" />);
    expect(screen.getByRole('button', { name: 'หน้าหลัก' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'ยอดจ่าย' })).not.toBeInTheDocument();
  });

  test('hides the หน้าหลัก link when active="home"', () => {
    globalThis.__mockRoomState = { room: { roomId: 1 } };
    globalThis.__mockDispatch = vi.fn();
    render(<Nav active="home" />);
    expect(screen.queryByRole('button', { name: 'หน้าหลัก' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'ยอดจ่าย' })).toBeInTheDocument();
  });
});
