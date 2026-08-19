import { useRoom } from '../state/RoomProvider.jsx';

function Result() {
  const { state, dispatch } = useRoom();
  const { winners, reason, multiplier } = state.result;

  return (
    <div>
      <h2>Round result</h2>
      <p>Winner(s): {winners.join(', ')}</p>
      <p>Reason: {reason}</p>
      <p>Multiplier: {multiplier}</p>
      <button onClick={() => dispatch({ type: 'CLEAR_RESULT' })}>Back to lobby</button>
    </div>
  );
}

export default Result;
