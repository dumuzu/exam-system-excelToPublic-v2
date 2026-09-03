export function Skeleton({ className = "" }: { className?: string }) {
  return <span aria-hidden="true" className={`uiSkeleton ${className}`.trim()} />;
}
