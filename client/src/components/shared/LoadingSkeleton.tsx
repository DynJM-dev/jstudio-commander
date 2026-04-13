interface LoadingSkeletonProps {
  variant?: 'card' | 'list' | 'text' | 'chart';
  count?: number;
}

const skeletonBg = 'bg-[rgba(255,255,255,0.04)]';

const CardSkeleton = () => (
  <div className={`${skeletonBg} rounded-2xl p-5 animate-pulse`}>
    <div className={`${skeletonBg} h-4 w-1/3 rounded mb-3`} />
    <div className={`${skeletonBg} h-3 w-2/3 rounded mb-2`} />
    <div className={`${skeletonBg} h-3 w-1/2 rounded`} />
  </div>
);

const ListSkeleton = () => (
  <div className="flex items-center gap-3 py-3 animate-pulse">
    <div className={`${skeletonBg} w-10 h-10 rounded-lg shrink-0`} />
    <div className="flex-1">
      <div className={`${skeletonBg} h-3 w-1/3 rounded mb-2`} />
      <div className={`${skeletonBg} h-2.5 w-1/2 rounded`} />
    </div>
  </div>
);

const TextSkeleton = () => (
  <div className="animate-pulse space-y-2">
    <div className={`${skeletonBg} h-3 w-full rounded`} />
    <div className={`${skeletonBg} h-3 w-4/5 rounded`} />
    <div className={`${skeletonBg} h-3 w-3/5 rounded`} />
  </div>
);

const ChartSkeleton = () => (
  <div className={`${skeletonBg} rounded-2xl h-48 animate-pulse`} />
);

const variants = {
  card: CardSkeleton,
  list: ListSkeleton,
  text: TextSkeleton,
  chart: ChartSkeleton,
};

export const LoadingSkeleton = ({ variant = 'card', count = 1 }: LoadingSkeletonProps) => {
  const Component = variants[variant];
  return (
    <div className="space-y-4">
      {Array.from({ length: count }, (_, i) => (
        <Component key={i} />
      ))}
    </div>
  );
};
