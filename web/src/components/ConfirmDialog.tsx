import { useEffect, useRef } from 'react'

export default function ConfirmDialog({
  message,
  confirmLabel = 'Xoá',
  cancelLabel = 'Huỷ',
  onConfirm,
  onCancel,
}: {
  message: string
  confirmLabel?: string
  cancelLabel?: string
  onConfirm: () => void
  onCancel: () => void
}) {
  const cancelRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    cancelRef.current?.focus()
  }, [])

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onKeyDown={(e) => {
        if (e.key === 'Escape') onCancel()
      }}
    >
      <div role="dialog" aria-modal="true" aria-label={message} className="w-full max-w-sm space-y-4 rounded bg-white p-4">
        <p>{message}</p>
        <div className="flex justify-end gap-2">
          <button ref={cancelRef} type="button" className="rounded border border-gray-300 px-3 py-2" onClick={onCancel}>
            {cancelLabel}
          </button>
          <button type="button" className="rounded bg-red-600 px-3 py-2 text-white" onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
