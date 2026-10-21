// Dictate v2, Task 11: the pill's one component, v1's `PillView`
// (Sources/DictateApp/PillWindow.swift): a red dot while listening (grey otherwise) and the text,
// in a capsule. main/pill.ts sends the text; this only draws it.
import { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'

interface PillMessage {
  text: string
  listening: boolean
}

declare global {
  interface Window {
    /** From src/preload/pill.ts. */
    pill: { onUpdate(callback: (message: PillMessage) => void): void }
  }
}

const dark = window.matchMedia('(prefers-color-scheme: dark)')

function Pill(): React.JSX.Element | null {
  const [message, setMessage] = useState<PillMessage>({ text: '', listening: false })
  const [isDark, setDark] = useState(dark.matches)

  useEffect(() => {
    window.pill.onUpdate(setMessage)
    const onScheme = (e: MediaQueryListEvent): void => setDark(e.matches)
    dark.addEventListener('change', onScheme)
    return () => dark.removeEventListener('change', onScheme)
  }, [])

  if (message.text === '') return null
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        padding: '7px 12px',
        borderRadius: 999,
        background: isDark ? 'rgba(40, 40, 40, 0.92)' : 'rgba(246, 246, 246, 0.94)',
        color: isDark ? '#f2f2f2' : '#1d1d1f',
        border: `0.5px solid ${isDark ? 'rgba(255, 255, 255, 0.15)' : 'rgba(0, 0, 0, 0.12)'}`,
        boxShadow: '0 1px 4px rgba(0, 0, 0, 0.25)',
        fontSize: 13,
        fontWeight: 500,
        whiteSpace: 'nowrap'
      }}
    >
      <span
        style={{
          width: 8,
          height: 8,
          borderRadius: 4,
          background: message.listening ? '#ff3b30' : '#8e8e93'
        }}
      />
      {message.text}
    </div>
  )
}

createRoot(document.getElementById('root')!).render(<Pill />)
