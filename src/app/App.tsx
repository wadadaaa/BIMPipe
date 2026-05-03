import { useEffect, useState } from 'react'
import { LandingPage } from '@/pages/LandingPage'
import { WorkspacePage } from '@/pages/WorkspacePage'

export type ThemeMode = 'dark' | 'light'

const THEME_STORAGE_KEY = 'bimpipe-theme'

function getInitialTheme(): ThemeMode {
  const storedTheme = window.localStorage.getItem(THEME_STORAGE_KEY)
  if (storedTheme === 'dark' || storedTheme === 'light') {
    return storedTheme
  }

  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
}

function isAppRoute(pathname: string): boolean {
  return pathname === '/app' || pathname.startsWith('/app/')
}

export default function App() {
  const [theme, setTheme] = useState<ThemeMode>(getInitialTheme)
  const [isApp, setIsApp] = useState<boolean>(() => isAppRoute(window.location.pathname))

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    window.localStorage.setItem(THEME_STORAGE_KEY, theme)
  }, [theme])

  useEffect(() => {
    function handlePopState() {
      setIsApp(isAppRoute(window.location.pathname))
    }
    window.addEventListener('popstate', handlePopState)
    return () => window.removeEventListener('popstate', handlePopState)
  }, [])

  function toggleTheme() {
    setTheme((current) => (current === 'dark' ? 'light' : 'dark'))
  }

  if (isApp) {
    return <WorkspacePage theme={theme} onToggleTheme={toggleTheme} />
  }
  return <LandingPage theme={theme} onToggleTheme={toggleTheme} />
}
