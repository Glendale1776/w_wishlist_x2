type ErrorToastProps = {
  message: string | null;
};

export function ErrorToast({ message }: ErrorToastProps) {
  if (!message) return null;

  return (
    <div className="fixed inset-x-4 top-4 z-50 mx-auto max-w-md rounded-md border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800 shadow-sm" role="alert" aria-live="assertive">
      {message}
    </div>
  );
}
