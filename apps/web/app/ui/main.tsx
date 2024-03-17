export function Main({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-wood-50 flex flex-col gap-12 overflow-y-auto px-3 py-16 dark:bg-neutral-800">
      {children}
    </div>
  );
}
