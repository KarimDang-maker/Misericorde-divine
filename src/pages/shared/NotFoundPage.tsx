import { Link } from "react-router"

export function NotFoundPage() {
  return (
    <div className="not-found">
      <span>404</span>
      <h2>Cette page n’existe pas</h2>
      <p>Vérifiez l’adresse ou revenez au tableau de bord.</p>
      <Link className="button button--primary" to="/">
        Retour au tableau de bord
      </Link>
    </div>
  )
}
