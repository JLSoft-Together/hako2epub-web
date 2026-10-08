import { useJobs } from '../data/queries'

export default function JobBadge() {
  const { activeCount } = useJobs()
  return (
    <a href="#/jobs" className="relative inline-flex items-center gap-1 text-sm font-medium">
      Tác vụ
      {activeCount > 0 && (
        <span
          aria-label={`${activeCount} tác vụ đang chạy`}
          className="rounded-full bg-blue-600 px-2 text-xs font-semibold text-white"
        >
          {activeCount}
        </span>
      )}
    </a>
  )
}
