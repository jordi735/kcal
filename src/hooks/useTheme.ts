import { useLayoutEffect, useState } from 'preact/hooks';
import { getTheme, selectTheme, subscribeTheme } from '../theme';

export function useTheme() {
  const [theme, setTheme] = useState(getTheme);
  useLayoutEffect(() => {
    const unsubscribe = subscribeTheme(setTheme);
    setTheme(getTheme());
    return unsubscribe;
  }, []);
  return { theme, selectTheme };
}
