/** Skeleton loading placeholders - CSS only, stable layout. */
export function Skeleton({
  count = 3,
  variant = 'text',
  className = '',
  height,
  width,
}: {
  count?: number;
  variant?: 'text' | 'circle' | 'rect' | 'pulse';
  className?: string;
  height?: string | number;
  width?: string | number;
}) {
  const base = 'animate-pulse rounded border border-black/10 bg-black/10 dark:border-white/10 dark:bg-white/15';
  const variants = {
    text: 'h-4 w-full',
    circle: 'h-12 w-12 rounded-full',
    rect: 'h-16 w-full',
    pulse: 'h-10 w-full',
  };

  return (
    <div className={`flex flex-col gap-2 ${className}`} aria-hidden="true">
      {[...Array(count)].map((_, i) => (
        <div
          key={i}
          className={`${base} ${variants[variant]}`}
          style={{ height, width }}
        />
      ))}
    </div>
  );
}
