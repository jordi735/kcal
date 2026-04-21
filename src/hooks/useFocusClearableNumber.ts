import { useEffect, useState } from 'preact/hooks';

// A numeric text input that clears on focus (so the user can type freely
// without backspacing), restores from `value` on empty-blur, and otherwise
// mirrors `value` when unfocused. Callers force-sync via the returned
// `setText` — e.g. when a +/- button mutates the value while the input
// still has focus (iOS Safari doesn't move focus to buttons on tap, so the
// useEffect below wouldn't fire).
export function useFocusClearableNumber(value: number) {
  const [text, setText] = useState(String(value));
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    if (!focused) setText(String(value));
  }, [value, focused]);

  return {
    text,
    setText,
    focused,
    onFocus: () => {
      setFocused(true);
      setText('');
    },
    onBlur: () => {
      setFocused(false);
      if (text === '') setText(String(value));
    },
  };
}
