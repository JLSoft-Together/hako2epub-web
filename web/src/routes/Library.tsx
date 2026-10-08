import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import ConfirmDialog from '../components/ConfirmDialog'
import { useClient, useLibrary, useSnapshot, useStartJob } from '../data/queries'
import { downloadEpub } from '../download'
import { formatMb } from '../format'
import { novelId } from '../ids'
import { deleteNovel, deleteVolume } from '../library-actions'
import type { Asset, LnNovel } from '../types'

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e))

type Pending = { message: string; run: () => void }

function safeId(url: string): string | null {
  try {
    return novelId(url)
  } catch {
    return null
  }
}

function NovelCard({
  novel,
  confirm,
  onError,
}: {
  novel: LnNovel
  confirm: (p: Pending) => void
  onError: (msg: string | null) => void
}) {
  const client = useClient()
  const qc = useQueryClient()
  const startJob = useStartJob()
  const [open, setOpen] = useState(false)
  const snap = useSnapshot(safeId(novel.ln_url))
  const cover = snap.data?.cover_url

  const refresh = () => qc.invalidateQueries({ queryKey: ['library'] })
  const download = useMutation({
    mutationFn: (a: Asset) => downloadEpub(client, a),
    onMutate: () => onError(null),
    onError: (e) => onError(errMsg(e)),
  })
  const delVol = useMutation({
    mutationFn: (vol: string) => deleteVolume(client, novel, vol),
    onMutate: () => onError(null),
    onSuccess: refresh,
    onError: (e) => onError(`${errMsg(e)} — thử xoá lại`),
  })
  const delNovel = useMutation({
    mutationFn: () => deleteNovel(client, novel),
    onMutate: () => onError(null),
    onSuccess: refresh,
    onError: (e) => onError(`${errMsg(e)} — thử xoá lại`),
  })
  const update = useMutation({
    mutationFn: () => startJob('update', { url: novel.ln_url }, novel.ln_name),
    onMutate: () => onError(null),
    onSuccess: () => {
      setTimeout(() => update.reset(), 5000)
    },
    onError: (e) => onError(errMsg(e)),
  })
  const busy = delVol.isPending || delNovel.isPending

  return (
    <li className="space-y-2 rounded border border-gray-200 p-3">
      <div className="flex gap-3">
        {cover && <img src={cover} alt="" className="h-20 w-14 shrink-0 rounded object-cover" />}
        <div className="min-w-0 flex-1">
          <button
            type="button"
            className="block w-full text-left font-semibold"
            aria-expanded={open}
            onClick={() => setOpen((o) => !o)}
          >
            {novel.ln_name}
          </button>
          <div className="text-sm text-gray-600">{novel.vol_list.length} tập</div>
        </div>
      </div>
      <div className="flex flex-wrap gap-2 text-sm">
        <button
          type="button"
          className="rounded border border-gray-300 px-3 py-2 disabled:opacity-50"
          disabled={update.isPending}
          onClick={() => update.mutate()}
        >
          {update.isSuccess ? 'Đã gửi yêu cầu' : 'Kiểm tra cập nhật'}
        </button>
        <button
          type="button"
          className="rounded border border-red-300 px-3 py-2 text-red-700 disabled:opacity-50"
          disabled={busy}
          onClick={() =>
            confirm({ message: `Xoá vĩnh viễn ${novel.ln_name}?`, run: () => delNovel.mutate() })
          }
        >
          Xoá truyện
        </button>
      </div>
      {open && (
        <ul className="space-y-2">
          {novel.vol_list.map((v) => (
            <li key={v.vol_name} className="flex flex-wrap items-center justify-between gap-2 border-t border-gray-100 pt-2">
              <div className="min-w-0">
                <div>{v.vol_name}</div>
                <div className="text-xs text-gray-600">
                  {v.num_chapter} chương{v.asset ? ` · ${formatMb(v.asset.size)}` : ''}
                </div>
              </div>
              <div className="flex gap-2 text-sm">
                {v.asset ? (
                  <button
                    type="button"
                    className="rounded bg-blue-600 px-3 py-2 text-white disabled:opacity-50"
                    disabled={download.isPending}
                    onClick={() => download.mutate(v.asset as Asset)}
                  >
                    Tải EPUB
                  </button>
                ) : (
                  <span className="px-3 py-2 text-gray-500">Chưa có file</span>
                )}
                <button
                  type="button"
                  className="rounded border border-red-300 px-3 py-2 text-red-700 disabled:opacity-50"
                  disabled={busy}
                  onClick={() =>
                    confirm({ message: `Xoá vĩnh viễn ${v.vol_name}?`, run: () => delVol.mutate(v.vol_name) })
                  }
                >
                  Xoá
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </li>
  )
}

export default function Library() {
  const lib = useLibrary()
  const startJob = useStartJob()
  const [pending, setPending] = useState<Pending | null>(null)
  const [error, setError] = useState<string | null>(null)
  const updateAll = useMutation({
    mutationFn: () => startJob('update', {}, 'Tất cả truyện'),
    onMutate: () => setError(null),
    onSuccess: () => {
      setTimeout(() => updateAll.reset(), 5000)
    },
    onError: (e) => setError(errMsg(e)),
  })
  const novels = lib.data?.ln_list ?? []

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-xl font-semibold">Thư viện</h1>
        {novels.length > 0 && (
          <button
            type="button"
            className="rounded border border-gray-300 px-3 py-2 text-sm disabled:opacity-50"
            disabled={updateAll.isPending}
            onClick={() => updateAll.mutate()}
          >
            {updateAll.isSuccess ? 'Đã gửi yêu cầu' : 'Cập nhật tất cả'}
          </button>
        )}
      </div>
      {error && (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      )}
      {lib.isLoading ? (
        <p>Đang tải…</p>
      ) : lib.isError ? (
        <p role="alert" className="text-red-700">
          {errMsg(lib.error)}
        </p>
      ) : novels.length === 0 ? (
        <div className="space-y-2">
          <p>Thư viện trống</p>
          <a href="#/novel" className="text-blue-600 underline">
            Thêm truyện
          </a>
        </div>
      ) : (
        <ul className="space-y-3">
          {novels.map((n) => (
            <NovelCard key={n.ln_url} novel={n} confirm={setPending} onError={setError} />
          ))}
        </ul>
      )}
      {pending && (
        <ConfirmDialog
          message={pending.message}
          onCancel={() => setPending(null)}
          onConfirm={() => {
            const p = pending
            setPending(null)
            p.run()
          }}
        />
      )}
    </div>
  )
}
