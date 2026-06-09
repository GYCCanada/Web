export function FieldMessage({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="text-sm text-neutral-600"
      role="alert"
    >
      {children}
    </div>
  );
}
