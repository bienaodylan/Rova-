import { useEffect, useRef, useState } from 'react';

interface UseHideOnScrollOptions {
  /** Minimum scrollY before the header is allowed to hide */
  hideThreshold?: number;
  /** Minimum downward delta (px) to trigger hiding */
  downDelta?: number;
  /** Minimum upward delta (px) to trigger showing */
  upDelta?: number;
}

interface UseHideOnScrollResult {
  /** True when the header should be hidden (scrolling down past threshold) */
  hidden: boolean;
  /** True when the page has been scrolled down past the top edge */
  scrolled: boolean;
}

export function useHideOnScroll({
  hideThreshold = 36,
  downDelta = 6,
  upDelta = 4,
}: UseHideOnScrollOptions = {}): UseHideOnScrollResult {
  const [hidden, setHidden] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const lastScrollY = useRef(0);
  const ticking = useRef(false);

  useEffect(() => {
    lastScrollY.current = window.scrollY;
    setScrolled(window.scrollY > 8);

    const update = () => {
      const currentY = Math.max(0, window.scrollY);
      const delta = currentY - lastScrollY.current;

      setScrolled(currentY > 8);

      if (currentY <= 16) {
        setHidden(false);
      } else if (delta > downDelta && currentY > hideThreshold) {
        setHidden(true);
      } else if (delta < -upDelta) {
        setHidden(false);
      }

      lastScrollY.current = currentY;
      ticking.current = false;
    };

    const handleScroll = () => {
      if (!ticking.current) {
        ticking.current = true;
        window.requestAnimationFrame(update);
      }
    };

    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, [hideThreshold, downDelta, upDelta]);

  return { hidden, scrolled };
}
