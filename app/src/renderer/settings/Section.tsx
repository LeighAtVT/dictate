// A titled group of rows, standing in for SwiftUI's `Section` inside a `.formStyle(.grouped)` Form.
import type { ReactNode } from 'react'

export function Section({ title, children }: { title?: string; children: ReactNode }): React.JSX.Element {
  return (
    <section className="section" aria-label={title}>
      {title !== undefined && <h3>{title}</h3>}
      <div className="group">{children}</div>
    </section>
  )
}
