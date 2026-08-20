import { createContext, useContext } from 'react';

// Separate from App.jsx on purpose — Nav.jsx (rendered inside screens App.jsx
// imports) needs logout, and importing App.jsx from Nav.jsx would be circular.
const AuthContext = createContext(null);

function useAuthActions() {
  return useContext(AuthContext);
}

export { AuthContext, useAuthActions };
