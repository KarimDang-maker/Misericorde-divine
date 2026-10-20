import { ArrowRight, Braces, CheckCircle2 } from "lucide-react"
import { EmptyState } from "@/components/ui/EmptyState"
import { StatusBadge } from "@/components/ui/StatusBadge"

type ModulePlaceholderPageProps = {
  title: string
  description: string
  apiDependency: string
}

export function ModulePlaceholderPage({
  title,
  description,
  apiDependency,
}: ModulePlaceholderPageProps) {
  return (
    <div className="page placeholder-page">
      <section className="page-intro">
        <div>
          <p className="page-intro__eyebrow">Module métier</p>
          <h2>{title}</h2>
          <p>{description}</p>
        </div>
        <StatusBadge tone="warning">En attente du contrat API</StatusBadge>
      </section>

      <section className="module-readiness">
        <article className="readiness-card">
          <CheckCircle2 aria-hidden="true" size={20} />
          <div>
            <strong>Navigation prête</strong>
            <span>Route, layout responsive et état actif configurés.</span>
          </div>
        </article>
        <article className="readiness-card">
          <Braces aria-hidden="true" size={20} />
          <div>
            <strong>Dépendance identifiée</strong>
            <span>{apiDependency}</span>
          </div>
        </article>
        <article className="readiness-card readiness-card--muted">
          <ArrowRight aria-hidden="true" size={20} />
          <div>
            <strong>Prochaine étape</strong>
            <span>
              Valider les champs, règles métier et formats de réponse.
            </span>
          </div>
        </article>
      </section>

      <section className="panel">
        <EmptyState
          title="Aucune donnée réelle n’est affichée"
          description="Ce module est volontairement préparé sans inventer de données ni de comportement métier. Il sera connecté après validation du contrat API."
        />
      </section>
    </div>
  )
}
