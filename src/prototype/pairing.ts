export interface PairState { generation: number; code: string; phase: 'idle' | 'spinning' | 'ready' | 'pending' | 'done'; expiresAt: number }
export const initialPairState: PairState = { generation: 0, code: '', phase: 'idle', expiresAt: 0 };
export type PairAction = { type: 'reset' } | { type: 'generate'; generation: number; code: string } | { type: 'settle'; generation: number; now: number } | { type: 'request'; now: number } | { type: 'approve'; now: number } | { type: 'send'; code: string; now: number };
export function pairingPhase(state: PairState, now: number) { return (state.phase === 'ready' || state.phase === 'pending') && now >= state.expiresAt ? 'expired' : state.phase; }
export function pairingReducer(state: PairState, action: PairAction): PairState {
  if (action.type === 'reset') return { ...initialPairState, generation: state.generation };
  if (action.type === 'generate') return action.generation > state.generation && /^\d{5}$/.test(action.code) ? { generation: action.generation, code: action.code, phase: 'spinning', expiresAt: 0 } : state;
  if (action.type === 'settle') return state.phase === 'spinning' && action.generation === state.generation ? { ...state, phase: 'ready', expiresAt: action.now + 60000 } : state;
  if (action.type === 'request') return pairingPhase(state, action.now) === 'ready' ? { ...state, phase: 'pending' } : state;
  if (action.type === 'approve') return pairingPhase(state, action.now) === 'pending' ? { ...state, phase: 'done', expiresAt: 0 } : state;
  if (action.type === 'send') return /^\d{5}$/.test(action.code) ? { ...state, code: action.code, phase: 'pending', expiresAt: action.now + 60000 } : state;
  return state;
}
