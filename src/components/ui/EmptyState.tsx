import { Cable } from "lucide-react"

type EmptyStateProps = {
  title: string
  description: string
}

export function EmptyState({ title, description }: EmptyStateProps) {
  return (
    <div className="empty-state">
      <div className="empty-state__icon">
        <Cable aria-hidden="true" size={24} />
      </div>
      <h2>{title}</h2>
      <p>{description}</p>
    </div>
  )
}
