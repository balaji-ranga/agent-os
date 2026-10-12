import { useEffect, useRef } from 'react';
const forms = new Map();
export function getCopilotForm(id) { return forms.get(id); }
export function useCopilotForm(id, values, apply, guard=()=>{}) {
  const current = useRef({ values, apply, guard });
  current.current = { values, apply, guard };
  useEffect(() => {
    const binding = {
      read: () => {current.current.guard();return structuredClone(current.current.values);},
      apply: (patch, expected) => {
        if (JSON.stringify(current.current.values) !== JSON.stringify(expected)) throw new Error('This form changed after the proposal. Review your edits and ask again. Nothing was overwritten.');
        current.current.guard();return current.current.apply(patch);
      },
    };
    forms.set(id, binding);
    return () => { if (forms.get(id) === binding) forms.delete(id); };
  }, [id]);
}
