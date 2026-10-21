// Dictate v2, Task 12: the Onboarding window, v1's `OnboardingView`
// (Sources/DictateApp/OnboardingView.swift) plus a third step, "Paste your OpenRouter key". The
// step logic lives in steps.ts. Permissions are re-read every second, as v1's PermissionState is.
import { useEffect, useState } from 'react'
import type { DictateApi, Permissions } from '../../shared/dictate'
import { hotkeyShortName } from '../../shared/hotkeys'
import { allSet, onboardingSteps, testAndSaveKey, type OnboardingState, type StepId } from './steps'

function Step(props: { done: boolean; title: string; detail: string; children?: React.ReactNode }): React.JSX.Element {
  return (
    <div className="step" role="group" aria-label={props.title}>
      <span className={`mark ${props.done ? 'green' : 'secondary'}`} aria-label={props.done ? 'Done' : 'Not done'}>
        {props.done ? '✓' : '○'}
      </span>
      <div className="body">
        <div className="title">{props.title}</div>
        <div className="callout secondary">{props.detail}</div>
        {!props.done && props.children}
      </div>
    </div>
  )
}

export function App({ api }: { api: DictateApi }): React.JSX.Element {
  const [permissions, setPermissions] = useState<Permissions | null>(null)
  const [hotkey, setHotkey] = useState('fn')
  const [hadKey, setHadKey] = useState<boolean | null>(null)
  const [keySaved, setKeySaved] = useState(false)
  const [keyInput, setKeyInput] = useState('')
  const [status, setStatus] = useState<string | null>(null)
  const [testing, setTesting] = useState(false)

  useEffect(() => {
    api.getSettings().then((s) => setHotkey(s.hotkey), () => {})
    const unsubscribe = api.onSettings((s) => setHotkey(s.hotkey))
    // Read once when the window opens: a key that already exists skips the step.
    api.hasKey().then(setHadKey, () => setHadKey(false))
    const poll = (): void => {
      api.permissions().then(setPermissions, () => {})
    }
    poll()
    const timer = setInterval(poll, 1000)
    return () => {
      clearInterval(timer)
      unsubscribe()
    }
  }, [api])

  const state: OnboardingState = {
    microphone: permissions?.microphone === 'granted',
    accessibility: permissions?.accessibility === true,
    hadKey,
    keySaved
  }
  const key = hotkeyShortName(hotkey)

  const testKey = async (): Promise<void> => {
    if (testing || keyInput.trim().length === 0) return
    setTesting(true)
    setStatus(null)
    const result = await testAndSaveKey(keyInput, api)
    setTesting(false)
    setStatus(result.status)
    if (result.saved) {
      setKeySaved(true)
      setKeyInput('')
    }
  }

  const rows: Record<StepId, React.JSX.Element> = {
    microphone: (
      <Step
        done={state.microphone}
        title="Microphone"
        detail="Listens only while you're dictating. Audio never leaves your Mac."
      >
        <div>
          <button type="button" onClick={() => void api.requestPermission('microphone')}>
            Allow Microphone
          </button>
        </div>
      </Step>
    ),
    accessibility: (
      <Step
        done={state.accessibility}
        title="Accessibility"
        detail={`Lets Dictate notice the ${key} key and paste where your cursor is.`}
      >
        <div>
          <button type="button" onClick={() => void api.requestPermission('accessibility')}>
            Open Accessibility Settings
          </button>
        </div>
      </Step>
    ),
    key: (
      <Step
        done={state.keySaved}
        title="Paste your OpenRouter key"
        detail="Cleans up and translates what you say. Use your own key: Dictate tests it and saves it only once it works. Without one, Dictate pastes what you said, without cleanup."
      >
        <div className="row">
          <input
            type="password"
            aria-label="OpenRouter key"
            placeholder="Paste your OpenRouter key"
            value={keyInput}
            onChange={(e) => setKeyInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void testKey()
            }}
          />
          <button type="button" disabled={testing || keyInput.trim().length === 0} onClick={() => void testKey()}>
            {testing ? 'Testing…' : 'Test'}
          </button>
        </div>
      </Step>
    )
  }

  return (
    <div className="onboarding">
      <h1>Set up Dictate</h1>
      <div className="secondary">Hold {key}, talk, let go. Two one-time permissions make that work.</div>
      {onboardingSteps(state).map((step) => (
        <div key={step.id}>{rows[step.id]}</div>
      ))}
      {status !== null && <div className="caption">{status}</div>}
      {allSet(state) && <div className="green">All set. You can close this window.</div>}
    </div>
  )
}
