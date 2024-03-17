import clsx from 'clsx';

export function Main({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-wood-50 w-;ull flex flex-col dark:bg-neutral-800">
      <main
        className={clsx(
          'mx-auto flex w-full max-w-[1200px] flex-col gap-12 overflow-y-auto pb-12',
          className,
        )}
      >
        {children}
      </main>
    </div>
  );
}
