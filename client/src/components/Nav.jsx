import { useRoom } from '../state/RoomProvider.jsx';
import { useAuthActions } from '../state/AuthContext.js';
import Button from './Button.jsx';

// Small persistent menu for hopping between screens (หน้าหลัก/ยอดจ่าย only
// make sense once you're seated at a table) plus logout, which is always
// available. `vertical` switches it from a horizontal top bar to a stacked
// sidebar (used by Table.jsx's left rail).
function Nav({ active, vertical = false }) {
  const { state, dispatch } = useRoom();
  const auth = useAuthActions();
  const hasRoom = !!state.room;
  if (!hasRoom && !auth) return null;

  return (
    <div className={`flex ${vertical ? 'flex-col items-stretch' : 'justify-center'} gap-2 ${vertical ? '' : 'mb-4'}`}>
      {hasRoom && active !== 'home' && (
        <Button variant="ghost" onClick={() => dispatch({ type: 'SHOW_HOME' })}>หน้าหลัก</Button>
      )}
      {hasRoom && active !== 'payout' && (
        <Button variant="ghost" onClick={() => dispatch({ type: 'SHOW_PAYOUT' })}>ยอดจ่าย</Button>
      )}
      {auth && (
        <Button variant="ghost" onClick={auth.logout}>ออกจากระบบ</Button>
      )}
    </div>
  );
}

export default Nav;
