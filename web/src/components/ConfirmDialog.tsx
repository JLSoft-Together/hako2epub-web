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
  const confirmRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null
    cancelRef.current?.focus()
    return () => prev?.focus?.()
  }, [])

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onKeyDown={(e) => {
        if (e.key === 'Escape') onCancel()
        if (e.key === 'Tab') {
          const first = cancelRef.current
          const last = confirmRef.current
          if (e.shiftKey && document.activeElement === first) {
            e.preventDefault()
            last?.focus()
          } else if (!e.shiftKey && document.activeElement === last) {
            e.preventDefault()
            first?.focus()
          }
        }
      }}
    >
      <div role="dialog" aria-modal="true" aria-label={message} className="w-full max-w-sm space-y-4 rounded bg-white p-4">
        <p>{message}</p>
        <div className="flex justify-end gap-2">
          <button ref={cancelRef} type="button" className="rounded border border-gray-300 px-3 py-2" onClick={onCancel}>
            {cancelLabel}
          </button>
          <button ref={confirmRef} type="button" className="rounded bg-red-600 px-3 py-2 text-white" onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
