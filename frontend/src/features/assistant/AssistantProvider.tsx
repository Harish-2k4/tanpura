// Opens the AI assistant drawer from anywhere in the app.
import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import { AssistantDrawer } from './AssistantDrawer';

type Assistant = { open: (message?: string) => void };
const AssistantContext = createContext<Assistant | null>(null);

export function AssistantProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<{ open: boolean; message: string; key: number }>({ open: false, message: '', key: 0 });
  const open = useCallback((message = '') => setState((s) => ({ open: true, message, key: message ? s.key + 1 : s.key })), []);
  return (
    <AssistantContext.Provider value={{ open }}>
      {children}
      <AssistantDrawer key={state.key} open={state.open} initialMessage={state.message} onClose={() => setState((s) => ({ ...s, open: false }))} />
    </AssistantContext.Provider>
  );
}

export function useAssistant(): Assistant {
  const assistant = useContext(AssistantContext);
  if (!assistant) throw new Error('useAssistant must be used inside AssistantProvider');
  return assistant;
}
