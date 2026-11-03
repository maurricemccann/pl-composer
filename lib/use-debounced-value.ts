import { useEffect, useState } from 'react';

export function useDebouncedValue<T>(value: T, waitMs = 150): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), waitMs);
    return () => clearTimeout(id);
  }, [value, waitMs]);

  return debounced;
}
