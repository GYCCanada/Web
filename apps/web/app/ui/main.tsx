import clsx from 'clsx';

export function Main({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-wood-50 flex flex-col dark:bg-neutral-800">
      <main
        className={clsx(
          'mx-auto flex w-full max-w-[1200px] flex-col overflow-y-auto pb-16',
          className,
        )}
      >
        {children}
      </main>
    </div>
  );
}
