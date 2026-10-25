import type { LucideIcon } from "lucide-react"

type StatCardProps = {
  label: string
  value: string
  detail: string
  icon: LucideIcon
  tone?: "rose" | "plum" | "blue" | "green"
  sensitive?: boolean
}

export function StatCard({
  label,
  value,
  detail,
  icon: Icon,
  tone = "rose",
  sensitive = false,
}: StatCardProps) {
  return (
    <article className="stat-card">
      <div className={`stat-card__icon stat-card__icon--${tone}`}>
        <Icon aria-hidden="true" size={20} />
      </div>
      <div className="stat-card__content">
        <p className="stat-card__label">{label}</p>
        <p className={`stat-card__value ${sensitive ? "sensitive-amount" : ""}`}>{value}</p>
        <p className="stat-card__detail">{detail}</p>
      </div>
    </article>
  )
}
