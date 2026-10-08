import { useEffect } from 'react'
import Jobs from './routes/Jobs'
import Library from './routes/Library'
import Novel from './routes/Novel'
import Setup from './routes/Setup'
import { navigate, useHashRoute } from './router'
import { loadSettings } from './settings'

export default function App() {
  const route = useHashRoute()
  const needsSetup = route.name !== 'setup' && loadSettings() === null

  useEffect(() => {
    if (needsSetup) navigate('/setup')
  }, [needsSetup])

  if (needsSetup) return null

  switch (route.name) {
    case 'setup':
      return <Setup />
    case 'novel':
      return <Novel />
    case 'jobs':
      return <Jobs />
    default:
      return <Library />
  }
}
