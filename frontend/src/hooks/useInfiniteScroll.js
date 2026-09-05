import { useEffect, useRef } from 'react';

export function useInfiniteScroll(onLoadMore, enabled = true) {
  const ref = useRef(null);
  useEffect(() => {
    const node = ref.current;
    if (!enabled || !node || typeof IntersectionObserver === 'undefined') return undefined;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) onLoadMore();
    }, { rootMargin: '240px 0px' });
    observer.observe(node);
    return () => observer.disconnect();
  }, [enabled, onLoadMore]);
  return ref;
}
