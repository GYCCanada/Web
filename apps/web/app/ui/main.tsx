import clsx from 'clsx';

export function Main({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <main
      className={clsx(
        'bg-wood-50 flex flex-col overflow-y-auto pb-16 dark:bg-neutral-800 [&>*:not(.full-bleed)]:mx-auto [&>*:not(.full-bleed)]:w-[--width]',
        className,
      )}
    >
      {children}
    </main>
  );
}
