import { useEffect } from 'react';

/** The browser tab's title, while this page is open. */
export function useTitle(title: string) {
  useEffect(() => {
    const before = document.title;
    document.title = title;
    return () => {
      document.title = before;
    };
  }, [title]);
}
