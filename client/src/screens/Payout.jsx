import { useSocket } from '../socket/SocketProvider.jsx';
import { useRoom } from '../state/RoomProvider.jsx';
import Button from '../components/Button.jsx';
import Nav from '../components/Nav.jsx';

function Payout({ userId }) {
  const { socket, connected } = useSocket();
  const { state, dispatch } = useRoom();
  const settlement = state.room?.settlement || [];

  const youOwe = settlement.filter((s) => s.from === userId);
  const owedToYou = settlement.filter((s) => s.to === userId);

  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-6">
      <div className="w-full max-w-lg rounded-2xl bg-felt-900/80 border border-gold-500/30 shadow-card backdrop-blur-sm p-8 text-cream-50/80 text-sm">
        <Nav active="payout" />
        <h1 className="font-display text-3xl font-bold text-gold-400 tracking-wide text-center mb-6">
          ยอดจ่าย (5 บาท/แต้ม)
        </h1>

        <h2 className="font-display text-gold-400 mb-2">ยอดที่คุณต้องจ่าย</h2>
        {youOwe.length === 0 && <p className="mb-6">ไม่มียอดที่ต้องจ่าย</p>}
        {youOwe.length > 0 && (
          <table className="w-full text-left mb-6">
            <thead>
              <tr className="text-cream-50/50 text-xs uppercase">
                <th className="font-normal pb-1">ยอดที่ต้องจ่าย</th>
                <th className="font-normal pb-1">เจ้าหนี้</th>
              </tr>
            </thead>
            <tbody>
              {youOwe.map((s, i) => (
                <tr key={i}>
                  <td className="py-1">{s.baht} บาท</td>
                  <td className="py-1">{s.toUsername}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <h2 className="font-display text-gold-400 mb-2">ยอดที่ต้องได้รับ</h2>
        {owedToYou.length === 0 && <p className="mb-6">ไม่มียอดที่ต้องได้รับ</p>}
        {owedToYou.length > 0 && (
          <table className="w-full text-left mb-6">
            <thead>
              <tr className="text-cream-50/50 text-xs uppercase">
                <th className="font-normal pb-1">ยอดที่ต้องได้รับ</th>
                <th className="font-normal pb-1">ลูกหนี้</th>
                <th className="font-normal pb-1"></th>
              </tr>
            </thead>
            <tbody>
              {owedToYou.map((s, i) => (
                <tr key={i}>
                  <td className="py-1">{s.baht} บาท</td>
                  <td className="py-1">{s.fromUsername}</td>
                  <td className="py-1 text-right">
                    <button
                      className="text-gold-400 text-xs underline"
                      disabled={!connected}
                      onClick={() => socket.emit('settlement:clear', { from: s.from })}
                    >
                      ปิดยอด
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <Button variant="ghost" className="w-full" onClick={() => dispatch({ type: 'HIDE_PAYOUT' })}>
          กลับ
        </Button>
      </div>
    </div>
  );
}

export default Payout;
